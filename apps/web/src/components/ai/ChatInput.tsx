"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  onStop?: () => void;
}

export function ChatInput({ onSend, disabled, onStop }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus when drawer opens (component mounts)
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  };

  const canSend = !!value.trim() && !disabled;

  return (
    <div className="border-t border-slate-200 bg-white px-3 py-3">
      <div className="group relative">
        {/* Focus glow */}
        <div
          aria-hidden="true"
          className="absolute -inset-px rounded-2xl bg-gradient-to-r from-blue-500/20 via-indigo-500/20 to-violet-500/20 opacity-0 blur-md transition-opacity duration-300 group-focus-within:opacity-100"
        />
        <div className="relative flex items-end gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm transition-colors focus-within:border-blue-300">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Message Takumi AI…"
            disabled={disabled}
            rows={1}
            className="flex-1 resize-none bg-transparent py-1 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:opacity-60"
          />
          {disabled && onStop ? (
            <button
              onClick={onStop}
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-slate-800 text-white transition-colors hover:bg-slate-700"
              aria-label="Stop generating"
              title="Stop generating"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-3 w-3"
              >
                <rect x="5" y="5" width="10" height="10" rx="1.5" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm transition-all hover:from-blue-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 disabled:shadow-none"
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
          )}
        </div>
      </div>
      <p className="mt-1.5 px-1 text-[10px] text-slate-400">
        Enter to send · Shift+Enter for newline · Esc to close
      </p>
    </div>
  );
}
