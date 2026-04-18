/**
 * Tier 2 Agent Tools (3 total) — powered by Phase 3 market data infrastructure.
 * Uses Yahoo Finance prices, Bank of Israel exchange rates, and risk metrics.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { getBenchmarks } from '../../services/market.service.js';
import { getSnapshots } from '../../services/snapshot.service.js';
import { getOpenPositions } from '../../services/position.service.js';
import { getCurrentRate, getRate } from '../../services/exchange-rate.service.js';
import { getRiskMetrics } from '../../services/risk.service.js';
import { prisma } from '../../lib/db.js';

export type ToolExecutor = (input: Record<string, unknown>) => Promise<unknown>;

// ─── Tool Schemas ───────────────────────────────────────────────

export const tier2ToolSchemas: Anthropic.Messages.Tool[] = [
  {
    name: 'get_benchmark_comparison',
    description:
      'Compare portfolio or a specific ticker performance against benchmarks (TA-125 and S&P 500). Shows relative performance and alpha.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: {
          type: 'string',
          description: 'Compare a specific ticker (if omitted, compares the whole portfolio)',
        },
        period: {
          type: 'string',
          enum: ['ytd', '1y', 'all'],
          description: 'Time period for comparison (default: all)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_currency_impact',
    description:
      'Analyze the impact of ILS/USD exchange rate changes on the portfolio. Shows how currency movements affected USD-denominated positions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        year: {
          type: 'number',
          description: 'Filter by year',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_risk_report',
    description:
      'Get a comprehensive risk analysis with narrative interpretation. Includes Herfindahl concentration index, max drawdown, Sharpe ratio, Sortino ratio, and actionable suggestions.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// ─── Tool Executors ─────────────────────────────────────────────

async function execGetBenchmarkComparison(input: Record<string, unknown>): Promise<unknown> {
  const [benchmarks, snapshots] = await Promise.all([
    getBenchmarks(),
    getSnapshots(),
  ]);

  if (snapshots.length < 2) {
    return {
      message: 'Not enough portfolio snapshots for comparison. Need at least 2 daily snapshots.',
      benchmarks: {
        ta125: benchmarks.ta125 ? { price: benchmarks.ta125.price, dayChangePct: benchmarks.ta125.dayChangePct } : null,
        sp500: benchmarks.sp500 ? { price: benchmarks.sp500.price, dayChangePct: benchmarks.sp500.dayChangePct } : null,
      },
    };
  }

  // Calculate portfolio return from snapshots
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const firstValue = Number(first.totalValue);
  const lastValue = Number(last.totalValue);
  const portfolioReturn = firstValue > 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;

  // If specific ticker requested, find its P&L
  let tickerReturn: number | null = null;
  if (input.ticker) {
    const ticker = input.ticker as string;
    const trades = await prisma.trade.findMany({
      where: { ticker, direction: { in: ['BUY', 'SELL'] } },
      orderBy: { tradeDate: 'asc' },
    });

    const totalBought = trades
      .filter((t) => t.direction === 'BUY')
      .reduce((s, t) => s + Number(t.quantity) * Number(t.price), 0);

    const totalSold = trades
      .filter((t) => t.direction === 'SELL')
      .reduce((s, t) => s + Number(t.quantity) * Number(t.price), 0);

    if (totalBought > 0) {
      tickerReturn = ((totalSold - totalBought) / totalBought) * 100;
    }
  }

  return {
    portfolio: {
      return: portfolioReturn,
      startDate: first.date,
      endDate: last.date,
      startValue: firstValue,
      endValue: lastValue,
    },
    ...(input.ticker ? { tickerReturn: { ticker: input.ticker, return: tickerReturn } } : {}),
    benchmarks: {
      ta125: benchmarks.ta125
        ? {
            price: benchmarks.ta125.price,
            dayChangePct: benchmarks.ta125.dayChangePct,
          }
        : null,
      sp500: benchmarks.sp500
        ? {
            price: benchmarks.sp500.price,
            dayChangePct: benchmarks.sp500.dayChangePct,
          }
        : null,
    },
    note: 'Benchmark comparison shows current index levels and day change. For historical benchmark returns, daily OHLCV data is needed (Phase 5).',
  };
}

async function execGetCurrencyImpact(input: Record<string, unknown>): Promise<unknown> {
  const positions = await getOpenPositions();
  const usdPositions = positions.filter((p) => p.currency === 'USD');

  if (usdPositions.length === 0) {
    return { message: 'No USD-denominated positions found.' };
  }

  const currentRate = await getCurrentRate();

  // Get rate from start of year or start of all time
  const year = input.year as number | undefined;
  let startDate: Date;
  if (year) {
    startDate = new Date(`${year}-01-01`);
  } else {
    const firstTrade = await prisma.trade.findFirst({
      where: { currency: 'USD', direction: { in: ['BUY', 'SELL'] } },
      orderBy: { tradeDate: 'asc' },
    });
    startDate = firstTrade?.tradeDate || new Date();
  }

  let startRate: number;
  try {
    startRate = await getRate(startDate);
  } catch {
    startRate = currentRate;
  }

  const rateChange = currentRate - startRate;
  const rateChangePct = startRate > 0 ? (rateChange / startRate) * 100 : 0;

  // Calculate ILS impact on USD positions
  const totalUsdValue = usdPositions.reduce((s, p) => s + p.marketValue, 0);
  const ilsImpact = totalUsdValue * (rateChange / currentRate);

  const positionImpact = usdPositions.map((p) => ({
    ticker: p.ticker,
    usdValue: p.marketValue,
    ilsImpactEstimate: p.marketValue * (rateChange / currentRate),
  }));

  return {
    currentRate,
    startRate,
    startDate: startDate.toISOString().split('T')[0],
    rateChange,
    rateChangePct,
    shekelStrengthened: rateChange < 0,
    totalUsdExposure: totalUsdValue,
    estimatedIlsImpact: ilsImpact,
    interpretation: rateChange < 0
      ? `The shekel strengthened by ${Math.abs(rateChangePct).toFixed(1)}%, reducing the ILS value of your USD holdings by approximately ${Math.abs(ilsImpact).toFixed(0)} ILS.`
      : `The shekel weakened by ${rateChangePct.toFixed(1)}%, increasing the ILS value of your USD holdings by approximately ${ilsImpact.toFixed(0)} ILS.`,
    positionImpact: positionImpact.sort((a, b) => Math.abs(b.ilsImpactEstimate) - Math.abs(a.ilsImpactEstimate)),
  };
}

async function execGetRiskReport(): Promise<unknown> {
  const metrics = await getRiskMetrics();

  // Build narrative
  const narratives: string[] = [];

  // Herfindahl interpretation
  if (metrics.herfindahlIndex > 0.25) {
    narratives.push(`Your portfolio is highly concentrated (HHI: ${(metrics.herfindahlIndex * 100).toFixed(0)}%). Consider diversifying.`);
  } else if (metrics.herfindahlIndex > 0.15) {
    narratives.push(`Your portfolio has moderate concentration (HHI: ${(metrics.herfindahlIndex * 100).toFixed(0)}%).`);
  } else {
    narratives.push(`Your portfolio is well-diversified (HHI: ${(metrics.herfindahlIndex * 100).toFixed(0)}%).`);
  }

  // Drawdown
  if (metrics.maxDrawdown < -0.2) {
    narratives.push(`Maximum drawdown of ${(metrics.maxDrawdown * 100).toFixed(1)}% is significant. Consider position sizing.`);
  } else if (metrics.maxDrawdown < -0.1) {
    narratives.push(`Maximum drawdown of ${(metrics.maxDrawdown * 100).toFixed(1)}% is within normal range.`);
  }

  // Sharpe
  if (metrics.sharpeRatio > 1) {
    narratives.push(`Sharpe ratio of ${metrics.sharpeRatio.toFixed(2)} indicates strong risk-adjusted returns.`);
  } else if (metrics.sharpeRatio > 0) {
    narratives.push(`Sharpe ratio of ${metrics.sharpeRatio.toFixed(2)} indicates positive but modest risk-adjusted returns.`);
  } else {
    narratives.push(`Sharpe ratio of ${metrics.sharpeRatio.toFixed(2)} indicates returns are not compensating for the risk taken.`);
  }

  // Top concentration
  if (metrics.topConcentration) {
    const top3Pct = metrics.topConcentration.top3 * 100;
    if (top3Pct > 60) {
      narratives.push(`Top 3 positions represent ${top3Pct.toFixed(0)}% of portfolio — high single-position risk.`);
    }
  }

  return {
    metrics: {
      herfindahlIndex: metrics.herfindahlIndex,
      maxDrawdown: metrics.maxDrawdown,
      sharpeRatio: metrics.sharpeRatio,
      sortinoRatio: metrics.sortinoRatio,
      dataPoints: metrics.dataPoints,
    },
    topConcentration: metrics.topConcentration,
    narrative: narratives.join(' '),
    suggestions: [
      metrics.herfindahlIndex > 0.25 ? 'Consider adding positions in underrepresented sectors.' : null,
      metrics.maxDrawdown < -0.15 ? 'Consider implementing stop-loss rules to limit drawdown.' : null,
      metrics.sharpeRatio < 0.5 ? 'Review your entry/exit timing — risk is not being adequately rewarded.' : null,
    ].filter(Boolean),
  };
}

// ─── Executor Map ───────────────────────────────────────────────

export const tier2ToolExecutors: Map<string, ToolExecutor> = new Map([
  ['get_benchmark_comparison', execGetBenchmarkComparison],
  ['get_currency_impact', execGetCurrencyImpact],
  ['get_risk_report', execGetRiskReport],
]);
