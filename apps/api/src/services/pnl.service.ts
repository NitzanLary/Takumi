/**
 * P&L Engine — FIFO lot matching to calculate realized P&L per trade/ticker/portfolio.
 *
 * Groups all trades by ticker, sorts chronologically, and matches sells against
 * the oldest remaining buy lots (FIFO). Returns realized P&L per matched lot,
 * per ticker, and portfolio-wide. Also exposes unmatched buy lots for position derivation.
 */

import type { PnlWindow } from '@takumi/types';
import { prisma } from '../lib/db.js';
import { getCurrentRate } from './exchange-rate.service.js';
import { logger } from '../lib/logger.js';
import { matchFifoLots } from './pnl-matching.js';
import type { MatchedLot, OpenLot } from './pnl-matching.js';
export type { MatchedLot, OpenLot } from './pnl-matching.js';

export interface TickerPnl {
  ticker: string;
  securityName: string;
  market: string;
  currency: string;
  realizedPnl: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgHoldingDays: number;
  totalBuyQty: number;
  totalSellQty: number;
}

// In-memory cache for FIFO results (1-minute TTL), keyed by userId.
// Prevents redundant re-computation when multiple AI tools call runFifoMatching
// within the same chat turn. Per-user keying is required — a single shared cache
// would leak one user's FIFO results to another.
const fifoCache = new Map<
  string,
  { result: { matchedLots: MatchedLot[]; openLots: OpenLot[] }; at: number }
>();
const FIFO_CACHE_TTL_MS = 60_000;

/**
 * Run FIFO lot matching on all trades for a given user.
 * Returns matched (closed) lots and open (unmatched buy) lots.
 * Results are cached per-user for 1 minute.
 */
export async function runFifoMatching(userId: string): Promise<{
  matchedLots: MatchedLot[];
  openLots: OpenLot[];
}> {
  const now = Date.now();
  const hit = fifoCache.get(userId);
  if (hit && now - hit.at < FIFO_CACHE_TTL_MS) {
    return hit.result;
  }

  // Opportunistic eviction of stale entries (older than 2× TTL).
  for (const [k, v] of fifoCache) {
    if (now - v.at > FIFO_CACHE_TTL_MS * 2) fifoCache.delete(k);
  }

  const trades = await prisma.trade.findMany({
    where: { userId, direction: { in: ['BUY', 'SELL', 'SPLIT'] } },
    orderBy: [{ tradeDate: 'asc' }, { createdAt: 'asc' }],
  });

  const result = matchFifoLots(trades);
  fifoCache.set(userId, { result, at: Date.now() });
  return result;
}

/**
 * Return the matched (closed) FIFO lots for a single ticker — one row per
 * completed buy→sell cycle. Empty if the ticker has no closed round-trips.
 */
export async function getMatchedLotsForTicker(
  userId: string,
  ticker: string
): Promise<MatchedLot[]> {
  const { matchedLots } = await runFifoMatching(userId);
  return matchedLots.filter((lot) => lot.ticker === ticker);
}

/**
 * Get realized P&L grouped by ticker.
 */
export async function getPnlByTicker(userId: string): Promise<TickerPnl[]> {
  const { matchedLots } = await runFifoMatching(userId);

  const byTicker = new Map<string, MatchedLot[]>();
  for (const lot of matchedLots) {
    const existing = byTicker.get(lot.ticker) || [];
    existing.push(lot);
    byTicker.set(lot.ticker, existing);
  }

  const result: TickerPnl[] = [];
  for (const [ticker, lots] of byTicker) {
    const first = lots[0];
    const winCount = lots.filter((l) => l.realizedPnl > 0).length;
    const lossCount = lots.filter((l) => l.realizedPnl <= 0).length;
    const totalHoldingDays = lots.reduce((sum, l) => sum + l.holdingDays, 0);

    // Sum total buy/sell quantities from all trades for this ticker
    const totalBuyQty = lots.reduce((sum, l) => sum + l.quantity, 0);

    result.push({
      ticker,
      securityName: first.securityName,
      market: first.market,
      currency: first.currency,
      realizedPnl: lots.reduce((sum, l) => sum + l.realizedPnl, 0),
      tradeCount: lots.length,
      winCount,
      lossCount,
      winRate: lots.length > 0 ? (winCount / lots.length) * 100 : 0,
      avgHoldingDays: lots.length > 0 ? totalHoldingDays / lots.length : 0,
      totalBuyQty,
      totalSellQty: totalBuyQty, // matched lots are fully closed
    });
  }

  return result.sort((a, b) => b.realizedPnl - a.realizedPnl);
}

/**
 * Get realized P&L grouped by month.
 */
export async function getPnlByMonth(
  userId: string
): Promise<
  { year: number; month: number; realizedPnl: number; tradeCount: number }[]
