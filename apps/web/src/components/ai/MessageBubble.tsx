"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage, ToolCallInfo } from "@/stores/chat-store";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-2.5 text-sm text-white">
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] space-y-2">
        {/* Tool calls */}
        {message.toolCalls.length > 0 && (
          <div className="space-y-1">
            {message.toolCalls.map((tc, i) => (
              <ToolCallIndicator key={i} toolCall={tc} />
            ))}
          </div>
        )}

        {/* Text content */}
        {message.content && (
          <div className="rounded-2xl rounded-bl-md bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm ring-1 ring-gray-200">
            <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:mb-1 prose-headings:mt-2 prose-table:my-1 prose-pre:my-1">
              <ReactMarkdown>{message.content}</ReactMarkdown>
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

  return (
    <div className="rounded-lg bg-gray-50 text-xs ring-1 ring-gray-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
      >
        {toolCall.status === "running" ? (
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        ) : (
          <span className="text-green-600">&#10003;</span>
        )}
        <span className="text-gray-600">
          {toolCall.status === "running"
            ? `Running ${toolDisplayName}...`
            : toolDisplayName}
        </span>
        <span className="ml-auto text-gray-400">
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </button>

      {expanded && toolCall.result != null ? (
        <div className="max-h-40 overflow-auto border-t border-gray-200 px-3 py-2">
          <pre className="whitespace-pre-wrap text-[11px] text-gray-500">
            {typeof toolCall.result === "string"
              ? toolCall.result
              : JSON.stringify(toolCall.result, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
