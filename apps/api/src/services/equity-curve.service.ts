/**
 * Equity Curve Service — on-demand historical portfolio curve.
 *
 * Walks all of a user's trades day-by-day to derive:
 *   - Total Account Value (holdings × historical close × FX + cash balances)
 *   - Cumulative External Capital (DEPOSITs − WITHDRAWALs in ILS at trade-date FX)
 *
 * Both lines are in ILS (home currency). The gap between them is true total
 * P&L (realized + unrealized + dividends + interest − fees − taxes + FX gains
 * on USD cash).
 *
 * Replaces the previous `portfolio_snapshots` table. Per-user TTL memo to
 * absorb rapid window-toggle traffic.
 */

import type {
  EquityCurveKpis,
  EquityCurvePoint,
  EquityCurveResponse,
  EquityCurveWindow,
} from '@takumi/types';
import type { Trade } from '@takumi/db';
import { prisma } from '../lib/db.js';
import { getHistoricalPrices } from './market.service.js';
import { runFifoMatching } from './pnl.service.js';

const CACHE_TTL_MS = 60_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const PRICE_FETCH_CONCURRENCY = 5;

const cache = new Map<string, { result: EquityCurveResponse; at: number }>();

interface WalkState {
  cashIls: number;
  cashUsd: number;
  externalCapitalIls: number;
  holdings: Map<string, number>;
  warnings: Set<string>;
  lastFx: number | null;
}

interface DailyWalkResult {
  points: EquityCurvePoint[]; // daily, undownsampled, starts at seriesStart
  warnings: string[];
}

/**
 * Compute the equity curve for the given window.
 * Result is cached per (userId, window) for 60 seconds.
 */
export async function computeEquityCurve(
  userId: string,
  window: EquityCurveWindow,
): Promise<EquityCurveResponse> {
  const cacheKey = `${userId}:${window}`;
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.result;

  for (const [k, v] of cache) {
    if (now - v.at > CACHE_TTL_MS * 2) cache.delete(k);
  }

  const daily = await buildDailySeries(userId, window);
  const points = downsample(daily.points, window);
  const kpis = await computeKpis(userId, window, daily.points);

  const result: EquityCurveResponse = {
    window,
    points,
    kpis,
    warnings: daily.warnings,
  };
  cache.set(cacheKey, { result, at: Date.now() });
  return result;
}

/**
 * Daily Total Account Value series across the user's entire trade history.
 * Used by risk.service and the get_benchmark_comparison AI tool as a drop-in
 * replacement for the old portfolio_snapshots reads.
 */
export async function getDailyTotalAccountValueSeries(
  userId: string,
): Promise<EquityCurvePoint[]> {
  const daily = await buildDailySeries(userId, 'all');
  return daily.points;
}

// ─── Core day-by-day walk ──────────────────────────────────────────────────

