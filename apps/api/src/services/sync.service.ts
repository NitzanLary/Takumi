import { prisma } from "../lib/db.js";

export async function getSyncStatus() {
  const lastSync = await prisma.syncLog.findFirst({
    orderBy: { syncedAt: "desc" },
  });

  return {
    lastSyncAt: lastSync?.syncedAt?.toISOString() ?? null,
    lastStatus: lastSync?.status ?? null,
    recordsAdded: lastSync?.recordsAdded ?? 0,
    isRunning: false,
  };
}

export async function getSyncLog(limit = 20) {
  return prisma.syncLog.findMany({
    orderBy: { syncedAt: "desc" },
    take: limit,
  });
}
