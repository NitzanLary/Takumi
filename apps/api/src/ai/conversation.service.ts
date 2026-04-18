/**
 * Conversation Service — CRUD for AI conversations and messages.
 */

import { prisma } from '../lib/db.js';

export interface SavedMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: unknown[];
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/**
 * Get an existing conversation or create a new one.
 * Returns the conversation ID and its message history.
 */
export async function getOrCreateConversation(id?: string) {
  if (id) {
    const conversation = await prisma.aiConversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (conversation) {
      return {
        id: conversation.id,
        isNew: false,
        messages: conversation.messages.map((m) => ({
          role: m.role as 'user' | 'assistant' | 'tool',
          content: m.content,
          toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
        })),
      };
    }
  }

  // Create new conversation
  const conversation = await prisma.aiConversation.create({
    data: {},
  });

  return { id: conversation.id, isNew: true, messages: [] as SavedMessage[] };
}

/**
 * Save messages to a conversation. Also sets the title if it's the first message.
 */
export async function saveMessages(
  conversationId: string,
  messages: SavedMessage[],
  setTitle?: string
) {
  const ops = messages.map((m) =>
    prisma.aiMessage.create({
      data: {
        conversationId,
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls ? JSON.stringify(m.toolCalls) : null,
      },
    })
  );

  if (setTitle) {
    ops.push(
      prisma.aiConversation.update({
        where: { id: conversationId },
        data: { title: setTitle },
      }) as any
    );
  }

  await prisma.$transaction(ops);
}

/**
 * List all conversations, newest first.
 */
export async function listConversations(): Promise<ConversationSummary[]> {
  const conversations = await prisma.aiConversation.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { messages: true } },
    },
  });

  return conversations.map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    messageCount: c._count.messages,
  }));
}

/**
 * Get a single conversation with all messages.
 */
export async function getConversation(id: string) {
  const conversation = await prisma.aiConversation.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!conversation) return null;

  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    messages: conversation.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : null,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

/**
 * Delete a conversation and all its messages.
 */
export async function deleteConversation(id: string): Promise<boolean> {
  try {
    await prisma.aiConversation.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}
