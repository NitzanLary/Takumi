"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { SyncState } from "@takumi/types";

export default function DashboardPage() {
  const queryClient = useQueryClient();

  const { data: syncStatus } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => apiFetch<SyncState>("/api/sync/status"),
    refetchInterval: 30_000,
  });

  const syncMutation = useMutation({
    mutationFn: () => apiFetch("/api/sync/trigger", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sync-status"] });
      queryClient.invalidateQueries({ queryKey: ["trades"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
          {syncStatus?.lastSyncAt && (
            <p className="text-sm text-gray-500">
              Last sync: {new Date(syncStatus.lastSyncAt).toLocaleString()}
              {syncStatus.lastStatus === "success" && syncStatus.recordsAdded !== undefined && (
                <span className="ml-2 text-green-600">
                  ({syncStatus.recordsAdded} trades synced)
                </span>
              )}
              {syncStatus.lastStatus === "failed" && (
                <span className="ml-2 text-red-600">— failed</span>
              )}
            </p>
          )}
        </div>
        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending || syncStatus?.isRunning}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {syncMutation.isPending || syncStatus?.isRunning
            ? "Syncing..."
            : "Sync Now"}
        </button>
      </div>

      {syncMutation.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Sync failed: {syncMutation.error?.message || "Unknown error"}
        </div>
      )}

      {syncMutation.isSuccess && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Sync completed successfully
        </div>
      )}

      {/* KPI Cards placeholder */}
      <div className="grid grid-cols-4 gap-4">
        {["Total P&L", "Win Rate", "Total Trades", "Avg Return"].map(
          (label) => (
            <div
              key={label}
              className="rounded-xl border border-gray-200 bg-white p-5"
            >
              <p className="text-sm text-gray-500">{label}</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">—</p>
            </div>
          )
        )}
      </div>

      {/* Equity curve placeholder */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold">Equity Curve</h3>
        <div className="flex h-64 items-center justify-center text-gray-400">
          Chart will appear after first sync
        </div>
      </div>
    </div>
  );
}
