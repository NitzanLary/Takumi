/**
 * Analytics Service — win rate, holding period, behavioral patterns, TASE vs US.
 *
 * All analytics are derived from the FIFO lot matching results. No additional
 * DB queries needed — the P&L engine is the single source of truth.
 */

import { CORE_DIRECTIONS } from '@takumi/types';
import {
  runFifoMatching,
  getPortfolioSummary,
  getPnlByTicker,
  getPnlByMonth,
  getPnlByMarket,
  type MatchedLot,
} from './pnl.service.js';
import { getOpenPositions } from './position.service.js';
import { prisma } from '../lib/db.js';

export interface AnalyticsSummary {
  // Portfolio KPIs
  totalRealizedPnl: number;
  pnlByCurrency: { currency: string; realizedPnl: number; tradeCount: number }[];
  totalTrades: number;
  winRate: number;
  avgHoldingDays: number;
  avgReturn: number;

  // Behavioral
  avgWinningHoldDays: number;
  avgLosingHoldDays: number;
  avgWinAmount: number;
  avgLossAmount: number;
  profitFactor: number;
  largestWin: number;
  largestLoss: number;

  // Open positions summary
  openPositionCount: number;
  totalOpenValue: number;
}

export interface MarketComparison {
  market: string;
  realizedPnl: number;
  tradeCount: number;
  winRate: number;
}

/**
 * Full analytics summary for dashboard and analytics page.
 */
export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  const portfolio = await getPortfolioSummary();
  const { matchedLots } = await runFifoMatching();
  const positions = await getOpenPositions();

  const winners = matchedLots.filter((l) => l.realizedPnl > 0);
  const losers = matchedLots.filter((l) => l.realizedPnl <= 0);

  const avgWinningHoldDays =
    winners.length > 0
      ? winners.reduce((s, l) => s + l.holdingDays, 0) / winners.length
      : 0;

  const avgLosingHoldDays =
    losers.length > 0
      ? losers.reduce((s, l) => s + l.holdingDays, 0) / losers.length
      : 0;

  const totalWins = winners.reduce((s, l) => s + l.realizedPnl, 0);
  const totalLosses = Math.abs(losers.reduce((s, l) => s + l.realizedPnl, 0));

  const avgWinAmount = winners.length > 0 ? totalWins / winners.length : 0;
  const avgLossAmount = losers.length > 0 ? totalLosses / losers.length : 0;
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

  const largestWin =
    matchedLots.length > 0
      ? Math.max(...matchedLots.map((l) => l.realizedPnl))
      : 0;
  const largestLoss =
    matchedLots.length > 0
      ? Math.min(...matchedLots.map((l) => l.realizedPnl))
      : 0;

  return {
    ...portfolio,
    avgWinningHoldDays,
    avgLosingHoldDays,
    avgWinAmount,
    avgLossAmount,
    profitFactor,
    largestWin,
    largestLoss,
    openPositionCount: positions.length,
    totalOpenValue: positions.reduce((s, p) => s + p.marketValueIls, 0),
  };
}

/**
 * P&L breakdown by groupBy parameter.
 */
export async function getPnlBreakdown(groupBy: 'ticker' | 'month' | 'market') {
  switch (groupBy) {
    case 'ticker':
      return getPnlByTicker();
    case 'month':
      return getPnlByMonth();
    case 'market':
      return getPnlByMarket();
    default:
      return getPnlByTicker();
  }
}

/**
 * Get total trade count from DB (includes both open and closed).
 */
export async function getTotalTradeCount(): Promise<number> {
  return prisma.trade.count({
    where: { direction: { in: [...CORE_DIRECTIONS] } },
  });
}
