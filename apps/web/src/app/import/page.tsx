"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

export default function ImportPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/sync/import`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `Import failed: ${res.status}`);
      }
      return res.json() as Promise<ImportResult>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sync-status"] });
      queryClient.invalidateQueries({ queryKey: ["sync-log"] });
      queryClient.invalidateQueries({ queryKey: ["trades"] });
      queryClient.invalidateQueries({ queryKey: ["analytics-summary"] });
      queryClient.invalidateQueries({ queryKey: ["positions"] });
    },
  });

  const { data: syncStatus } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => apiFetch<SyncState>("/api/sync/status"),
    refetchInterval: 10_000,
  });

  const { data: syncLog } = useQuery({
    queryKey: ["sync-log"],
    queryFn: () => apiFetch<SyncLogEntry[]>("/api/sync/log"),
  });

  function selectFile(file: File) {
    if (!file.name.endsWith(".xlsx")) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    if (fileRef.current) {
      fileRef.current.files = dt.files;
    }
    setFileName(file.name);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setFileName(file.name);
  }

  function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (file) importMutation.mutate(file);
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) selectFile(file);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Import Transactions</h2>
        <p className="text-sm text-gray-500">
          Upload IBI Excel exports (.xlsx) to import transactions into your portfolio.
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
            Drag &amp; drop your .xlsx file here, or click to browse
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Re-uploading the same file is safe — duplicates are automatically skipped.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {/* Selected file + import button */}
        {fileName && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <span className="text-sm font-medium text-gray-700">{fileName}</span>
            </div>
            <button
              onClick={handleUpload}
              disabled={importMutation.isPending}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {importMutation.isPending ? "Importing..." : "Import"}
            </button>
          </div>
        )}

        {/* Success feedback */}
        {importMutation.isSuccess && importMutation.data && (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm">
            <p className="font-medium text-green-800">
              Import {importMutation.data.status}: {importMutation.data.imported} of{" "}
              {importMutation.data.totalRows} records imported
              {importMutation.data.skipped > 0 && `, ${importMutation.data.skipped} skipped`}
            </p>
            {importMutation.data.errors.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-yellow-700">
                {importMutation.data.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Error feedback */}
        {importMutation.isError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            Import failed: {importMutation.error?.message || "Unknown error"}
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
