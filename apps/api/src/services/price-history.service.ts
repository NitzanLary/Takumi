/**
 * Price History Service — persistent cache of daily close prices.
 *
 * Backs the `price_history` table (shared across users). Historical closes
 * are immutable, so we use createMany({ skipDuplicates: true }) for upserts.
 * No UPDATE path needed.
 */

import { prisma } from '../lib/db.js';

export interface PriceHistoryRow {
  date: Date;
  close: number;
  source: string;
}

export async function readRange(
  ticker: string,
  from: Date,
  to: Date,
): Promise<PriceHistoryRow[]> {
  const rows = await prisma.priceHistory.findMany({
    where: { ticker, date: { gte: from, lte: to } },
    orderBy: { date: 'asc' },
    select: { date: true, close: true, source: true },
  });
  return rows.map((r) => ({
    date: r.date,
    close: Number(r.close),
    source: r.source,
  }));
}

export async function bulkInsert(
  ticker: string,
  rows: Array<{ date: Date; close: number; source: 'yahoo' | 'stooq' }>,
): Promise<{ inserted: number }> {
  if (rows.length === 0) return { inserted: 0 };
  const result = await prisma.priceHistory.createMany({
    data: rows.map((r) => ({
      ticker,
      date: r.date,
      close: r.close,
      source: r.source,
    })),
    skipDuplicates: true,
  });
  return { inserted: result.count };
}

export async function getLatestCachedDate(ticker: string): Promise<Date | null> {
  const row = await prisma.priceHistory.findFirst({
    where: { ticker },
    orderBy: { date: 'desc' },
    select: { date: true },
  });
  return row?.date ?? null;
}
