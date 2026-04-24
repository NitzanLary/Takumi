"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { useUiStore } from "@/stores/ui-store";
import { useCurrentUser } from "@/components/UserProvider";
import type { SyncState } from "@takumi/types";

export function TopBar() {
  const { user, logout } = useCurrentUser();

  const { data: syncStatus } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => apiFetch<SyncState>("/api/sync/status"),
    refetchInterval: 30_000,
    enabled: !!user,
  });

  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-3 md:px-6">
      <div className="flex items-center gap-2">
        <button
          onClick={toggleSidebar}
          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 md:hidden"
          title="Open menu"
          aria-label="Open menu"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-5 w-5"
          >
            <path
              fillRule="evenodd"
              d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 5A.75.75 0 012.75 9h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 9.75zm0 5A.75.75 0 012.75 14h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
      <div className="flex items-center gap-2 sm:gap-4">
        <SyncIndicator syncStatus={syncStatus} />
        {user && <UserMenu email={user.email} displayName={user.displayName} onLogout={logout} />}
      </div>
    </header>
  );
}

function UserMenu({ email, displayName, onLogout }: { email: string; displayName: string | null; onLogout: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initial = (displayName || email)[0].toUpperCase();

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-xs font-semibold text-white hover:bg-teal-700"
        title={email}
        aria-label="Account menu"
      >
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-56 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          <div className="border-b border-gray-100 px-3 py-2 text-xs text-gray-500">
            <div className="truncate font-medium text-gray-700">{displayName || email.split("@")[0]}</div>
            <div className="truncate">{email}</div>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function SyncIndicator({ syncStatus }: { syncStatus?: SyncState }) {
  if (!syncStatus) {
    return (
      <span className="hidden text-xs text-gray-400 sm:inline">
        Checking sync status...
      </span>
    );
  }

  if (syncStatus.isRunning) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-blue-600">
        <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
        <span className="hidden sm:inline">Importing...</span>
      </span>
    );
  }

  const statusColor =
    syncStatus.lastStatus === "success"
      ? "bg-green-500"
      : syncStatus.lastStatus === "failed"
        ? "bg-red-500"
        : "bg-gray-400";

  const statusTextColor =
    syncStatus.lastStatus === "success"
      ? "text-green-600"
      : syncStatus.lastStatus === "failed"
        ? "text-red-600"
        : "text-gray-500";

  const lastImport = syncStatus.lastSyncAt
    ? new Date(syncStatus.lastSyncAt).toLocaleString()
    : "Never";

  return (
    <>
      {/* Mobile: just the colored dot */}
      <span
        className={`h-2 w-2 rounded-full sm:hidden ${statusColor}`}
        title={`Last import: ${lastImport}`}
      />
      {/* Desktop: full label */}
      <span className={`hidden text-xs sm:inline ${statusTextColor}`}>
        Last import: {lastImport}
      </span>
    </>
  );
}
