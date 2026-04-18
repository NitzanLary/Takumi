export type SyncStatus = "success" | "partial" | "failed";

export interface SyncLogEntry {
  id: number;
  syncedAt: string;
  status: SyncStatus;
  recordsAdded: number;
  dateFrom: string;
  dateTo: string;
  fileName?: string;
  errorMessage?: string;
}

export interface SyncState {
  lastSyncAt?: string;
  lastStatus?: SyncStatus;
  recordsAdded?: number;
  isRunning: boolean;
}
