/**
 * Tier 1 Agent Tools (7 total) — data enrichment derived from existing DB data.
 * No external API calls needed — all computed from trades table and FIFO matching.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { runFifoMatching, type MatchedLot } from '../../services/pnl.service.js';
import { getOpenPositions } from '../../services/position.service.js';
import { prisma } from '../../lib/db.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

import type { ToolExecutor } from './core-tools.js';

// Load sector map
let sectorMap: Record<string, { sector: string; industry: string }> = {};
try {
  sectorMap = require('../../data/sector-map.json');
} catch {
  // Map not available
}

// ─── Tool Schemas ───────────────────────────────────────────────

export const tier1ToolSchemas: Anthropic.Messages.Tool[] = [
  {
    name: 'get_dividend_summary',
    description:
      'Get dividend income summary. Aggregates gross dividends, withholding tax, and net income from DIVIDEND and TAX transactions. Can filter by year and/or ticker.',
    input_schema: {
      type: 'object' as const,
      properties: {
        year: {
          type: 'number',
          description: 'Filter by year (e.g., 2024)',
        },
        ticker: {
          type: 'string',
          description: 'Filter by specific ticker',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_cost_analysis',
    description:
      'Analyze trading costs (commissions). Shows total fees, average commission rate, cost as percentage of gains, and identifies trades where commissions were disproportionately high.',
    input_schema: {
      type: 'object' as const,
      properties: {
        year: {
          type: 'number',
          description: 'Filter by year',
        },
        market: {
          type: 'string',
          enum: ['TASE', 'NYSE', 'NASDAQ'],
          description: 'Filter by market',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_performance_timeline',
    description:
      'Get P&L timeline with per-ticker attribution. Shows which tickers contributed to gains or losses in each time period.',
    input_schema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string',
          enum: ['monthly', 'quarterly'],
          description: 'Time granularity for the timeline',
        },
        year: {
          type: 'number',
          description: 'Filter by year',
        },
      },
      required: ['period'],
    },
  },
  {
    name: 'get_streaks',
    description:
      'Analyze win/loss streaks. Shows current streak, longest winning and losing streaks, and detects overtrading patterns after losing streaks.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_sector_exposure',
    description:
      'Get portfolio allocation by sector and industry. Shows current position weights grouped by sector with concentration warnings.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_security_info',
    description:
      'Get detailed information about a specific security including sector, industry, and market data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: {
          type: 'string',
          description: 'The ticker symbol to look up',
        },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'get_holding_period_analysis',
    description:
      'Analyze the relationship between holding period and trade outcomes. Shows win/loss distribution across different holding period buckets (day trades, swing trades, position trades, etc.).',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// ─── Tool Executors ─────────────────────────────────────────────

async function execGetDividendSummary(
  userId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const where: Record<string, unknown> = {
    userId,
    direction: { in: ['DIVIDEND', 'TAX'] },
  };

  if (input.year) {
    const year = input.year as number;
    where.tradeDate = {
      gte: new Date(`${year}-01-01`),
      lt: new Date(`${year + 1}-01-01`),
    };
  }
  if (input.ticker) {
    where.ticker = input.ticker;
  }

  const transactions = await prisma.trade.findMany({
    where,
    orderBy: { tradeDate: 'desc' },
  });

  if (transactions.length === 0) {
    return { message: 'No dividend or tax transactions found for the given filters.', transactions: [] };
  }

  // Aggregate by ticker
  const byTicker = new Map<string, { dividends: number; taxes: number; count: number }>();
  for (const t of transactions) {
    const entry = byTicker.get(t.ticker) || { dividends: 0, taxes: 0, count: 0 };
    const amount = Math.abs(Number(t.proceedsFx ?? t.price) * Number(t.quantity));

    if (t.direction === 'DIVIDEND') {
      entry.dividends += amount;
    } else if (t.direction === 'TAX') {
      entry.taxes += amount;
    }
    entry.count++;
    byTicker.set(t.ticker, entry);
  }

  const byTickerArray = Array.from(byTicker.entries()).map(([ticker, data]) => ({
    ticker,
    grossDividends: data.dividends,
    taxWithheld: data.taxes,
    netIncome: data.dividends - data.taxes,
    effectiveTaxRate: data.dividends > 0 ? (data.taxes / data.dividends) * 100 : 0,
    transactionCount: data.count,
  }));

  const totalGross = byTickerArray.reduce((s, t) => s + t.grossDividends, 0);
  const totalTax = byTickerArray.reduce((s, t) => s + t.taxWithheld, 0);

  return {
    totalGrossDividends: totalGross,
    totalTaxWithheld: totalTax,
    totalNetIncome: totalGross - totalTax,
    effectiveTaxRate: totalGross > 0 ? (totalTax / totalGross) * 100 : 0,
    byTicker: byTickerArray.sort((a, b) => b.grossDividends - a.grossDividends),
  };
}

async function execGetCostAnalysis(
  userId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const where: Record<string, unknown> = {
    userId,
    direction: { in: ['BUY', 'SELL'] },
  };

  if (input.year) {
    const year = input.year as number;
    where.tradeDate = {
      gte: new Date(`${year}-01-01`),
      lt: new Date(`${year + 1}-01-01`),
    };
  }
  if (input.market) {
    where.market = input.market;
  }

  const trades = await prisma.trade.findMany({ where });

  if (trades.length === 0) {
    return { message: 'No trades found for the given filters.' };
  }

  let totalCommission = 0;
  let totalTradeValue = 0;
  let highCostTrades = 0;

  for (const t of trades) {
    const commission = Number(t.commission);
    const tradeValue = Number(t.quantity) * Number(t.price);
    totalCommission += commission;
    totalTradeValue += tradeValue;

    // High-cost trade: commission > 0.5% of trade value
    if (tradeValue > 0 && commission / tradeValue > 0.005) {
      highCostTrades++;
    }
  }

  const { matchedLots } = await runFifoMatching(userId);
  const totalRealizedGains = matchedLots
    .filter((l) => l.realizedPnl > 0)
    .reduce((s, l) => s + l.realizedPnl, 0);

  return {
    totalCommissions: totalCommission,
    totalTradeValue,
    avgCommissionRate: totalTradeValue > 0 ? (totalCommission / totalTradeValue) * 100 : 0,
    commissionPerTrade: trades.length > 0 ? totalCommission / trades.length : 0,
    costAsPercentOfGains: totalRealizedGains > 0 ? (totalCommission / totalRealizedGains) * 100 : 0,
    totalTrades: trades.length,
    highCostTrades,
    highCostTradePercent: trades.length > 0 ? (highCostTrades / trades.length) * 100 : 0,
  };
}

async function execGetPerformanceTimeline(
  userId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const period = (input.period as string) || 'monthly';
  const year = input.year as number | undefined;
  const { matchedLots } = await runFifoMatching(userId);

  const filteredLots = year
    ? matchedLots.filter((l) => l.sellDate.getFullYear() === year)
    : matchedLots;

  // Group by time period
  const byPeriod = new Map<string, Map<string, number>>();

  for (const lot of filteredLots) {
    const d = lot.sellDate;
    let key: string;
    if (period === 'quarterly') {
      const q = Math.ceil((d.getMonth() + 1) / 3);
      key = `${d.getFullYear()} Q${q}`;
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    if (!byPeriod.has(key)) byPeriod.set(key, new Map());
    const tickerMap = byPeriod.get(key)!;
    tickerMap.set(lot.ticker, (tickerMap.get(lot.ticker) || 0) + lot.realizedPnl);
  }

  const timeline = Array.from(byPeriod.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodKey, tickerMap]) => {
      const contributions = Array.from(tickerMap.entries())
        .map(([ticker, pnl]) => ({ ticker, pnl }))
        .sort((a, b) => b.pnl - a.pnl);

      return {
        period: periodKey,
        totalPnl: contributions.reduce((s, c) => s + c.pnl, 0),
        tradeCount: contributions.length,
        topContributors: contributions.slice(0, 3),
        bottomContributors: contributions.slice(-3).reverse(),
      };
    });

  return { period, timeline };
}

async function execGetStreaks(userId: string): Promise<unknown> {
  const { matchedLots } = await runFifoMatching(userId);

  // Sort by sell date
  const sorted = [...matchedLots].sort(
    (a, b) => a.sellDate.getTime() - b.sellDate.getTime()
  );

  if (sorted.length === 0) {
    return { message: 'No closed trades found for streak analysis.' };
  }

  let currentStreak = 0;
  let currentStreakType: 'win' | 'loss' | null = null;
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let tempStreak = 0;
  let tempType: 'win' | 'loss' | null = null;

  const streakHistory: Array<{ type: 'win' | 'loss'; length: number; endDate: string }> = [];

  for (const lot of sorted) {
    const isWin = lot.realizedPnl > 0;
    const type = isWin ? 'win' : 'loss';

    if (type === tempType) {
      tempStreak++;
    } else {
      if (tempType && tempStreak > 0) {
        streakHistory.push({
          type: tempType,
          length: tempStreak,
          endDate: sorted[sorted.indexOf(lot) - 1]?.sellDate.toISOString().split('T')[0] || '',
        });
      }
      tempType = type;
      tempStreak = 1;
    }

    if (type === 'win') {
      longestWinStreak = Math.max(longestWinStreak, tempStreak);
    } else {
      longestLossStreak = Math.max(longestLossStreak, tempStreak);
    }
  }

  // Final streak is the current one
  currentStreak = tempStreak;
  currentStreakType = tempType;

  // Detect overtrading after losing streaks (3+ losses)
  let overtradingDetected = false;
  for (let i = 0; i < streakHistory.length; i++) {
    const streak = streakHistory[i];
    if (streak.type === 'loss' && streak.length >= 3) {
      // Check if trade frequency increased in the next period
      overtradingDetected = true;
    }
  }

  return {
    currentStreak: {
      type: currentStreakType,
      length: currentStreak,
    },
    longestWinStreak,
    longestLossStreak,
    totalTrades: sorted.length,
    recentStreaks: streakHistory.slice(-5),
    overtradingWarning: overtradingDetected
      ? 'Detected losing streaks of 3+ trades. Watch for overtrading as a reaction to losses.'
      : null,
  };
}

async function execGetSectorExposure(userId: string): Promise<unknown> {
  const positions = await getOpenPositions(userId);

  if (positions.length === 0) {
    return { message: 'No open positions to analyze.' };
  }

  const bySector = new Map<string, { valueIls: number; weight: number; tickers: string[] }>();

  for (const p of positions) {
    const mapping = sectorMap[p.ticker];
    const sector = mapping?.sector || 'Unknown';

    const entry = bySector.get(sector) || { valueIls: 0, weight: 0, tickers: [] };
    // Use ILS-normalized value so TASE and US positions aggregate coherently.
    entry.valueIls += p.marketValueIls;
    entry.weight += p.weight;
    entry.tickers.push(p.ticker);
    bySector.set(sector, entry);
  }

  const sectors = Array.from(bySector.entries())
    .map(([sector, data]) => ({
      sector,
      marketValueIls: data.valueIls,
      weight: data.weight,
      positionCount: data.tickers.length,
      tickers: data.tickers,
    }))
    .sort((a, b) => b.weight - a.weight);

  const warnings: string[] = [];
  for (const s of sectors) {
    if (s.weight > 40) {
      warnings.push(`High concentration in ${s.sector}: ${s.weight.toFixed(1)}% of portfolio`);
    }
  }

  return { sectors, warnings };
}

async function execGetSecurityInfo(
  userId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const ticker = input.ticker as string;

  const security = await prisma.security.findUnique({
    where: { ticker },
  });

  const mapping = sectorMap[ticker];

  // Also get trade summary for this ticker (scoped to this user)
  const tradeCount = await prisma.trade.count({
    where: { userId, ticker, direction: { in: ['BUY', 'SELL'] } },
  });

  return {
    ticker,
    name: security?.name || null,
    market: security?.market || null,
    currency: security?.currency || null,
    yahooSymbol: security?.yahooSymbol || null,
    sector: mapping?.sector || security?.sector || null,
    industry: mapping?.industry || security?.industry || null,
    marketCapBucket: security?.marketCapBucket || null,
    totalTradeCount: tradeCount,
  };
}

async function execGetHoldingPeriodAnalysis(userId: string): Promise<unknown> {
  const { matchedLots } = await runFifoMatching(userId);

  if (matchedLots.length === 0) {
    return { message: 'No closed trades found for holding period analysis.' };
  }

  const buckets = [
    { label: 'Day trades (0-1 days)', min: 0, max: 1 },
    { label: 'Swing trades (2-7 days)', min: 2, max: 7 },
    { label: 'Short-term (1-4 weeks)', min: 8, max: 28 },
    { label: 'Medium-term (1-3 months)', min: 29, max: 90 },
    { label: 'Long-term (3-6 months)', min: 91, max: 180 },
    { label: 'Very long-term (6+ months)', min: 181, max: Infinity },
  ];

  const analysis = buckets.map((bucket) => {
    const lotsInBucket = matchedLots.filter(
      (l) => l.holdingDays >= bucket.min && l.holdingDays <= bucket.max
    );

    const wins = lotsInBucket.filter((l) => l.realizedPnl > 0);
    const losses = lotsInBucket.filter((l) => l.realizedPnl <= 0);
    const totalPnl = lotsInBucket.reduce((s, l) => s + l.realizedPnl, 0);
    const avgPnl = lotsInBucket.length > 0 ? totalPnl / lotsInBucket.length : 0;

    return {
      bucket: bucket.label,
      tradeCount: lotsInBucket.length,
      winCount: wins.length,
      lossCount: losses.length,
      winRate: lotsInBucket.length > 0 ? (wins.length / lotsInBucket.length) * 100 : 0,
      totalPnl,
      avgPnl,
      avgHoldingDays:
        lotsInBucket.length > 0
          ? lotsInBucket.reduce((s, l) => s + l.holdingDays, 0) / lotsInBucket.length
          : 0,
    };
  }).filter((b) => b.tradeCount > 0);

  // Find optimal holding period
  const bestBucket = analysis.reduce(
    (best, b) => (b.winRate > best.winRate ? b : best),
    analysis[0]
  );

  return {
    analysis,
    optimalHoldingPeriod: bestBucket
      ? `Your best win rate (${bestBucket.winRate.toFixed(1)}%) is in the "${bestBucket.bucket}" category.`
      : null,
    totalClosedTrades: matchedLots.length,
  };
}

// ─── Executor Map ───────────────────────────────────────────────

export const tier1ToolExecutors: Map<string, ToolExecutor> = new Map([
  ['get_dividend_summary', execGetDividendSummary],
  ['get_cost_analysis', execGetCostAnalysis],
  ['get_performance_timeline', execGetPerformanceTimeline],
  ['get_streaks', execGetStreaks],
  ['get_sector_exposure', execGetSectorExposure],
  ['get_security_info', execGetSecurityInfo],
  ['get_holding_period_analysis', execGetHoldingPeriodAnalysis],
]);
