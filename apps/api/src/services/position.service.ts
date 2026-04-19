/**
 * Positions Service — derives open positions from unmatched FIFO buy lots.
 *
 * Uses the P&L engine's open lots and enriches with live market prices
 * from Yahoo Finance (via market.service). Falls back to avg cost basis
 * for tickers without live price data.
 */

import { runFifoMatching, type OpenLot } from './pnl.service.js';
import { getLatestPrices } from './market.service.js';
import { getCurrentRate } from './exchange-rate.service.js';
import type { PriceSource } from '@takumi/types';

export interface OpenPosition {
  ticker: string;
  securityName: string;
  market: string;
  currency: string;
  quantity: number;
  avgCostBasis: number;
  totalCost: number;
  currentPrice: number;
  marketValue: number;
  // ILS-normalized values. Equal to the native fields for ILS positions;
  // for USD positions, converted using the current BOI rate. Use these
  // (not the native fields) for any cross-position aggregation, weights,
  // or totals — summing ILS + USD without conversion is a bug.
  marketValueIls: number;
  totalCostIls: number;
  unrealizedPnlIls: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  weight: number; // % of total portfolio (ILS-normalized)
  priceSource: PriceSource;
  dayChange: number | null;
  dayChangePct: number | null;
}

/**
 * Aggregate open lots per ticker into positions.
 * Multiple open lots for the same ticker are merged into one position
 * with a weighted average cost basis. Enriched with live market prices.
 */
export async function getOpenPositions(): Promise<OpenPosition[]> {
  const { openLots } = await runFifoMatching();

  // Group open lots by ticker
  const byTicker = new Map<string, OpenLot[]>();
  for (const lot of openLots) {
    const existing = byTicker.get(lot.ticker) || [];
    existing.push(lot);
    byTicker.set(lot.ticker, existing);
  }

  // Collect tickers for price lookup
  const tickerInfos = Array.from(byTicker.entries()).map(([ticker, lots]) => ({
    ticker,
    market: lots[0].market,
    currency: lots[0].currency,
  }));

  // Fetch live prices and the current USD→ILS rate in parallel
  const [prices, usdIlsRate] = await Promise.all([
    getLatestPrices(tickerInfos),
    getCurrentRate().catch(() => {
      console.warn('[positions] No USD/ILS rate available; USD positions will not be weighted correctly');
      return 1;
    }),
  ]);

  const positions: OpenPosition[] = [];

  for (const [ticker, lots] of byTicker) {
    const first = lots[0];
    const totalQty = lots.reduce((sum, l) => sum + l.quantity, 0);
    const totalCost = lots.reduce((sum, l) => sum + l.quantity * l.price, 0);
    const avgCost = totalQty > 0 ? totalCost / totalQty : 0;

    const quote = prices.get(ticker);
    const currentPrice = quote?.price ?? avgCost;
    const priceSource: PriceSource = quote ? 'live' : 'placeholder';
    const marketValue = totalQty * currentPrice;
    const unrealizedPnl = marketValue - totalCost;
    const unrealizedPnlPct = totalCost > 0 ? (unrealizedPnl / totalCost) * 100 : 0;

    const fxRate = first.currency === 'USD' ? usdIlsRate : 1;
    const marketValueIls = marketValue * fxRate;
    const totalCostIls = totalCost * fxRate;
    const unrealizedPnlIls = unrealizedPnl * fxRate;

    positions.push({
      ticker,
      securityName: first.securityName,
      market: first.market,
      currency: first.currency,
      quantity: totalQty,
      avgCostBasis: avgCost,
      totalCost,
      currentPrice,
      marketValue,
      marketValueIls,
      totalCostIls,
      unrealizedPnlIls,
      unrealizedPnl,
      unrealizedPnlPct,
      weight: 0, // calculated after all positions are built
      priceSource,
      dayChange: quote?.dayChange ?? null,
      dayChangePct: quote?.dayChangePct ?? null,
    });
  }

  // Portfolio weights — use ILS-normalized value so TASE and US positions are
  // comparable. Summing native marketValue across currencies would inflate
  // TASE weights (since 1 USD ≈ 3.7 ILS).
  const totalValueIls = positions.reduce((sum, p) => sum + p.marketValueIls, 0);
  for (const p of positions) {
    p.weight = totalValueIls > 0 ? (p.marketValueIls / totalValueIls) * 100 : 0;
  }

  return positions.sort((a, b) => b.marketValueIls - a.marketValueIls);
}
