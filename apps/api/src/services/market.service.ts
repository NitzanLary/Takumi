/**
 * Market Data Service — fetches and caches live prices from Yahoo Finance.
 *
 * - US tickers pass through directly (e.g., AAPL)
 * - TASE tickers are resolved via tase-ticker-map.json (paper number → Yahoo .TA symbol)
 * - Prices are cached in market_prices with 15-minute staleness
 */

import YahooFinance from 'yahoo-finance2';
import { prisma } from '../lib/db.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import type { MarketQuote, Currency } from '@takumi/types';
import { fetchTheMarkerQuote } from './themarker.service.js';
import { fetchStooqQuote, fetchStooqHistorical, resolveStooqSymbol } from './stooq.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STALENESS_MS = 15 * 60 * 1000; // 15 minutes

// Load TASE ticker map
const taseMapPath = path.resolve(__dirname, '../data/tase-ticker-map.json');
let taseTickerMap: Record<string, string> = {};
try {
  const raw = readFileSync(taseMapPath, 'utf-8');
  const parsed = JSON.parse(raw);
  // Filter out _comment key
  taseTickerMap = Object.fromEntries(
    Object.entries(parsed).filter(([k]) => !k.startsWith('_'))
  ) as Record<string, string>;
} catch {
  console.warn('[market] Could not load tase-ticker-map.json, TASE tickers will use placeholders');
}

const yahooFinance = new YahooFinance();

/**
 * Upsert a ticker's display name into the `securities` reference table.
 * Called opportunistically after each successful Yahoo quote so the UI has
 * a human-friendly name regardless of what stale label IBI attached to the
 * user's original trade. Never throws — a failure here must not take the
 * whole getLatestPrices call down.
 */
async function upsertSecurityName(
  ticker: string,
  name: string,
  market: string,
  currency: string,
  yahooSymbol: string,
): Promise<void> {
  try {
    await prisma.security.upsert({
      where: { ticker },
      create: { ticker, name, market, currency, yahooSymbol },
      update: { name, yahooSymbol },
    });
  } catch (err) {
    console.warn(`[market] Failed to upsert security name for ${ticker}:`, err);
  }
}

/**
 * Resolve a ticker to its Yahoo Finance symbol.
 * US tickers pass through; TASE tickers are looked up in the map.
 */
export function resolveYahooSymbol(ticker: string, market: string): string | null {
  if (market === 'TASE') {
    return taseTickerMap[ticker] || null;
  }
  // US tickers work directly
  return ticker;
}

/**
 * Get latest prices for the given tickers, using cache when fresh.
 * Returns a map of ticker → MarketQuote.
 */
