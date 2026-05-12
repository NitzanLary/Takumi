/**
 * Alternative-investment counterfactual.
 *
 * For each of the user's real BUY trades (optionally scoped to TASE or US),
 * mirror the ILS capital deployed into a single target security on the same
 * date, then compare the hypothetical outcome to the user's actual realized
 * + unrealized P&L (also in ILS, scope-aligned).
 *
 * Two modes:
 *   - mirror_timing (default): one hypothetical buy per real BUY, on the same date
 *   - lump_sum: one hypothetical buy on the date of the first real BUY for the
 *               sum of all capital deployed
 *
 * Currency math: the target's prices are in its native currency (USD for
 * AAPL/^GSPC, ILS for TASE). Each BUY's ILS capital is converted to the
 * target's currency at the trade-date FX rate before dividing by that day's
 * close to get hypothetical shares. At the end, current value in the target's
 * currency is converted back to ILS at the current rate.
 */

import { prisma } from '../lib/db.js';
import {
  getHistoricalPrices,
  getLatestPrices,
  type HistoricalPriceResult,
} from './market.service.js';
import { getCurrentRate, getRate } from './exchange-rate.service.js';
import { getPnlByMarket } from './pnl.service.js';
import { getOpenPositions } from './position.service.js';

export type SimulationScope = 'all' | 'tase' | 'us';
export type SimulationMode = 'mirror_timing' | 'lump_sum';

export interface SimulateAlternativeInput {
  targetTicker: string;
  scope?: SimulationScope;
  mode?: SimulationMode;
}

export interface SimulateAlternativeSuccess {
  targetTicker: string;
  targetMarket: 'US' | 'TASE';
  mode: SimulationMode;
  scope: SimulationScope;
  totalCapitalDeployedIls: number;
  hypotheticalShares: number;
  hypotheticalValueIls: number;
  hypotheticalGainIls: number;
  hypotheticalGainPct: number;
  actualRealizedPnlIls: number;
  actualUnrealizedPnlIls: number;
  actualTotalPnlIls: number;
  delta: number;
  deltaPct: number;
  tradesSimulated: number;
  firstTradeDate: string;
  lastTradeDate: string;
  missingPriceDates: string[];
  priceSource: 'yahoo' | 'stooq';
}

export interface SimulateAlternativeError {
  error: 'unmapped_tase_target' | 'historical_fetch_failed' | 'no_buy_trades_in_scope' | 'no_current_price';
  message: string;
}

export type SimulateAlternativeResult = SimulateAlternativeSuccess | SimulateAlternativeError;

/**
 * Infer the market of the target ticker — only a routing hint for getHistoricalPrices.
 * Yahoo accepts indices like ^GSPC, ^IXIC, ^TA125 on the US path.
 */
function inferTargetMarket(ticker: string): 'US' | 'TASE' {
  if (ticker.startsWith('^')) return 'US';
  if (/^\d+$/.test(ticker)) return 'TASE';
  if (/^[A-Z][A-Z0-9.\-]{0,6}$/i.test(ticker)) return 'US';
  return 'US';
}

/**
 * Scope filter for the user's real BUY trades. The `market` column on `trades`
 * holds 'TASE' | 'NYSE' | 'NASDAQ' — there is no literal 'US' value.
 */
function scopeWhere(scope: SimulationScope) {
  if (scope === 'tase') return { market: 'TASE' as const };
  if (scope === 'us') return { market: { in: ['NYSE', 'NASDAQ'] } };
  return {};
}

function matchesScope(market: string, scope: SimulationScope): boolean {
  if (scope === 'all') return true;
  if (scope === 'tase') return market === 'TASE';
  return market !== 'TASE';
}