> {
  const { matchedLots } = await runFifoMatching(userId);

  const byMonth = new Map<string, { pnl: number; count: number }>();
  for (const lot of matchedLots) {
    const d = lot.sellDate;
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    const existing = byMonth.get(key) || { pnl: 0, count: 0 };
    existing.pnl += lot.realizedPnl;
    existing.count += 1;
    byMonth.set(key, existing);
  }

  return Array.from(byMonth.entries())
    .map(([key, val]) => {
      const [year, month] = key.split('-').map(Number);
      return { year, month, realizedPnl: val.pnl, tradeCount: val.count };
    })
    .sort((a, b) => a.year - b.year || a.month - b.month);
}

/**
 * Resolve a PnlWindow to an inclusive date lower-bound. `null` = unbounded.
 * Window applies to the sellDate (realization event).
 */
function resolveWindowStart(window: PnlWindow): Date | null {
  if (window === 'all') return null;
  const now = new Date();
  if (window === 'ytd') {
    return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  }
  if (window === '1w') {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  if (window === '1m') {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  if (window === '12m' || window === '1y') {
    return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  }
  return null;
}

/**
 * Get realized P&L grouped by market (TASE vs US).
 * `window` filters closed lots by sellDate. `realizedPnlIls` is the ILS-normalized
 * realized P&L using the current USD/ILS rate (TASE passes through 1:1).
 */
export async function getPnlByMarket(
  userId: string,
  window: PnlWindow = 'all'
): Promise<
  {
    market: string;
    realizedPnl: number;
    realizedPnlIls: number;
    tradeCount: number;
    winRate: number;
  }[]
> {
  const { matchedLots } = await runFifoMatching(userId);

  const start = resolveWindowStart(window);
  const filtered = start
    ? matchedLots.filter((l) => l.sellDate.getTime() >= start.getTime())
    : matchedLots;

  let usdIlsRate = 1;
  try {
    usdIlsRate = await getCurrentRate();
  } catch (err) {
    logger.warn({ module: 'pnl.service', err }, 'getPnlByMarket: no FX rate available, USD→ILS conversion will pass through 1:1');
  }

  const byMarket = new Map<
    string,
    { pnl: number; count: number; wins: number; currency: string }
  >();
  for (const lot of filtered) {
    const marketGroup = lot.market === 'TASE' ? 'TASE' : 'US';
    const existing =
      byMarket.get(marketGroup) ||
      { pnl: 0, count: 0, wins: 0, currency: lot.currency };
    existing.pnl += lot.realizedPnl;
    existing.count += 1;
    existing.currency = lot.currency;
    if (lot.realizedPnl > 0) existing.wins += 1;
    byMarket.set(marketGroup, existing);
  }

  return Array.from(byMarket.entries()).map(([market, val]) => {
    const fx = val.currency === 'USD' ? usdIlsRate : 1;
    return {
      market,
      realizedPnl: val.pnl,
      realizedPnlIls: val.pnl * fx,
      tradeCount: val.count,
      winRate: val.count > 0 ? (val.wins / val.count) * 100 : 0,
    };
  });
}

export interface CurrencyPnl {
  currency: string;
  realizedPnl: number;
  tradeCount: number;
}

/**
 * Get portfolio-level summary from FIFO matching.
 */
export async function getPortfolioSummary(userId: string): Promise<{
  totalRealizedPnl: number;
  pnlByCurrency: CurrencyPnl[];
  totalTrades: number;
  winRate: number;
  avgHoldingDays: number;
  avgReturn: number;
}> {
  const { matchedLots } = await runFifoMatching(userId);

  const totalPnl = matchedLots.reduce((sum, l) => sum + l.realizedPnl, 0);
  const wins = matchedLots.filter((l) => l.realizedPnl > 0).length;
  const totalHolding = matchedLots.reduce((sum, l) => sum + l.holdingDays, 0);

  // P&L broken down by currency
  const byCurrency = new Map<string, { pnl: number; count: number }>();
  for (const lot of matchedLots) {
    const entry = byCurrency.get(lot.currency) || { pnl: 0, count: 0 };
    entry.pnl += lot.realizedPnl;
    entry.count += 1;
    byCurrency.set(lot.currency, entry);
  }
  const pnlByCurrency: CurrencyPnl[] = Array.from(byCurrency.entries()).map(
    ([currency, { pnl, count }]) => ({ currency, realizedPnl: pnl, tradeCount: count })
  );

  // Average return % per trade
  const returns = matchedLots.map(
    (l) => ((l.sellPrice - l.buyPrice) / l.buyPrice) * 100
  );
  const avgReturn =
    returns.length > 0
      ? returns.reduce((sum, r) => sum + r, 0) / returns.length
      : 0;

  return {
    totalRealizedPnl: totalPnl,
    pnlByCurrency,
    totalTrades: matchedLots.length,
    winRate: matchedLots.length > 0 ? (wins / matchedLots.length) * 100 : 0,
    avgHoldingDays:
      matchedLots.length > 0 ? totalHolding / matchedLots.length : 0,
    avgReturn,
  };
}