export async function getLatestPrices(
  tickers: Array<{ ticker: string; market: string; currency: string }>
): Promise<Map<string, MarketQuote>> {
  const result = new Map<string, MarketQuote>();
  const toFetchYahoo: Array<{ ticker: string; yahooSymbol: string; currency: Currency }> = [];
  const toFetchTheMarker: Array<{ ticker: string; currency: Currency }> = [];
  const toFetchStooq: Array<{ ticker: string; stooqSymbol: string; currency: Currency }> = [];

  // Collect the original inputs so fallback paths can look up market/currency.
  const inputByTicker = new Map(tickers.map((t) => [t.ticker, t]));
  const queueStooqFallback = (ticker: string, currency: Currency) => {
    const input = inputByTicker.get(ticker);
    if (!input) return false;
    const stooqSymbol = resolveStooqSymbol(ticker, input.market);
    if (!stooqSymbol) return false;
    if (toFetchStooq.some((s) => s.ticker === ticker)) return true;
    toFetchStooq.push({ ticker, stooqSymbol, currency });
    return true;
  };

  const now = new Date();

  // Check cache first
  for (const { ticker, market, currency: currencyStr } of tickers) {
    const currency = currencyStr as Currency;
    const cached = await prisma.marketPrice.findFirst({
      where: { ticker },
      orderBy: { fetchedAt: 'desc' },
    });

    if (cached && now.getTime() - cached.fetchedAt.getTime() < STALENESS_MS) {
      result.set(ticker, {
        ticker,
        price: Number(cached.price),
        dayChange: cached.dayChange ? Number(cached.dayChange) : null,
        dayChangePct: cached.dayChangePct ? Number(cached.dayChangePct) : null,
        high52w: cached.high52w ? Number(cached.high52w) : null,
        low52w: cached.low52w ? Number(cached.low52w) : null,
        volume: cached.volume,
        currency,
        fetchedAt: cached.fetchedAt.toISOString(),
      });
      continue;
    }

    const yahooSymbol = resolveYahooSymbol(ticker, market);
    if (yahooSymbol) {
      toFetchYahoo.push({ ticker, yahooSymbol, currency });
    } else if (market === 'TASE') {
      // TASE securities without a Yahoo mapping (e.g., Israeli mutual funds)
      // fall back to TheMarker Finance, which covers the full TASE paper-ID space.
      toFetchTheMarker.push({ ticker, currency });
    } else if (cached) {
      // Last-resort stale cache for tickers we can't resolve anywhere
      result.set(ticker, {
        ticker,
        price: Number(cached.price),
        dayChange: cached.dayChange ? Number(cached.dayChange) : null,
        dayChangePct: cached.dayChangePct ? Number(cached.dayChangePct) : null,
        high52w: cached.high52w ? Number(cached.high52w) : null,
        low52w: cached.low52w ? Number(cached.low52w) : null,
        volume: cached.volume,
        currency,
        fetchedAt: cached.fetchedAt.toISOString(),
      });
    }
  }

  // Batch fetch from Yahoo Finance
  if (toFetchYahoo.length > 0) {
    const yahooSymbols = toFetchYahoo.map((t) => t.yahooSymbol);
    try {
      const quotes = await yahooFinance.quote(yahooSymbols);

      const quoteMap = new Map<string, (typeof quotes)[number]>();
      for (const q of quotes) {
        quoteMap.set(q.symbol, q);
      }

      for (const { ticker, yahooSymbol, currency } of toFetchYahoo) {
        const q = quoteMap.get(yahooSymbol);
        if (!q || q.regularMarketPrice == null) {
          console.warn(`[market] No quote data for ${yahooSymbol} (ticker: ${ticker})`);
          // Mapped-but-unavailable TASE tickers still deserve a TheMarker fallback.
          if (isTaseTicker(ticker, tickers)) {
            toFetchTheMarker.push({ ticker, currency });
          } else {
            queueStooqFallback(ticker, currency);
          }
          continue;
        }

        const marketQuote: MarketQuote = {
          ticker,
          price: q.regularMarketPrice,
          dayChange: q.regularMarketChange ?? null,
          dayChangePct: q.regularMarketChangePercent ?? null,
          high52w: q.fiftyTwoWeekHigh ?? null,
          low52w: q.fiftyTwoWeekLow ?? null,
          volume: q.regularMarketVolume ?? null,
          currency,
          fetchedAt: new Date().toISOString(),
        };

        result.set(ticker, marketQuote);

        await prisma.marketPrice.create({
          data: {
            ticker,
            price: q.regularMarketPrice,
            currency,
            dayChange: q.regularMarketChange ?? null,
            dayChangePct: q.regularMarketChangePercent ?? null,
            high52w: q.fiftyTwoWeekHigh ?? null,
            low52w: q.fiftyTwoWeekLow ?? null,
            volume: q.regularMarketVolume ?? null,
          },
        });

        // Cache the current display name alongside the quote so the Positions
        // page can show e.g. "Meta Platforms, Inc." instead of IBI's stale
        // "FACEBOOK(FB)" securityName after a ticker rename. longName is the
        // richer form; fall back to shortName when Yahoo only has the short one.
        const yahooName = q.longName ?? q.shortName ?? null;
        if (yahooName) {
          const inputMarket = inputByTicker.get(ticker)?.market ?? 'NYSE';
          void upsertSecurityName(ticker, yahooName, inputMarket, currency, yahooSymbol);
        }
      }
    } catch (err) {
      console.error('[market] Yahoo Finance fetch error:', err);
      for (const { ticker, currency } of toFetchYahoo) {
        if (result.has(ticker)) continue;
        if (isTaseTicker(ticker, tickers)) {
          toFetchTheMarker.push({ ticker, currency });
          continue;
        }
        if (queueStooqFallback(ticker, currency)) continue;
        const stale = await prisma.marketPrice.findFirst({
          where: { ticker },
          orderBy: { fetchedAt: 'desc' },
        });
        if (stale) {
          result.set(ticker, {
            ticker,
            price: Number(stale.price),
            dayChange: stale.dayChange ? Number(stale.dayChange) : null,
            dayChangePct: stale.dayChangePct ? Number(stale.dayChangePct) : null,
            high52w: stale.high52w ? Number(stale.high52w) : null,
            low52w: stale.low52w ? Number(stale.low52w) : null,
            volume: stale.volume,
            currency,
            fetchedAt: stale.fetchedAt.toISOString(),
          });
        }
      }
    }
  }

  // Stooq fallback for US tickers when Yahoo is unreachable (Railway egress
  // occasionally gets blocked by Yahoo's anti-bot protections).
  if (toFetchStooq.length > 0) {
    // Stooq drops connections when hit with too many concurrent requests from
    // one IP — bound concurrency to 5 and process in chunks.
    const STOOQ_CONCURRENCY = 5;
    const settled: Array<{ ticker: string; currency: Currency; quote: MarketQuote | null }> = [];
    for (let i = 0; i < toFetchStooq.length; i += STOOQ_CONCURRENCY) {
      const chunk = toFetchStooq.slice(i, i + STOOQ_CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async ({ ticker, stooqSymbol, currency }) => {
          const quote = await fetchStooqQuote(ticker, stooqSymbol, currency);
          return { ticker, currency, quote };
        })
      );
      settled.push(...chunkResults);
    }

    for (const { ticker, currency, quote } of settled) {
      if (quote) {
        result.set(ticker, quote);
        await prisma.marketPrice.create({
          data: {
            ticker,
            price: quote.price,
            currency,
            dayChange: quote.dayChange,
            dayChangePct: quote.dayChangePct,
            high52w: null,
            low52w: null,
            volume: quote.volume,
          },
        });
        continue;
      }
      // Stooq also failed — try stale cache
      if (result.has(ticker)) continue;
      const stale = await prisma.marketPrice.findFirst({
        where: { ticker },
        orderBy: { fetchedAt: 'desc' },
      });
      if (stale) {
        result.set(ticker, {
          ticker,
          price: Number(stale.price),
          dayChange: stale.dayChange ? Number(stale.dayChange) : null,
          dayChangePct: stale.dayChangePct ? Number(stale.dayChangePct) : null,
          high52w: stale.high52w ? Number(stale.high52w) : null,
          low52w: stale.low52w ? Number(stale.low52w) : null,
          volume: stale.volume,
          currency,
          fetchedAt: stale.fetchedAt.toISOString(),
        });
      }
    }
  }

  // TheMarker fallback for unmapped or Yahoo-missing TASE tickers (fetched in parallel)
  if (toFetchTheMarker.length > 0) {
    const settled = await Promise.all(
      toFetchTheMarker.map(async ({ ticker, currency }) => {
        const quote = await fetchTheMarkerQuote(ticker, currency);
        return { ticker, currency, quote };
      })
    );

    for (const { ticker, currency, quote } of settled) {
      if (quote) {
        result.set(ticker, quote);
        await prisma.marketPrice.create({
          data: {
            ticker,
            price: quote.price,
            currency,
            dayChange: quote.dayChange,
            dayChangePct: quote.dayChangePct,
            high52w: null,
            low52w: null,
            volume: quote.volume,
          },
        });
        continue;
      }
      // TheMarker failed too — try stale cache
      if (result.has(ticker)) continue;
      const stale = await prisma.marketPrice.findFirst({
        where: { ticker },
        orderBy: { fetchedAt: 'desc' },
      });
      if (stale) {
        result.set(ticker, {
          ticker,
          price: Number(stale.price),
          dayChange: stale.dayChange ? Number(stale.dayChange) : null,
          dayChangePct: stale.dayChangePct ? Number(stale.dayChangePct) : null,
          high52w: stale.high52w ? Number(stale.high52w) : null,
          low52w: stale.low52w ? Number(stale.low52w) : null,
          volume: stale.volume,
          currency,
          fetchedAt: stale.fetchedAt.toISOString(),
        });
      }
    }
  }

  return result;
}

