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
  const toFetch: Array<{ ticker: string; yahooSymbol: string; currency: Currency }> = [];

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
      toFetch.push({ ticker, yahooSymbol, currency });
    } else if (cached) {
      // Unmapped TASE ticker but has stale cache — use it
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
    // If no cache and no Yahoo symbol, ticker won't appear in result (placeholder)
  }

  if (toFetch.length === 0) return result;

  // Batch fetch from Yahoo Finance
  const yahooSymbols = toFetch.map((t) => t.yahooSymbol);
  try {
    const quotes = await yahooFinance.quote(yahooSymbols);

    // Build a map from Yahoo symbol to quote
    const quoteMap = new Map<string, (typeof quotes)[number]>();
    for (const q of quotes) {
      quoteMap.set(q.symbol, q);
    }

    for (const { ticker, yahooSymbol, currency } of toFetch) {
      const q = quoteMap.get(yahooSymbol);
      if (!q || q.regularMarketPrice == null) {
        console.warn(`[market] No quote data for ${yahooSymbol} (ticker: ${ticker})`);
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

      // Upsert into cache
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
    }
  } catch (err) {
    console.error('[market] Yahoo Finance fetch error:', err);
    // For any tickers that failed, try to serve stale cache
    for (const { ticker, currency } of toFetch) {
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
