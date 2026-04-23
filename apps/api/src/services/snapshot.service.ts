/**
 * Portfolio Snapshot Service — captures daily portfolio state for equity curve.
 *
 * - Auto-captures once per day after 17:00 IST (after TASE market close)
 * - Manual capture via API endpoint
 * - Stores total value, cost basis, unrealized P&L, realized P&L, positions JSON
 */

import { prisma } from '../lib/db.js';
import { getOpenPositions } from './position.service.js';
import { getPortfolioSummary } from './pnl.service.js';
import type { PortfolioSnapshotData } from '@takumi/types';

/**
 * Capture a portfolio snapshot for today.
 * Uses live market prices via position.service.
 */
export async function captureSnapshot(userId: string): Promise<PortfolioSnapshotData> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check if we already have a snapshot for today (per-user)
  const existing = await prisma.portfolioSnapshot.findUnique({
    where: { userId_date: { userId, date: today } },
  });
  if (existing) {
    return mapSnapshot(existing);
  }

  const [positions, summary] = await Promise.all([
    getOpenPositions(userId),
    getPortfolioSummary(userId),
  ]);

  // Totals are stored in ILS (home currency) so the equity curve is coherent
  // across TASE and US positions. Summing native marketValue across ILS+USD
  // would double-count USD positions' magnitude (1 USD ≈ 3.7 ILS).
  const totalValue = positions.reduce((sum, p) => sum + p.marketValueIls, 0);
  const totalCostBasis = positions.reduce((sum, p) => sum + p.totalCostIls, 0);
  const unrealizedPnl = totalValue - totalCostBasis;

  const snapshot = await prisma.portfolioSnapshot.create({
    data: {
      userId,
      date: today,
      totalValue,
      totalCostBasis,
      unrealizedPnl,
      realizedPnl: summary.totalRealizedPnl,
      positionCount: positions.length,
      snapshotData: JSON.stringify({
        positions: positions.map((p) => ({
          ticker: p.ticker,
          quantity: p.quantity,
          avgCostBasis: p.avgCostBasis,
          currentPrice: p.currentPrice,
          marketValue: p.marketValue,
          marketValueIls: p.marketValueIls,
          unrealizedPnl: p.unrealizedPnl,
          priceSource: p.priceSource,
          currency: p.currency,
        })),
        pnlByCurrency: summary.pnlByCurrency,
      }),
    },
  });

  return mapSnapshot(snapshot);
}

/**
 * Get portfolio snapshots for a date range.
 * Used for rendering the equity curve chart.
 */
export async function getSnapshots(
  userId: string,
  from?: Date,
  to?: Date
): Promise<PortfolioSnapshotData[]> {
  const where: Record<string, unknown> = { userId };
  if (from || to) {
    where.date = {};
    if (from) (where.date as Record<string, Date>).gte = from;
    if (to) (where.date as Record<string, Date>).lte = to;
  }

  const snapshots = await prisma.portfolioSnapshot.findMany({
    where,
    orderBy: { date: 'asc' },
  });

  return snapshots.map(mapSnapshot);
}

/**
 * Get the latest snapshot for a user.
 */
export async function getLatestSnapshot(
  userId: string
): Promise<PortfolioSnapshotData | null> {
  const snapshot = await prisma.portfolioSnapshot.findFirst({
    where: { userId },
    orderBy: { date: 'desc' },
  });
  return snapshot ? mapSnapshot(snapshot) : null;
}

/**
 * Auto-capture if past 17:00 IST and no snapshot for today.
 * Call this from API endpoints (positions, analytics) as a side effect.
 */
export async function maybeCaptureDaily(userId: string): Promise<void> {
  const now = new Date();
  // Convert to IST (UTC+2/+3). Israel is UTC+2 in winter, UTC+3 in summer.
  // We'll use a simple check: if it's past 15:00 UTC (which is 17:00 IST or 18:00 IDT)
  if (now.getUTCHours() < 15) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const existing = await prisma.portfolioSnapshot.findUnique({
    where: { userId_date: { userId, date: today } },
  });
  if (existing) return;

  try {
    await captureSnapshot(userId);
    console.log(`[snapshot] Auto-captured daily snapshot for user=${userId}`);
  } catch (err) {
    console.error('[snapshot] Auto-capture failed:', err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSnapshot(s: any): PortfolioSnapshotData {
  return {
    id: s.id,
    date: s.date instanceof Date ? s.date.toISOString() : s.date,
    totalValue: Number(s.totalValue),
    totalCostBasis: Number(s.totalCostBasis),
    unrealizedPnl: Number(s.unrealizedPnl),
    realizedPnl: Number(s.realizedPnl),
    positionCount: s.positionCount,
    snapshotData: s.snapshotData ? JSON.parse(s.snapshotData) : null,
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
  };
}
