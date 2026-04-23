import { prisma } from "../lib/db.js";

export async function getSyncStatus(userId: string) {
  const lastSync = await prisma.syncLog.findFirst({
    where: { userId },
    orderBy: { syncedAt: "desc" },
  });

  return {
    lastSyncAt: lastSync?.syncedAt?.toISOString() ?? null,
    lastStatus: lastSync?.status ?? null,
    recordsAdded: lastSync?.recordsAdded ?? 0,
    isRunning: false,
  };
}

export async function getSyncLog(userId: string, limit = 20) {
  return prisma.syncLog.findMany({
    where: { userId },
    orderBy: { syncedAt: "desc" },
    take: limit,
  });
}
