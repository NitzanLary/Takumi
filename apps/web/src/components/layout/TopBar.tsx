"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { SyncState } from "@takumi/types";

export function TopBar() {
  const { data: syncStatus } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => apiFetch<SyncState>("/api/sync/status"),
    refetchInterval: 30_000,
  });

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div />
      <div className="flex items-center gap-4">
        <SyncIndicator syncStatus={syncStatus} />
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
        Syncing...
      </span>
    );
  }

  const lastSync = syncStatus.lastSyncAt
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
      Last sync: {lastSync}
    </span>
  );
}