function isTaseTicker(
  ticker: string,
  tickers: Array<{ ticker: string; market: string; currency: string }>
): boolean {
  return tickers.some((t) => t.ticker === ticker && t.market === 'TASE');
}

/**
 * Force refresh prices for all open position tickers + benchmarks.
 */
export async function refreshAllPrices(
  tickers: Array<{ ticker: string; market: string; currency: string }>
): Promise<Map<string, MarketQuote>> {
  // Delete cached prices to force refresh
  const tickerList = tickers.map((t) => t.ticker);
  await prisma.marketPrice.deleteMany({
    where: { ticker: { in: tickerList } },
  });
  return getLatestPrices(tickers);
}

/**
 * Get benchmark quotes (TA-125 and S&P 500).
 */
export async function getBenchmarks(): Promise<{ ta125: MarketQuote | null; sp500: MarketQuote | null }> {
  const benchmarks = [
    { ticker: '^TA125', market: 'INDEX', currency: 'ILS' },
    { ticker: '^GSPC', market: 'INDEX', currency: 'USD' },
  ];

  const prices = await getLatestPrices(
    benchmarks.map((b) => ({ ticker: b.ticker, market: b.market, currency: b.currency }))
  );

  return {
    ta125: prices.get('^TA125') || null,
    sp500: prices.get('^GSPC') || null,
  };
}