async function buildDailySeries(
  userId: string,
  window: EquityCurveWindow,
): Promise<DailyWalkResult> {
  const rawTrades = await prisma.trade.findMany({
    where: { userId },
    orderBy: [{ tradeDate: 'asc' }, { createdAt: 'asc' }],
  });

  // Within a single tradeDate, IBI's XLSX `createdAt` order doesn't reflect
  // the real intra-day cash flow — e.g., a CONVERSION that funded a same-day
  // BUY may appear AFTER the BUY in the export. Process cash inflows first
  // so the BUY sees the deposit/conversion that funded it, avoiding spurious
  // implicit-deposit shortfalls.
  const CASH_IN_PRIORITY = new Set([
    'TRANSFER', 'DEPOSIT', 'CONVERSION', 'CREDIT',
    'SELL', 'DIVIDEND', 'INTEREST',
  ]);
  const trades = rawTrades.slice().sort((a, b) => {
    const dateCmp = a.tradeDate.getTime() - b.tradeDate.getTime();
    if (dateCmp !== 0) return dateCmp;
    const aIn = CASH_IN_PRIORITY.has(a.direction) ? 0 : 1;
    const bIn = CASH_IN_PRIORITY.has(b.direction) ? 0 : 1;
    if (aIn !== bIn) return aIn - bIn;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  if (trades.length === 0) {
    return { points: [], warnings: [] };
  }

  const windowEnd = todayUtc();
  const earliestTradeDate = utcMidnight(trades[0].tradeDate);
  const windowStart = resolveWindowStart(window) ?? earliestTradeDate;
  const seriesStart = windowStart < earliestTradeDate ? earliestTradeDate : windowStart;

  // Ticker metadata — market & currency per ticker.
  const tickerMeta = collectTickerMeta(trades);

  // Parallel-fetch historical price series per ticker, with concurrency cap.
  const priceMaps = new Map<string, Map<string, number>>();
  const warnings = new Set<string>();
  await fetchAllPriceSeries(tickerMeta, windowEnd, priceMaps, warnings);

  // Bulk-fetch FX rates covering the entire walk range.
  const fxMap = await buildFxMap(earliestTradeDate, windowEnd);
  if (fxMap.size === 0) {
    throw new Error('No exchange rates available — cannot compute equity curve');
  }

  // Initial walk state.
  const state: WalkState = {
    cashIls: 0,
    cashUsd: 0,
    externalCapitalIls: 0,
    holdings: new Map(),
    warnings,
    lastFx: null,
  };

  // Apply all trades strictly before seriesStart so initial state is correct.
  let tradeIdx = 0;
  while (
    tradeIdx < trades.length &&
    utcMidnight(trades[tradeIdx].tradeDate).getTime() < seriesStart.getTime()
  ) {
    applyTrade(trades[tradeIdx], state, fxMap);
    tradeIdx++;
  }

  // Forward-fill per-ticker last known close (across the pre-seriesStart range).
  const lastClose = new Map<string, number | null>();
  for (const [ticker] of tickerMeta) {
    const series = priceMaps.get(ticker);
    if (!series) continue;
    // Seed with the most recent close on or before seriesStart.
    let seed: number | null = null;
    for (const [dateStr, close] of series) {
      if (dateStr <= isoDay(seriesStart)) seed = close;
      else break;
    }
    lastClose.set(ticker, seed);
  }

  // Walk days from seriesStart to windowEnd inclusive, emitting one point per day.
  const points: EquityCurvePoint[] = [];
  let lastFx = state.lastFx;
  // Seed lastFx from the most recent FX row at or before seriesStart.
  const seriesStartKey = isoDay(seriesStart);
  for (const [key, rate] of fxMap) {
    if (key <= seriesStartKey) lastFx = rate;
    else break;
  }

  for (
    let dMs = seriesStart.getTime();
    dMs <= windowEnd.getTime();
    dMs += ONE_DAY_MS
  ) {
    const day = new Date(dMs);
    const dayKey = isoDay(day);

    // Apply trades dated <= today.
    while (
      tradeIdx < trades.length &&
      utcMidnight(trades[tradeIdx].tradeDate).getTime() <= dMs
    ) {
      applyTrade(trades[tradeIdx], state, fxMap);
      tradeIdx++;
    }

    const fx = fxMap.get(dayKey) ?? lastFx;
    if (fx == null) {
      // Should not happen — buildFxMap seeds from prior rows.
      continue;
    }
    lastFx = fx;

    // Holdings value in ILS.
    let holdingsIls = 0;
    for (const [ticker, qty] of state.holdings) {
      if (qty <= 0) continue;
      const series = priceMaps.get(ticker);
      const closeOnDay = series?.get(dayKey);
      if (closeOnDay != null) {
        lastClose.set(ticker, closeOnDay);
      }
      const close = lastClose.get(ticker);
      if (close == null) continue;
      const meta = tickerMeta.get(ticker)!;
      const ils = meta.currency === 'USD' ? close * fx : close;
      holdingsIls += qty * ils;
    }

    const cashTotalIls = state.cashIls + state.cashUsd * fx;
    const totalValueIls = holdingsIls + cashTotalIls;

    points.push({
      date: dayKey,
      totalValueIls,
      externalCapitalIls: state.externalCapitalIls,
    });
  }

  return { points, warnings: Array.from(warnings) };
}

// ─── Trade application ─────────────────────────────────────────────────────

function applyTrade(trade: Trade, state: WalkState, fxMap: Map<string, number>): void {
  const qty = Number(trade.quantity);
  const price = Number(trade.price);
  const commission = Number(trade.commission);
  const proceedsIls = trade.proceedsIls != null ? Number(trade.proceedsIls) : null;
  const proceedsFx = trade.proceedsFx != null ? Number(trade.proceedsFx) : null;
  const currency = trade.currency;
  const ticker = trade.ticker;
  const dayKey = isoDay(trade.tradeDate);
  const fxOnDate = fxMap.get(dayKey) ?? state.lastFx ?? 0;

  switch (trade.direction) {
    case 'BUY': {
      state.holdings.set(ticker, (state.holdings.get(ticker) ?? 0) + qty);
      // IBI's XLSX stores signed proceeds: negative for BUY (cash outflow).
      // `+=` the signed delta so the sign does the right thing. The fallback
      // (when proceeds aren't on the row) is the unsigned cost — explicitly
      // negated to match the convention.
      //
      // Cash is allowed to go negative — IBI lets you buy on T+1 settlement
      // (e.g., BUY today, the funding CONVERSION clears tomorrow), so a
      // transient negative balance is normal and self-corrects. Adding a
      // phantom "implicit deposit" here would double-count: the real
      // CONVERSION/TRANSFER follows in the data.
      if (currency === 'USD') {
        const delta = proceedsFx ?? -(qty * price + commission);
        state.cashUsd += delta;
      } else {
        const delta = proceedsIls ?? -(qty * price + commission);
        state.cashIls += delta;
      }
      break;
    }
    case 'SELL': {
      state.holdings.set(ticker, (state.holdings.get(ticker) ?? 0) - qty);
      // SELL proceeds are positive (inflow) — `+=` is already correct.
      if (currency === 'USD') {
        const proceeds = proceedsFx ?? Math.max(0, qty * price - commission);
        state.cashUsd += proceeds;
      } else {
        const proceeds = proceedsIls ?? Math.max(0, qty * price - commission);
        state.cashIls += proceeds;
      }
      break;
    }
    case 'SPLIT':
    case 'BONUS': {
      // Share count change only — no cash impact.
      state.holdings.set(ticker, (state.holdings.get(ticker) ?? 0) + qty);
      break;
    }
    case 'DIVIDEND':
    case 'INTEREST': {
      if (currency === 'USD' && proceedsFx != null) state.cashUsd += proceedsFx;
      else if (proceedsIls != null) state.cashIls += proceedsIls;
      break;
    }
    case 'TAX': {
      // TAX proceeds are signed-negative outflows. `+=` adds a negative to
      // subtract from cash.
      if (currency === 'USD' && proceedsFx != null) state.cashUsd += proceedsFx;
      else if (proceedsIls != null) state.cashIls += proceedsIls;
      break;
    }
    case 'FEE': {
      // FEE proceeds are signed-negative outflows. `+=` does the right thing.
      if (currency === 'USD' && proceedsFx != null) state.cashUsd += proceedsFx;
      else if (proceedsIls != null) state.cashIls += proceedsIls;
      break;
    }
    case 'DEPOSIT': {
      const usdDelta = proceedsFx ?? 0;
      const ilsDelta = proceedsIls ?? 0;
      if (currency === 'USD' && usdDelta > 0) {
        state.cashUsd += usdDelta;
        state.externalCapitalIls += usdDelta * fxOnDate;
      } else if (ilsDelta > 0) {
        state.cashIls += ilsDelta;
        state.externalCapitalIls += ilsDelta;
      }
      break;
    }
    case 'WITHDRAWAL': {
      const usdDelta = proceedsFx ?? 0;
      const ilsDelta = proceedsIls ?? 0;
      if (currency === 'USD' && usdDelta > 0) {
        state.cashUsd -= usdDelta;
        state.externalCapitalIls -= usdDelta * fxOnDate;
      } else if (ilsDelta > 0) {
        state.cashIls -= ilsDelta;
        state.externalCapitalIls -= ilsDelta;
      }
      break;
    }
    case 'CONVERSION': {
      // B USD/ILS — buy USD with ILS. IBI stores the ILS leg as a signed
      // outflow on proceedsIls (negative), and the USD amount on `quantity`
      // (proceedsFx is often 0 in IBI's export). We gate on the conventional
      // FX ticker so we don't catch ticker-rename corporate-action rows or
      // admin/tax pseudo-trades that share this direction code.
      if (ticker === 'USD/ILS' && proceedsIls != null) {
        state.cashIls += proceedsIls;
        state.cashUsd += qty;
      }
      break;
    }
    case 'CREDIT': {
      // S USD/ILS — sell USD for ILS. ILS leg is a positive inflow on
      // proceedsIls; USD leg is on `quantity` (USD sold). Same FX-ticker gate.
      if (ticker === 'USD/ILS' && proceedsIls != null) {
        state.cashIls += proceedsIls;
        state.cashUsd -= qty;
      }
      break;
    }
    case 'TRANSFER': {
      // IBI's `העברה מזומן בשח` / `שונות מזומן בשח` map to TRANSFER. In practice
      // these carry bank↔brokerage cash movements — the explicit DEPOSIT /
      // WITHDRAWAL direction rows in IBI's export tend to be zero-proceeds
      // skeletons; the amount lives here. Sign is inferred from the security
      // name (Hebrew "משיכה" = withdrawal).
      const ilsAmount = proceedsIls ?? 0;
      const fxAmount = proceedsFx ?? 0;
      const name = trade.securityName ?? '';
      const sign = name.includes('משיכה') ? -1 : 1;
      if (ilsAmount !== 0) {
        state.cashIls += sign * ilsAmount;
        state.externalCapitalIls += sign * ilsAmount;
      }
      if (fxAmount !== 0) {
        state.cashUsd += sign * fxAmount;
        state.externalCapitalIls += sign * fxAmount * fxOnDate;
      }
      break;
    }
    default: {
      // DEBIT, REDEMPTION, RIGHTS — rare; surface and skip.
      state.warnings.add(`Direction ${trade.direction} not modelled`);
      break;
    }
  }

  state.lastFx = fxOnDate;
}

// ─── Bulk data fetching ────────────────────────────────────────────────────

function collectTickerMeta(
  trades: Trade[],
): Map<string, { market: string; currency: string; firstDate: Date }> {
  const meta = new Map<string, { market: string; currency: string; firstDate: Date }>();
  for (const t of trades) {
    if (!['BUY', 'SELL', 'SPLIT', 'BONUS'].includes(t.direction)) continue;
    if (!meta.has(t.ticker)) {
      meta.set(t.ticker, {
        market: t.market,
        currency: t.currency,
        firstDate: utcMidnight(t.tradeDate),
      });
    }
  }
  return meta;
}

async function fetchAllPriceSeries(
  tickerMeta: Map<string, { market: string; currency: string; firstDate: Date }>,
  windowEnd: Date,
  priceMaps: Map<string, Map<string, number>>,
  warnings: Set<string>,
): Promise<void> {
  const entries = Array.from(tickerMeta.entries());
  for (let i = 0; i < entries.length; i += PRICE_FETCH_CONCURRENCY) {
    const batch = entries.slice(i, i + PRICE_FETCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(([ticker, meta]) =>
        getHistoricalPrices(ticker, meta.market, meta.firstDate, windowEnd),
      ),
    );
    batch.forEach(([ticker], idx) => {
      const r = results[idx];
      if (r.status === 'rejected') {
        warnings.add(`${ticker}: price fetch failed`);
        return;
      }
      const value = r.value;
      if (!value.available) {
        if (value.reason === 'unmapped_tase') {
          warnings.add(`${ticker}: no historical price data (unmapped TASE)`);
        } else {
          warnings.add(`${ticker}: price fetch failed`);
        }
        return;
      }
      const map = new Map<string, number>();
      for (const p of value.points) {
        map.set(p.date, p.close);
      }
      priceMaps.set(ticker, map);
    });
  }
}

async function buildFxMap(from: Date, to: Date): Promise<Map<string, number>> {
  const map = new Map<string, number>();

  const rows = await prisma.exchangeRate.findMany({
    where: { date: { gte: from, lte: to } },
    orderBy: { date: 'asc' },
    select: { date: true, rate: true },
  });
  const prior = await prisma.exchangeRate.findFirst({
    where: { date: { lt: from } },
    orderBy: { date: 'desc' },
    select: { date: true, rate: true },
  });

  const byDate = new Map<string, number>();
  for (const r of rows) {
    byDate.set(isoDay(r.date), Number(r.rate));
  }

  let last = prior ? Number(prior.rate) : null;
  for (let dMs = from.getTime(); dMs <= to.getTime(); dMs += ONE_DAY_MS) {
    const key = isoDay(new Date(dMs));
    const fresh = byDate.get(key);
    if (fresh != null) last = fresh;
    if (last != null) map.set(key, last);
  }
  return map;
}

// ─── Downsampling ──────────────────────────────────────────────────────────

function downsample(
  points: EquityCurvePoint[],
  window: EquityCurveWindow,
): EquityCurvePoint[] {
  if (points.length === 0) return points;
  if (window === '1w' || window === '1m' || window === 'ytd') return points;

  const groupKey =
    window === '1y' ? (date: string) => isoWeekKey(date) : (date: string) => date.slice(0, 7);

  const lastInGroup = new Map<string, EquityCurvePoint>();
  for (const p of points) {
    lastInGroup.set(groupKey(p.date), p);
  }
  return Array.from(lastInGroup.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function isoWeekKey(dateStr: string): string {
  // ISO week number — `YYYY-W##` keyed off the Thursday of the week.
  const d = new Date(dateStr + 'T00:00:00Z');
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / ONE_DAY_MS + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ─── KPIs ──────────────────────────────────────────────────────────────────

async function computeKpis(
  userId: string,
  window: EquityCurveWindow,
  dailyPoints: EquityCurvePoint[],
): Promise<EquityCurveKpis> {
  if (dailyPoints.length === 0) {
    return { realizedPnlIls: 0, totalReturnPct: 0 };
  }

  const windowStart = resolveWindowStart(window);
  const windowEnd = todayUtc();
  const startKey = isoDay(windowStart ?? new Date(dailyPoints[0].date + 'T00:00:00Z'));
  const endKey = isoDay(windowEnd);

  // Realized P&L — matched lots with sellDate in [windowStart, windowEnd],
  // converted to ILS using the sellDate's BOI FX rate.
  const { matchedLots } = await runFifoMatching(userId);
  const fxMap = await buildFxMap(
    windowStart ?? new Date(dailyPoints[0].date + 'T00:00:00Z'),
    windowEnd,
  );

  let realizedPnlIls = 0;
  for (const lot of matchedLots) {
    const sellKey = isoDay(lot.sellDate);
    if (sellKey < startKey || sellKey > endKey) continue;
    if (lot.currency === 'USD') {
      const fx = fxMap.get(sellKey);
      if (fx == null) continue;
      realizedPnlIls += lot.realizedPnl * fx;
    } else {
      realizedPnlIls += lot.realizedPnl;
    }
  }

  // Modified Dietz total return: gain net of cash flows, divided by the
  // capital base. Base = starting value + new external capital deployed within
  // the window. The +netExternal term in the denominator keeps the return
  // sensible when most of the capital came in mid-window.
  const startPoint = dailyPoints[0];
  const endPoint = dailyPoints[dailyPoints.length - 1];
  const valueDelta = endPoint.totalValueIls - startPoint.totalValueIls;
  const netExternal = endPoint.externalCapitalIls - startPoint.externalCapitalIls;
  const base = startPoint.totalValueIls + Math.max(netExternal, 0);
  const denominator = base > 1 ? base : 1;
  const totalReturnPct = ((valueDelta - netExternal) / denominator) * 100;

  return { realizedPnlIls, totalReturnPct };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function resolveWindowStart(window: EquityCurveWindow): Date | null {
  if (window === 'all') return null;
  const now = todayUtc();
  if (window === 'ytd') {
    return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  }
  if (window === '1w') return new Date(now.getTime() - 7 * ONE_DAY_MS);
  if (window === '1m') return new Date(now.getTime() - 30 * ONE_DAY_MS);
  if (window === '1y') return new Date(now.getTime() - 365 * ONE_DAY_MS);
  return null;
}

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
