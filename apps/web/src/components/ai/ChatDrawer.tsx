"use client";

import { useEffect, useRef } from "react";
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

  if (!isOpen) return null;

  const showQuickActions = messages.length === 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 md:hidden"
        onClick={close}
      />

      {/* Drawer */}
      <div className="fixed bottom-0 right-0 top-0 z-50 flex w-full flex-col border-l border-gray-200 bg-gray-50 shadow-xl md:w-[400px]">
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Takumi AI</h3>
            {activeConversationId && (
              <span className="text-xs text-gray-400">
                {conversations.find((c) => c.id === activeConversationId)
                  ?.title || "Chat"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* New conversation */}
            <button
              onClick={startNewConversation}
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title="New conversation"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4"
              >
                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
              </svg>
            </button>
            {/* Close */}
            <button
              onClick={close}
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title="Close chat"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4"
              >
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Conversation list (when no active conversation and no messages) */}
        {!activeConversationId && messages.length === 0 && conversations.length > 0 && (
          <div className="border-b border-gray-200 bg-white">
            <div className="px-3 py-2">
              <p className="text-xs font-medium text-gray-500">
                Recent Conversations
              </p>
            </div>
            <div className="max-h-40 overflow-y-auto">
              {conversations.slice(0, 5).map((conv) => (
                <div
                  key={conv.id}
                  className="group flex items-center justify-between px-3 py-2 hover:bg-gray-50"
                >
                  <button
                    onClick={() => setActiveConversation(conv.id)}
                    className="flex-1 text-left text-xs text-gray-700 truncate"
                  >
                    {conv.title || "Untitled"}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(conv.id);
                    }}
                    className="hidden rounded p-1 text-gray-400 hover:text-red-500 group-hover:block"
                    title="Delete"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className="h-3 w-3"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {showQuickActions ? (
            <div className="flex h-full flex-col items-center justify-center">
              <div className="mb-4 text-center">
                <p className="text-sm font-medium text-gray-700">
                  Ask me anything about your portfolio
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  I can analyze your trades, positions, and performance
                </p>
              </div>
              <QuickActions onSelect={sendMessage} disabled={isStreaming} />
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {error && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                  {error}
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
