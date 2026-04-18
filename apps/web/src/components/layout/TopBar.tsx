"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { useChatStore } from "@/stores/chat-store";
import type { SyncState } from "@takumi/types";

export function TopBar() {
  const { data: syncStatus } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => apiFetch<SyncState>("/api/sync/status"),
    refetchInterval: 30_000,
  });

  const toggleChat = useChatStore((s) => s.toggle);
  const isChatOpen = useChatStore((s) => s.isOpen);

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div />
      <div className="flex items-center gap-4">
        <SyncIndicator syncStatus={syncStatus} />
        <button
          onClick={toggleChat}
          className={`rounded-lg p-2 transition-colors ${
            isChatOpen
              ? "bg-blue-100 text-blue-700"
              : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          }`}
          title="Toggle AI Chat"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-5 w-5"
          >
            <path
              fillRule="evenodd"
              d="M3.43 2.524A41.29 41.29 0 0110 2c2.236 0 4.43.18 6.57.524 1.437.231 2.43 1.49 2.43 2.902v5.148c0 1.413-.993 2.67-2.43 2.902a41.202 41.202 0 01-5.183.501.78.78 0 00-.528.224l-3.579 3.58A.75.75 0 016 17.25v-3.443a41.033 41.033 0 01-2.57-.33C2.993 13.244 2 11.986 2 10.574V5.426c0-1.413.993-2.67 2.43-2.902z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}

function SyncIndicator({ syncStatus }: { syncStatus?: SyncState }) {
  if (!syncStatus) {
    return (
      <span className="text-xs text-gray-400">Checking sync status...</span>
    );
  }

  if (syncStatus.isRunning) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-blue-600">
        <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
        Importing...
      </span>
    );
  }

  const lastImport = syncStatus.lastSyncAt
    ? new Date(syncStatus.lastSyncAt).toLocaleString()
    : "Never";

  const statusColor =
    syncStatus.lastStatus === "success"
      ? "text-green-600"
      : syncStatus.lastStatus === "failed"
        ? "text-red-600"
        : "text-gray-500";

  return (
    <span className={`text-xs ${statusColor}`}>
      Last import: {lastImport}
    </span>
  );
}