/**
 * Get TASE tickers that don't have a Yahoo Finance mapping.
 */
export async function getUnmappedTickers(): Promise<Array<{ ticker: string; securityName: string }>> {
  const taseTickers = await prisma.security.findMany({
    where: { market: 'TASE' },
    select: { ticker: true, name: true },
  });

  return taseTickers
    .filter((s) => !taseTickerMap[s.ticker])
    .map((s) => ({ ticker: s.ticker, securityName: s.name }));
}

export interface HistoricalPricePoint {
  date: string;
  close: number;
}

export type HistoricalPriceResult =
  | { available: true; source: 'yahoo' | 'stooq'; points: HistoricalPricePoint[] }
  | { available: false; reason: 'unmapped_tase' | 'fetch_failed' };

// In-memory cache for historical price series (1-day TTL). Keyed by
// ticker|from|to so varied date ranges are cached independently.
const HISTORICAL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const historicalCache = new Map<string, { at: number; result: HistoricalPriceResult }>();

/**
 * Fetch daily historical closes for a ticker between two dates (inclusive).
 * Yahoo is the primary source (works for US tickers and mapped TASE `.TA` symbols).
 * Stooq is the fallback for US tickers when Yahoo fails (matches the quote path).
 * Unmapped TASE tickers (e.g., Israeli mutual funds via TheMarker) have no
 * historical data source and return `{ available: false, reason: 'unmapped_tase' }`.
 */
export async function getHistoricalPrices(
  ticker: string,
  market: string,
  from: Date,
  to: Date
): Promise<HistoricalPriceResult> {
  const cacheKey = `${ticker}|${from.toISOString().slice(0, 10)}|${to.toISOString().slice(0, 10)}`;
  const cached = historicalCache.get(cacheKey);
  if (cached && Date.now() - cached.at < HISTORICAL_CACHE_TTL_MS) {
    return cached.result;
  }

  const yahooSymbol = resolveYahooSymbol(ticker, market);

  // Unmapped TASE — no historical source available (TheMarker is quote-only).
  if (market === 'TASE' && !yahooSymbol) {
    const result: HistoricalPriceResult = { available: false, reason: 'unmapped_tase' };
    historicalCache.set(cacheKey, { at: Date.now(), result });
    return result;
  }

  if (yahooSymbol) {
    try {
      const chart = await yahooFinance.chart(yahooSymbol, {
        period1: from,
        period2: to,
        interval: '1d',
      });
      const points: HistoricalPricePoint[] = [];
      for (const q of chart.quotes) {
        if (q.close == null || !q.date) continue;
        points.push({ date: q.date.toISOString().slice(0, 10), close: q.close });
      }
      if (points.length > 0) {
        const result: HistoricalPriceResult = { available: true, source: 'yahoo', points };
        historicalCache.set(cacheKey, { at: Date.now(), result });
        return result;
      }
      console.warn(`[market] Yahoo returned no historical quotes for ${yahooSymbol}`);
    } catch (err) {
      console.warn(`[market] Yahoo historical fetch failed for ${yahooSymbol}:`, err);
    }
  }

  // Stooq fallback — US only
  const stooqSymbol = resolveStooqSymbol(ticker, market);
  if (stooqSymbol) {
    const points = await fetchStooqHistorical(stooqSymbol, from, to);
    if (points.length > 0) {
      const result: HistoricalPriceResult = { available: true, source: 'stooq', points };
      historicalCache.set(cacheKey, { at: Date.now(), result });
      return result;
    }
  }

  const result: HistoricalPriceResult = { available: false, reason: 'fetch_failed' };
  historicalCache.set(cacheKey, { at: Date.now(), result });
  return result;
}

/**
 * Save a TASE ticker mapping (in-memory + securities table).
 * The JSON file should be updated manually for persistence across restarts.
 */
export async function saveTaseMapping(ticker: string, yahooSymbol: string): Promise<void> {
  taseTickerMap[ticker] = yahooSymbol;

  await prisma.security.updateMany({
    where: { ticker },
    data: { yahooSymbol },
  });
}
