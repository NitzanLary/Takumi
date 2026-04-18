/**
 * P&L Engine — FIFO lot matching to calculate realized P&L per trade/ticker/portfolio.
 *
 * Groups all trades by ticker, sorts chronologically, and matches sells against
 * the oldest remaining buy lots (FIFO). Returns realized P&L per matched lot,
 * per ticker, and portfolio-wide. Also exposes unmatched buy lots for position derivation.
 */

import { prisma } from '../lib/db.js';

export interface MatchedLot {
  ticker: string;
  securityName: string;
  market: string;
  currency: string;
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  buyDate: Date;
  sellDate: Date;
  commission: number; // combined buy + sell commission (prorated)
  realizedPnl: number;
  holdingDays: number;
}

export interface OpenLot {
  ticker: string;
  securityName: string;
  market: string;
  currency: string;
  quantity: number;
  price: number;
  date: Date;
  commission: number;
}

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

interface BuyLot {
  ticker: string;
  securityName: string;
  market: string;
  currency: string;
  remainingQty: number;
  price: number;
  date: Date;
  commissionPerShare: number;
}

function toNum(d: unknown): number {
  return Number(d);
}

// In-memory cache for FIFO results (1-minute TTL).
// Prevents redundant re-computation when multiple AI tools call runFifoMatching
// within the same chat turn.
let fifoCache: { matchedLots: MatchedLot[]; openLots: OpenLot[] } | null = null;
let fifoCacheTime = 0;
const FIFO_CACHE_TTL_MS = 60_000;

/**
 * Run FIFO lot matching on all trades in the database.
 * Returns matched (closed) lots and open (unmatched buy) lots.
 * Results are cached for 1 minute to avoid redundant computation.
 */
export async function runFifoMatching(): Promise<{
  matchedLots: MatchedLot[];
  openLots: OpenLot[];
}> {
  const now = Date.now();
  if (fifoCache && now - fifoCacheTime < FIFO_CACHE_TTL_MS) {
    return fifoCache;
  }

  const trades = await prisma.trade.findMany({
    where: { direction: { in: ['BUY', 'SELL'] } },
    orderBy: { tradeDate: 'asc' },
  });

  // Group by ticker
  const byTicker = new Map<string, typeof trades>();
  for (const t of trades) {
    const existing = byTicker.get(t.ticker) || [];
    existing.push(t);
    byTicker.set(t.ticker, existing);
  }

  const matchedLots: MatchedLot[] = [];
  const openLots: OpenLot[] = [];

  for (const [ticker, tickerTrades] of byTicker) {
    const buyQueue: BuyLot[] = [];

    for (const trade of tickerTrades) {
      const qty = toNum(trade.quantity);
      const price = toNum(trade.price);
      const commission = toNum(trade.commission);

      if (trade.direction === 'BUY') {
        buyQueue.push({
          ticker: trade.ticker,
          securityName: trade.securityName,
          market: trade.market,
          currency: trade.currency,
          remainingQty: qty,
          price,
          date: trade.tradeDate,
          commissionPerShare: qty > 0 ? commission / qty : 0,
        });
      } else {
        // SELL — match against oldest buy lots (FIFO)
        let remainingToSell = qty;
        const sellCommPerShare = qty > 0 ? commission / qty : 0;

        while (remainingToSell > 0 && buyQueue.length > 0) {
          const lot = buyQueue[0];
          const matchQty = Math.min(remainingToSell, lot.remainingQty);

          const buyCommission = matchQty * lot.commissionPerShare;
          const sellCommission = matchQty * sellCommPerShare;
          const totalCommission = buyCommission + sellCommission;

          const grossPnl = matchQty * (price - lot.price);
          const realizedPnl = grossPnl - totalCommission;

          const holdingDays = Math.round(
            (trade.tradeDate.getTime() - lot.date.getTime()) / (1000 * 60 * 60 * 24)
          );

          matchedLots.push({
            ticker: trade.ticker,
            securityName: trade.securityName,
            market: trade.market,
            currency: trade.currency,
            quantity: matchQty,
            buyPrice: lot.price,
            sellPrice: price,
            buyDate: lot.date,
            sellDate: trade.tradeDate,
            commission: totalCommission,
            realizedPnl,
            holdingDays,
          });

          lot.remainingQty -= matchQty;
          remainingToSell -= matchQty;

          if (lot.remainingQty <= 0) {
            buyQueue.shift();
          }
        }
      }
    }

    // Remaining buy lots are open positions
    for (const lot of buyQueue) {
      if (lot.remainingQty > 0) {
        openLots.push({
          ticker: lot.ticker,
          securityName: lot.securityName,
          market: lot.market,
          currency: lot.currency,
          quantity: lot.remainingQty,
          price: lot.price,
          date: lot.date,
          commission: lot.remainingQty * lot.commissionPerShare,
        });
      }
    }
  }

  const result = { matchedLots, openLots };
  fifoCache = result;
  fifoCacheTime = Date.now();
  return result;
}

/**
 * Get realized P&L grouped by ticker.
 */
export async function getPnlByTicker(): Promise<TickerPnl[]> {
  const { matchedLots } = await runFifoMatching();

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
export async function getPnlByMonth(): Promise<
  { year: number; month: number; realizedPnl: number; tradeCount: number }[]
> {
  const { matchedLots } = await runFifoMatching();

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
 * Get realized P&L grouped by market (TASE vs US).
 */
export async function getPnlByMarket(): Promise<
  { market: string; realizedPnl: number; tradeCount: number; winRate: number }[]
> {
  const { matchedLots } = await runFifoMatching();

  const byMarket = new Map<
    string,
    { pnl: number; count: number; wins: number }
  >();
  for (const lot of matchedLots) {
    const marketGroup = lot.market === 'TASE' ? 'TASE' : 'US';
    const existing = byMarket.get(marketGroup) || { pnl: 0, count: 0, wins: 0 };
    existing.pnl += lot.realizedPnl;
    existing.count += 1;
    if (lot.realizedPnl > 0) existing.wins += 1;
    byMarket.set(marketGroup, existing);
  }

  return Array.from(byMarket.entries()).map(([market, val]) => ({
    market,
    realizedPnl: val.pnl,
    tradeCount: val.count,
    winRate: val.count > 0 ? (val.wins / val.count) * 100 : 0,
  }));
}

export interface CurrencyPnl {
  currency: string;
  realizedPnl: number;
  tradeCount: number;
}

/**
 * Get portfolio-level summary from FIFO matching.
 */
export async function getPortfolioSummary(): Promise<{
  totalRealizedPnl: number;
  pnlByCurrency: CurrencyPnl[];
  totalTrades: number;
  winRate: number;
  avgHoldingDays: number;
  avgReturn: number;
}> {
  const { matchedLots } = await runFifoMatching();

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
