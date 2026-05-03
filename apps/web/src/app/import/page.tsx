"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { formatDate } from "@/lib/formatters";
import type { SyncState, SyncLogEntry } from "@takumi/types";

interface ImportResult {
  status: string;
  totalRows: number;
  imported: number;
  skipped: number;
  errors: string[];
}

type FileStatus = "queued" | "uploading" | "success" | "failed";

interface FileEntry {
  id: string;
  file: File;
  status: FileStatus;
  result?: ImportResult;
  error?: string;
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function ImportPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const { data: syncStatus } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => apiFetch<SyncState>("/api/sync/status"),
    refetchInterval: 10_000,
  });

  const { data: syncLog } = useQuery({
    queryKey: ["sync-log"],
    queryFn: () => apiFetch<SyncLogEntry[]>("/api/sync/log"),
  });

  const addFiles = useCallback((files: FileList | File[]) => {
    const fresh: FileEntry[] = [];
    for (const file of Array.from(files)) {
      if (!file.name.endsWith(".xlsx")) continue;
      fresh.push({ id: makeId(), file, status: "queued" });
    }
    if (fresh.length === 0) return;
    setEntries((prev) => [...prev, ...fresh]);
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    // Reset so re-selecting the same file fires onChange again
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function clearCompleted() {
    setEntries((prev) => prev.filter((e) => e.status !== "success"));
  }

  async function uploadOne(file: File): Promise<ImportResult> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/sync/import`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((body as { error?: string }).error || `Import failed: ${res.status}`);
    }
    return body as ImportResult;
  }

  async function handleUpload() {
    const queued = entries.filter((e) => e.status === "queued" || e.status === "failed");
    if (queued.length === 0 || isImporting) return;

    setIsImporting(true);
    try {
      for (const entry of queued) {
        setEntries((prev) =>
          prev.map((e) =>
            e.id === entry.id ? { ...e, status: "uploading", error: undefined, result: undefined } : e
          )
        );
        try {
          const result = await uploadOne(entry.file);
          setEntries((prev) =>
            prev.map((e) =>
              e.id === entry.id ? { ...e, status: "success", result } : e
            )
          );
        } catch (err) {
          setEntries((prev) =>
            prev.map((e) =>
              e.id === entry.id
                ? { ...e, status: "failed", error: err instanceof Error ? err.message : String(err) }
                : e
            )
          );
        }
      }
    } finally {
      setIsImporting(false);
      queryClient.invalidateQueries({ queryKey: ["sync-status"] });
      queryClient.invalidateQueries({ queryKey: ["sync-log"] });
      queryClient.invalidateQueries({ queryKey: ["trades"] });
      queryClient.invalidateQueries({ queryKey: ["analytics-summary"] });
      queryClient.invalidateQueries({ queryKey: ["positions"] });
    }
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const pendingCount = entries.filter((e) => e.status === "queued" || e.status === "failed").length;
  const successCount = entries.filter((e) => e.status === "success").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Import Transactions</h2>
        <p className="text-sm text-gray-500">
          Upload IBI Excel exports (.xlsx) to import transactions into your portfolio. You can select multiple files at once.
        </p>
      </div>

      {/* Import drop zone */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 transition-colors ${
            isDragging
              ? "border-blue-400 bg-blue-50"
              : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
          }`}
        >
          <svg
            className={`mb-3 h-10 w-10 ${isDragging ? "text-blue-500" : "text-gray-400"}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
            />
          </svg>
          <p className="text-sm font-medium text-gray-700">
            Drag &amp; drop one or more .xlsx files here, or click to browse
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Re-uploading the same file is safe — duplicates are automatically skipped.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {/* Selected file list */}
        {entries.length > 0 && (
          <div className="mt-4 space-y-2">
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-gray-50">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FileStatusIcon status={entry.status} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-700" title={entry.file.name}>
                        {entry.file.name}
                      </p>
                      {entry.status === "success" && entry.result && (
                        <p className="text-xs text-green-700">
                          {entry.result.status}: {entry.result.imported} of {entry.result.totalRows} imported
                          {entry.result.skipped > 0 && `, ${entry.result.skipped} skipped`}
                        </p>
                      )}
                      {entry.status === "failed" && entry.error && (
                        <p className="text-xs text-red-700">{entry.error}</p>
                      )}
                      {entry.status === "uploading" && (
                        <p className="text-xs text-blue-700">Uploading…</p>
                      )}
                      {entry.status === "queued" && (
                        <p className="text-xs text-gray-500">Queued</p>
                      )}
                    </div>
                  </div>
                  {entry.status !== "uploading" && (
                    <button
                      onClick={() => removeEntry(entry.id)}
                      disabled={isImporting}
                      className="text-xs font-medium text-gray-500 hover:text-red-600 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="text-xs text-gray-500">
                {entries.length} file{entries.length === 1 ? "" : "s"} selected
                {successCount > 0 && ` · ${successCount} imported`}
                {pendingCount > 0 && ` · ${pendingCount} pending`}
              </div>
              <div className="flex items-center gap-2">
                {successCount > 0 && (
                  <button
                    onClick={clearCompleted}
                    disabled={isImporting}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Clear completed
                  </button>
                )}
                <button
                  onClick={handleUpload}
                  disabled={isImporting || pendingCount === 0}
                  className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isImporting
                    ? "Importing…"
                    : pendingCount > 1
                      ? `Import ${pendingCount} files`
                      : "Import"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Per-file errors detail */}
        {entries.some((e) => e.status === "success" && e.result && e.result.errors.length > 0) && (
          <div className="mt-4 space-y-2">
            {entries
              .filter((e) => e.status === "success" && e.result && e.result.errors.length > 0)
              .map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm"
                >
                  <p className="font-medium text-yellow-800">{entry.file.name} — warnings</p>
                  <ul className="mt-1 list-disc pl-5 text-yellow-700">
                    {entry.result!.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Last import status */}
      {syncStatus?.lastSyncAt && (
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Last import:</span>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                  syncStatus.lastStatus === "success"
                    ? "bg-green-100 text-green-700"
                    : syncStatus.lastStatus === "failed"
                      ? "bg-red-100 text-red-700"
                      : "bg-yellow-100 text-yellow-700"
                }`}
              >
                {syncStatus.lastStatus}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Time: </span>
              <span className="font-medium text-gray-900">
                {new Date(syncStatus.lastSyncAt).toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Records: </span>
              <span className="font-medium text-gray-900">{syncStatus.recordsAdded ?? 0}</span>
            </div>
          </div>
        </div>
      )}

      {/* Import history */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="mb-3 text-lg font-semibold">Import History</h3>
        {!syncLog?.length ? (
          <p className="text-gray-400">No imports yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {["Time", "File", "Status", "Records", "Date Range", "Error"].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {syncLog.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-2 text-sm">
                      {new Date(entry.syncedAt).toLocaleString()}
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-2 text-sm text-gray-600" title={entry.fileName ?? undefined}>
                      {entry.fileName || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          entry.status === "success"
                            ? "bg-green-100 text-green-700"
                            : entry.status === "failed"
                              ? "bg-red-100 text-red-700"
                              : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm">
                      {entry.recordsAdded}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-500">
                      {formatDate(entry.dateFrom)} — {formatDate(entry.dateTo)}
                    </td>
                    <td className="px-4 py-2 text-sm text-red-600">
                      {entry.errorMessage || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function FileStatusIcon({ status }: { status: FileStatus }) {
  if (status === "success") {
    return (
      <svg className="h-5 w-5 shrink-0 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg className="h-5 w-5 shrink-0 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  }
  if (status === "uploading") {
    return (
      <svg className="h-5 w-5 shrink-0 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
    );
  }
  return (
    <svg className="h-5 w-5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}
