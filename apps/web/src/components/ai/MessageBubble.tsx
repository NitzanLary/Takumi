"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, ToolCallInfo } from "@/stores/chat-store";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-blue-600 to-indigo-600 px-4 py-2.5 text-sm text-white shadow-md shadow-indigo-500/20">
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant message
  const showTypingIndicator =
    message.isStreaming &&
    !message.content &&
    message.toolCalls.length === 0;

  return (
    <div className="flex justify-start gap-2">
      {/* AI avatar */}
      <div className="flex-none pt-0.5">
        <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 text-white shadow-sm">
          <SparkleIcon className="h-3.5 w-3.5" />
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-lg bg-gradient-to-br from-blue-400 to-violet-400 opacity-40 blur-sm"
          />
        </div>
      </div>

      <div className="min-w-0 max-w-[85%] space-y-2">
        {/* Tool calls */}
        {message.toolCalls.length > 0 && (
          <div className="space-y-1">
            {message.toolCalls.map((tc, i) => (
              <ToolCallIndicator key={i} toolCall={tc} />
            ))}
          </div>
        )}

        {/* Typing indicator — visible from send until first chunk arrives */}
        {showTypingIndicator && (
          <div className="inline-flex rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
            </div>
          </div>
        )}

        {/* Text content */}
        {message.content && (
          <div className="rounded-2xl rounded-bl-md bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm ring-1 ring-slate-200">
            <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:mb-1 prose-headings:mt-2 prose-table:my-1 prose-pre:my-1 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:font-normal prose-code:text-slate-700 prose-code:before:content-none prose-code:after:content-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  table: ({ children }) => (
                    <div className="-mx-1 my-1 overflow-x-auto">
                      <table className="w-full border-collapse text-xs">
                        {children}
                      </table>
                    </div>
                  ),
                  th: ({ children }) => (
                    <th className="border-b border-slate-300 px-2 py-1 text-left font-semibold">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border-b border-slate-100 px-2 py-1 align-top">
                      {children}
                    </td>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolCallIndicator({ toolCall }: { toolCall: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);

  const toolDisplayName = toolCall.name
    .replace(/^get_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const isRunning = toolCall.status === "running";

  return (
    <div className="overflow-hidden rounded-lg bg-slate-50/80 text-xs ring-1 ring-slate-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-slate-100"
      >
        {isRunning ? (
          <span className="relative flex h-3 w-3 flex-none">
            <span className="absolute inset-0 animate-ping rounded-full bg-blue-400 opacity-60" />
            <span className="relative h-3 w-3 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500" />
          </span>
        ) : (
          <span className="flex h-3 w-3 flex-none items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-white">
            ✓
          </span>
        )}
        <span className={isRunning ? "text-slate-600" : "text-slate-500"}>
          {isRunning ? `Running ${toolDisplayName}…` : toolDisplayName}
        </span>
        <span className="ml-auto text-slate-400">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && toolCall.result != null ? (
        <div className="max-h-40 overflow-auto border-t border-slate-200 bg-white px-3 py-2">
          <pre className="whitespace-pre-wrap text-[11px] text-slate-500">
            {typeof toolCall.result === "string"
              ? toolCall.result
              : JSON.stringify(toolCall.result, null, 2)}
          </pre>
        </div>
      ) : null}
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
