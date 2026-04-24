"use client";

import { useEffect, useRef, useState } from "react";
import { useChatStore } from "@/stores/chat-store";
import { MessageBubble } from "./MessageBubble";
import { ChatInput } from "./ChatInput";
import { QuickActions } from "./QuickActions";

export function ChatDrawer() {
  const {
    isOpen,
    close,
    messages,
    isStreaming,
    error,
    sendMessage,
    stopStreaming,
    conversations,
    activeConversationId,
    loadConversations,
    setActiveConversation,
    deleteConversation,
    startNewConversation,
  } = useChatStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasLoadedRef = useRef(false);
  const [mounted, setMounted] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Drive the open/close slide animation
  useEffect(() => {
    if (isOpen) {
      const t = window.setTimeout(() => setMounted(true), 20);
      return () => window.clearTimeout(t);
    }
    setMounted(false);
  }, [isOpen]);

  // Load conversations on first open
  useEffect(() => {
    if (isOpen && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      loadConversations();
    }
  }, [isOpen, loadConversations]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Close history panel whenever active conversation changes
  useEffect(() => {
    setShowHistory(false);
  }, [activeConversationId, messages.length]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  if (!isOpen) return null;

  const showEmptyState = messages.length === 0;
  const activeTitle = conversations.find((c) => c.id === activeConversationId)?.title;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm transition-opacity duration-300 md:hidden ${
          mounted ? "opacity-100" : "opacity-0"
        }`}
        onClick={close}
      />

      {/* Drawer */}
      <div
        className={`fixed bottom-0 right-0 top-0 z-50 flex w-full flex-col border-l border-slate-200 bg-gradient-to-b from-white via-white to-slate-50 shadow-2xl shadow-slate-900/10 transition-transform duration-300 ease-out md:w-[420px] ${
          mounted ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Branded header */}
        <div className="relative flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 text-white shadow-sm">
              <SparkleIcon className="h-4 w-4" />
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-xl bg-gradient-to-br from-blue-400 to-violet-400 opacity-50 blur-md"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="truncate text-sm font-semibold text-slate-900">
                  Takumi AI
                </h3>
                <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
              </div>
              <p className="truncate text-xs text-slate-500">
                {activeTitle || "Your portfolio co-pilot"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <HeaderButton
              onClick={() => setShowHistory((v) => !v)}
              title="Conversation history"
              active={showHistory}
            >
              <HistoryIcon className="h-4 w-4" />
            </HeaderButton>
            <HeaderButton onClick={startNewConversation} title="New conversation">
              <PlusIcon className="h-4 w-4" />
            </HeaderButton>
            <HeaderButton onClick={close} title="Close chat">
              <CloseIcon className="h-4 w-4" />
            </HeaderButton>
          </div>
        </div>

        {/* Conversation history panel */}
        {showHistory && (
          <div className="border-b border-slate-200 bg-white">
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Recent
              </p>
              {conversations.length > 5 && (
                <span className="text-[11px] text-slate-400">
                  {conversations.length} total
                </span>
              )}
            </div>
            <div className="max-h-56 overflow-y-auto px-2 pb-2">
              {conversations.length === 0 ? (
                <p className="px-2 py-3 text-xs text-slate-400">
                  No past conversations yet.
                </p>
              ) : (
                conversations.slice(0, 10).map((conv) => {
                  const isActive = conv.id === activeConversationId;
                  return (
                    <div
                      key={conv.id}
                      className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${
                        isActive
                          ? "bg-blue-50 text-blue-700"
                          : "hover:bg-slate-50 text-slate-700"
                      }`}
                    >
                      <button
                        onClick={() => setActiveConversation(conv.id)}
                        className="flex-1 truncate text-left text-xs"
                      >
                        {conv.title || "Untitled"}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteConversation(conv.id);
                        }}
                        className="hidden rounded p-1 text-slate-400 hover:bg-white hover:text-red-500 group-hover:block"
                        title="Delete"
                      >
                        <TrashIcon className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto">
          {showEmptyState ? (
            <EmptyState onSelect={sendMessage} disabled={isStreaming} />
          ) : (
            <div className="space-y-4 px-4 py-5">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
                  <span>{error}</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <ChatInput
          onSend={sendMessage}
          disabled={isStreaming}
          onStop={stopStreaming}
        />
      </div>
    </>
  );
}

function EmptyState({
  onSelect,
  disabled,
}: {
  onSelect: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-8 pb-4 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/30">
          <SparkleIcon className="h-6 w-6" />
        </div>
        <h4 className="text-base font-semibold text-slate-900">
          How can I help today?
        </h4>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          I can analyze your trades, positions, risk exposure, and performance —
          all scoped to your portfolio.
        </p>
      </div>
      <QuickActions onSelect={onSelect} disabled={disabled} />
    </div>
  );
}

function HeaderButton({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`rounded-lg p-1.5 transition-colors ${
        active
          ? "bg-blue-50 text-blue-600"
          : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2.25a.75.75 0 0 1 .707.495l1.51 4.153a4.5 4.5 0 0 0 2.685 2.685l4.153 1.51a.75.75 0 0 1 0 1.414l-4.153 1.51a4.5 4.5 0 0 0-2.685 2.685l-1.51 4.153a.75.75 0 0 1-1.414 0l-1.51-4.153a4.5 4.5 0 0 0-2.685-2.685l-4.153-1.51a.75.75 0 0 1 0-1.414l4.153-1.51a4.5 4.5 0 0 0 2.685-2.685l1.51-4.153A.75.75 0 0 1 12 2.25Z" />
    </svg>
  );
}

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 10a7 7 0 1 0 2.05-4.95" />
      <path d="M3 4v4h4" />
      <path d="M10 6v4l2.5 1.5" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
