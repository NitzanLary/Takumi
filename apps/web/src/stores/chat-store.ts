/**
 * Chat Store — Zustand store for managing chat state across all pages.
 *
 * Manages: drawer open/close, conversations, messages, streaming state.
 * Uses Zustand because chat state is write-heavy (token-by-token streaming)
 * and needs to persist across page navigations.
 */

import { create } from 'zustand';
import { fetchSSE } from '@/lib/sse-client';
import { apiFetch } from '@/lib/api-client';
import type { AiSseEvent } from '@takumi/types';

export interface ToolCallInfo {
  name: string;
  input?: unknown;
  result?: unknown;
  status: 'running' | 'done' | 'error';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: ToolCallInfo[];
  createdAt: string;
  isStreaming?: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface ChatState {
  // Drawer
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;

  // Conversations
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  loadConversations: () => Promise<void>;
  setActiveConversation: (id: string | null) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  startNewConversation: () => void;

  // Messages
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  stopStreaming: () => void;
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Held outside the store — it's a transient handle, not observable state.
let activeAbortController: AbortController | null = null;

export const useChatStore = create<ChatState>((set, get) => ({
  // ─── Drawer ─────────────────────────────
  isOpen: false,
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),

  // ─── Conversations ──────────────────────
  conversations: [],
  activeConversationId: null,

  loadConversations: async () => {
    try {
      const conversations = await apiFetch<ConversationSummary[]>(
        '/api/chat/conversations'
      );
      set({ conversations });
    } catch {
      // silently fail
    }
  },

  setActiveConversation: async (id: string | null) => {
    if (!id) {
      set({ activeConversationId: null, messages: [], error: null });
      return;
    }

    try {
      const conv = await apiFetch<{
        id: string;
        messages: Array<{
          id: string;
          role: string;
          content: string;
          toolCalls: unknown[] | null;
          createdAt: string;
        }>;
      }>(`/api/chat/conversations/${id}`);

      // Convert DB messages to ChatMessage format
      const messages: ChatMessage[] = [];
      for (const m of conv.messages) {
        if (m.role === 'user') {
          messages.push({
            id: m.id,
            role: 'user',
            content: m.content,
            toolCalls: [],
            createdAt: m.createdAt,
          });
        } else if (m.role === 'assistant') {
          const toolCalls: ToolCallInfo[] = [];
          if (m.toolCalls && Array.isArray(m.toolCalls)) {
            for (const tc of m.toolCalls) {
              const toolCall = tc as Record<string, unknown>;
              toolCalls.push({
                name: (toolCall.name as string) || 'unknown',
                input: toolCall.input,
                status: 'done',
              });
            }
          }
          messages.push({
            id: m.id,
            role: 'assistant',
            content: m.content,
            toolCalls,
            createdAt: m.createdAt,
          });
        }
        // Skip 'tool' role messages — they're represented as toolCalls on the assistant message
      }

      set({ activeConversationId: id, messages, error: null });
    } catch {
      set({ activeConversationId: id, messages: [], error: null });
    }
  },

  deleteConversation: async (id: string) => {
    try {
      await apiFetch(`/api/chat/conversations/${id}`, { method: 'DELETE' });
      const { activeConversationId, conversations } = get();
      set({
        conversations: conversations.filter((c) => c.id !== id),
        ...(activeConversationId === id
          ? { activeConversationId: null, messages: [] }
          : {}),
      });
    } catch {
      // silently fail
    }
  },

  startNewConversation: () => {
    set({ activeConversationId: null, messages: [], error: null });
  },

  // ─── Messages ───────────────────────────
  messages: [],
  isStreaming: false,
  error: null,

  sendMessage: async (text: string) => {
    const { activeConversationId, messages } = get();

    // Add user message
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      toolCalls: [],
      createdAt: new Date().toISOString(),
    };

    // Add placeholder assistant message — `isStreaming: true` triggers the
    // typing-dots indicator in MessageBubble until the first chunk arrives.
    const assistantMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      toolCalls: [],
      createdAt: new Date().toISOString(),
      isStreaming: true,
    };

    set({
      messages: [...messages, userMsg, assistantMsg],
      isStreaming: true,
      error: null,
    });

    const assistantId = assistantMsg.id;
    const controller = new AbortController();
    activeAbortController = controller;

    await fetchSSE(
      '/api/chat',
      {
        message: text,
        conversationId: activeConversationId || undefined,
      },
      (event: AiSseEvent) => {
        const state = get();
        const msgs = [...state.messages];
        const idx = msgs.findIndex((m) => m.id === assistantId);
        if (idx === -1) return;

        const assistant = { ...msgs[idx] };

        switch (event.type) {
          case 'text_delta':
            assistant.content += event.text || '';
            break;

          case 'tool_call':
            assistant.toolCalls = [
              ...assistant.toolCalls,
              {
                name: event.toolName || 'unknown',
                input: event.toolInput,
                status: 'running',
              },
            ];
            break;

          case 'tool_result': {
            const toolCalls = [...assistant.toolCalls];
            const tcIdx = toolCalls.findLastIndex(
              (tc) => tc.name === event.toolName && tc.status === 'running'
            );
            if (tcIdx !== -1) {
              toolCalls[tcIdx] = {
                ...toolCalls[tcIdx],
                result: event.toolResult,
                status: 'done',
              };
              assistant.toolCalls = toolCalls;
            }
            break;
          }

          case 'done':
            assistant.isStreaming = false;
            if (event.conversationId) {
              set({ activeConversationId: event.conversationId });
            }
            set({ isStreaming: false });
            // Refresh conversation list
            get().loadConversations();
            break;

          case 'error':
            assistant.isStreaming = false;
            set({
              isStreaming: false,
              error: event.error || 'An error occurred',
            });
            break;
        }

        msgs[idx] = assistant;
        set({ messages: msgs });
      },
      (error) => {
        const state = get();
        const msgs = state.messages.map((m) =>
          m.id === assistantId ? { ...m, isStreaming: false } : m
        );
        set({
          messages: msgs,
          isStreaming: false,
          error: error.message || 'Connection failed',
        });
      },
      controller.signal
    );

    if (activeAbortController === controller) {
      activeAbortController = null;
    }
  },

  stopStreaming: () => {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    const state = get();
    const msgs = state.messages.map((m) =>
      m.isStreaming ? { ...m, isStreaming: false } : m
    );
    set({ messages: msgs, isStreaming: false });
  },
}));
