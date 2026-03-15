import { prisma } from "../lib/db.js";
import { config } from "../lib/config.js";

let isSyncing = false;

async function ensureAuthenticated(): Promise<void> {
  const healthRes = await fetch(`${config.ibiSyncUrl}/health`);
  if (!healthRes.ok) {
    throw new Error("IBI sync service is not reachable");
  }
  const health = (await healthRes.json()) as { authenticated: boolean };
  if (health.authenticated) return;

  console.log("[sync] Sidecar not authenticated — triggering auth bootstrap...");
  const authRes = await fetch(`${config.ibiSyncUrl}/auth/bootstrap`, {
    method: "POST",
  });
  if (!authRes.ok) {
    const detail = await authRes.text();
    throw new Error(`Auth bootstrap failed: ${detail}`);
  }
  console.log("[sync] Auth bootstrap completed successfully");
}

export async function triggerSync() {
  if (isSyncing) {
    return { message: "Sync already in progress", isRunning: true };
  }

  isSyncing = true;
  const dateFrom = await getLastSyncDate();
  const dateTo = new Date();

  try {
    await ensureAuthenticated();

    const response = await fetch(`${config.ibiSyncUrl}/sync/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_date: dateFrom.toISOString(),
        end_date: dateTo.toISOString(),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `IBI sync service returned ${response.status}${detail ? `: ${detail}` : ""}`
      );
    }

    const result = (await response.json()) as {
      transactions: IbiTransaction[];
    };
    const transactions = result.transactions || [];

    let recordsAdded = 0;
    for (const tx of transactions) {
      try {
        await prisma.trade.upsert({
          where: {
            tradeId_source: {
              tradeId: tx.trade_id,
              source: "ibi_api",
            },
          },
          update: {},
          create: {
            tradeId: tx.trade_id,
            ticker: tx.ticker,
            securityName: tx.security_name,
            market: tx.market,
            direction: tx.direction,
            quantity: tx.quantity,
            price: tx.price,
            currency: tx.currency,
            commission: tx.commission || 0,
            tradeDate: new Date(tx.trade_date),
            source: "ibi_api",
            rawPayload: JSON.stringify(tx.raw),
          },
        });
        recordsAdded++;
      } catch {
        // Duplicate — skip
      }
    }

    await prisma.syncLog.create({
      data: {
        status: "success",
        recordsAdded,
        dateFrom,
        dateTo,
      },
    });

    return { status: "success", recordsAdded, isRunning: false };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown sync error";
    await prisma.syncLog.create({
      data: {
        status: "failed",
        recordsAdded: 0,
        dateFrom,
        dateTo,
        errorMessage: message,
      },
    });
    return { status: "failed", error: message, isRunning: false };
  } finally {
    isSyncing = false;
  }
}

export async function getSyncStatus() {
  const lastSync = await prisma.syncLog.findFirst({
    orderBy: { syncedAt: "desc" },
  });

  return {
    lastSyncAt: lastSync?.syncedAt?.toISOString() ?? null,
    lastStatus: lastSync?.status ?? null,
    recordsAdded: lastSync?.recordsAdded ?? 0,
    isRunning: isSyncing,
  };
}

export async function getSyncLog(limit = 20) {
  return prisma.syncLog.findMany({
    orderBy: { syncedAt: "desc" },
    take: limit,
  });
}

async function getLastSyncDate(): Promise<Date> {
  const lastSync = await prisma.syncLog.findFirst({
    where: { status: "success", recordsAdded: { gt: 0 } },
    orderBy: { syncedAt: "desc" },
  });

  if (lastSync) {
    return lastSync.dateTo;
  }

  // Default: 3 years ago for initial sync
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  return threeYearsAgo;
}

interface IbiTransaction {
  trade_id: string;
  ticker: string;
  security_name: string;
  market: string;
  direction: string;
  quantity: number;
  price: number;
  currency: string;
  commission?: number;
  trade_date: string;
  raw?: Record<string, unknown>;
}