export async function simulateAlternativeInvestment(
  userId: string,
  input: SimulateAlternativeInput
): Promise<SimulateAlternativeResult> {
  const targetTicker = input.targetTicker.trim();
  const scope: SimulationScope = input.scope ?? 'all';
  const mode: SimulationMode = input.mode ?? 'mirror_timing';
  const targetMarket = inferTargetMarket(targetTicker);
  const targetIsUsd = targetMarket === 'US';

  const buys = await prisma.trade.findMany({
    where: { userId, direction: 'BUY', ...scopeWhere(scope) },
    orderBy: { tradeDate: 'asc' },
  });

  if (buys.length === 0) {
    return {
      error: 'no_buy_trades_in_scope',
      message: `No BUY trades found${scope === 'all' ? '' : ` for scope "${scope}"`}.`,
    };
  }

  const firstBuyDate = buys[0].tradeDate;
  const lastBuyDate = buys[buys.length - 1].tradeDate;
  const today = new Date();

  // Pad the lookup window so a BUY landing on the first trading-calendar day
  // (e.g., a US holiday like Presidents Day) can snap back to the prior close.
  const fetchFrom = new Date(firstBuyDate.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Fetch the target's full historical series once.
  const history: HistoricalPriceResult = await getHistoricalPrices(
    targetTicker,
    targetMarket,
    fetchFrom,
    today
  );

  if (!history.available) {
    if (history.reason === 'unmapped_tase') {
      return {
        error: 'unmapped_tase_target',
        message: `Cannot simulate ${targetTicker} — no historical data available (unmapped TASE security).`,
      };
    }
    return {
      error: 'historical_fetch_failed',
      message: `Failed to fetch historical prices for ${targetTicker}.`,
    };
  }

  const priceByDate = new Map<string, number>();
  for (const p of history.points) priceByDate.set(p.date, p.close);
  const sortedDates = Array.from(priceByDate.keys()).sort();

  const snap = (d: string): string | null => {
    if (priceByDate.has(d)) return d;
    // Most BUYs land on a known date — bail out without a full scan.
    let lo = 0;
    let hi = sortedDates.length - 1;
    let candidateIdx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sortedDates[mid] <= d) {
        candidateIdx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return candidateIdx >= 0 ? sortedDates[candidateIdx] : null;
  };

  // Per-trade-date FX cache so multiple BUYs on the same day share one lookup.
  const fxCache = new Map<string, number>();
  const fxForDate = async (date: Date): Promise<number> => {
    const key = date.toISOString().slice(0, 10);
    const cached = fxCache.get(key);
    if (cached !== undefined) return cached;
    try {
      const r = await getRate(date);
      fxCache.set(key, r);
      return r;
    } catch {
      const r = await getCurrentRate();
      fxCache.set(key, r);
      return r;
    }
  };

  const capitalIlsForBuy = async (trade: typeof buys[number]): Promise<number> => {
    const proceeds = trade.proceedsIls != null ? Math.abs(Number(trade.proceedsIls)) : 0;
    if (proceeds > 0) return proceeds;
    // Fallback: derive from quantity × price. TASE prices are already in ILS
    // (the agorot fix divides by 100 at import time); US prices are USD.
    const qty = Number(trade.quantity);
    const px = Number(trade.price);
    if (trade.market === 'TASE') return qty * px;
    const fx = await fxForDate(trade.tradeDate);
    return qty * px * fx;
  };

  let totalCapitalIls = 0;
  let totalHypotheticalShares = 0;
  let tradesSimulated = 0;
  const missingPriceDates: string[] = [];

  if (mode === 'mirror_timing') {
    for (const trade of buys) {
      const buyDateStr = trade.tradeDate.toISOString().slice(0, 10);
      const priceDate = snap(buyDateStr);
      if (priceDate == null) {
        missingPriceDates.push(buyDateStr);
        continue;
      }
      const targetPrice = priceByDate.get(priceDate)!;
      if (targetPrice <= 0) {
        missingPriceDates.push(buyDateStr);
        continue;
      }
      const capitalIls = await capitalIlsForBuy(trade);
      if (capitalIls <= 0) continue;
      const capitalInTargetCcy = targetIsUsd
        ? capitalIls / (await fxForDate(trade.tradeDate))
        : capitalIls;
      const shares = capitalInTargetCcy / targetPrice;
      totalCapitalIls += capitalIls;
      totalHypotheticalShares += shares;
      tradesSimulated += 1;
    }
  } else {
    // lump_sum: sum capital across all in-scope BUYs, invest on first BUY date.
    let allCapital = 0;
    for (const trade of buys) {
      allCapital += await capitalIlsForBuy(trade);
    }
    const firstDateStr = firstBuyDate.toISOString().slice(0, 10);
    const priceDate = snap(firstDateStr);
    if (priceDate == null) {
      return {
        error: 'historical_fetch_failed',
        message: `No historical price for ${targetTicker} on or before ${firstDateStr}.`,
      };
    }
    const targetPrice = priceByDate.get(priceDate)!;
    const capitalInTargetCcy = targetIsUsd
      ? allCapital / (await fxForDate(firstBuyDate))
      : allCapital;
    totalCapitalIls = allCapital;
    totalHypotheticalShares = capitalInTargetCcy / targetPrice;
    tradesSimulated = 1;
  }

  if (totalCapitalIls <= 0 || totalHypotheticalShares <= 0) {
    return {
      error: 'no_buy_trades_in_scope',
      message: `No priceable BUY trades found${scope === 'all' ? '' : ` for scope "${scope}"`}.`,
    };
  }

  // Current value of the hypothetical position.
  const targetCurrency = targetIsUsd ? 'USD' : 'ILS';
  const quotes = await getLatestPrices([
    { ticker: targetTicker, market: targetMarket, currency: targetCurrency },
  ]);
  const quote = quotes.get(targetTicker);
  if (!quote || !quote.price) {
    return {
      error: 'no_current_price',
      message: `Could not fetch current price for ${targetTicker}.`,
    };
  }

  const currentFx = targetIsUsd ? await getCurrentRate() : 1;
  const hypotheticalValueInTargetCcy = totalHypotheticalShares * quote.price;
  const hypotheticalValueIls = hypotheticalValueInTargetCcy * (targetIsUsd ? currentFx : 1);
  const hypotheticalGainIls = hypotheticalValueIls - totalCapitalIls;
  const hypotheticalGainPct = totalCapitalIls > 0 ? (hypotheticalGainIls / totalCapitalIls) * 100 : 0;

  // Actual side, scope-aligned, in ILS.
  const [pnlByMarket, positions] = await Promise.all([
    getPnlByMarket(userId),
    getOpenPositions(userId),
  ]);

  const actualRealizedPnlIls = pnlByMarket
    .filter((row) => matchesScope(row.market, scope))
    .reduce((s, row) => s + row.realizedPnlIls, 0);

  const actualUnrealizedPnlIls = positions
    .filter((p) => matchesScope(p.market, scope))
    .reduce((s, p) => s + p.unrealizedPnlIls, 0);

  const actualTotalPnlIls = actualRealizedPnlIls + actualUnrealizedPnlIls;
  const delta = hypotheticalGainIls - actualTotalPnlIls;
  const deltaPct = totalCapitalIls > 0 ? (delta / totalCapitalIls) * 100 : 0;

  return {
    targetTicker,
    targetMarket,
    mode,
    scope,
    totalCapitalDeployedIls: totalCapitalIls,
    hypotheticalShares: totalHypotheticalShares,
    hypotheticalValueIls,
    hypotheticalGainIls,
    hypotheticalGainPct,
    actualRealizedPnlIls,
    actualUnrealizedPnlIls,
    actualTotalPnlIls,
    delta,
    deltaPct,
    tradesSimulated,
    firstTradeDate: firstBuyDate.toISOString().slice(0, 10),
    lastTradeDate: lastBuyDate.toISOString().slice(0, 10),
    missingPriceDates,
    priceSource: history.source,
  };
}
