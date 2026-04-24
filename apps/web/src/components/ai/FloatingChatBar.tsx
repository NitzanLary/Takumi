"use client";

import { useEffect, useRef, useState } from "react";
import { useChatStore } from "@/stores/chat-store";

const ROTATING_PLACEHOLDERS = [
  "Ask Takumi about your portfolio…",
  "How am I performing this year?",
  "What's my best position right now?",
  "Any bad habits I should watch?",
  "Compare my returns to the S&P 500",
  "Summarize my dividend income",
];

const ROTATE_INTERVAL_MS = 3500;

export function FloatingChatBar() {
  const isOpen = useChatStore((s) => s.isOpen);
  const open = useChatStore((s) => s.open);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const isStreaming = useChatStore((s) => s.isStreaming);

  const [value, setValue] = useState("");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Trigger entry animation on mount
  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 80);
    return () => window.clearTimeout(t);
  }, []);

  // Rotate placeholders — pause while user has typed something
  useEffect(() => {
    if (value.length > 0) return;
    const id = window.setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % ROTATING_PLACEHOLDERS.length);
    }, ROTATE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [value]);

  // Keyboard shortcut: ⌘K / Ctrl+K focuses the bar
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    open();
    sendMessage(trimmed);
    setValue("");
    inputRef.current?.blur();
  }

  function handleOpenOnly() {
    open();
  }

  // Hide when drawer is open — drawer has its own input
  if (isOpen) return null;

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-4 transition-all duration-500 sm:px-6 sm:pb-6 ${
        mounted ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      }`}
    >
      <form
        onSubmit={handleSubmit}
        className="pointer-events-auto group relative w-full max-w-2xl"
      >
        {/* Soft gradient glow */}
        <div
          aria-hidden="true"
          className="absolute -inset-px rounded-full bg-gradient-to-r from-blue-500/30 via-indigo-500/30 to-violet-500/30 opacity-70 blur-md transition-opacity duration-300 group-focus-within:opacity-100 group-hover:opacity-100"
        />

        {/* Bar body */}
        <div className="relative flex items-center gap-3 rounded-full border border-gray-200 bg-white/90 px-4 py-2.5 shadow-xl shadow-blue-900/10 backdrop-blur-md transition-all duration-300 group-focus-within:border-blue-300 group-focus-within:shadow-blue-500/20">
          {/* AI sparkle icon */}
          <button
            type="button"
            onClick={handleOpenOnly}
            className="relative flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 text-white shadow-sm transition-transform hover:scale-105"
            aria-label="Open Takumi AI"
            title="Open Takumi AI"
          >
            <SparkleIcon className="h-4 w-4" />
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-400 to-violet-400 opacity-60 blur-md"
            />
          </button>

          {/* Input + rotating placeholder */}
          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onClick={(e) => {
                // Clicking anywhere on the input keeps typing-in-place UX;
                // only auto-open the drawer when the user hits Enter.
                e.stopPropagation();
              }}
              placeholder={ROTATING_PLACEHOLDERS[placeholderIdx]}
              className="w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
              aria-label="Ask Takumi AI"
            />
          </div>

          {/* Keyboard shortcut hint (hidden on mobile) */}
          <kbd className="hidden select-none items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 sm:flex">
            <span className="text-[11px]">⌘</span>
            <span>K</span>
          </kbd>

          {/* Send button */}
          <button
            type="submit"
            disabled={!value.trim() || isStreaming}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm transition-all hover:from-blue-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:from-gray-300 disabled:to-gray-300 disabled:shadow-none"
            aria-label="Send message"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-3.5 w-3.5"
            >
              <path d="M3.105 2.29a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.897 28.897 0 0015.293-7.155.75.75 0 000-1.114A28.897 28.897 0 003.105 2.289z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
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
