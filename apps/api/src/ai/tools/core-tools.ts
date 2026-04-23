/**
 * Core Agent Tools (11 total) — the fundamental tools for portfolio Q&A,
 * trade queries, P&L analysis, market data, alerts, and sync status.
 *
 * Step 2: 6 read-only tools implemented.
 * Step 4: Remaining 5 tools (alerts, sync, what-if) to be added.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { getOpenPositions } from '../../services/position.service.js';
import { getPortfolioSummary, getPnlByTicker, getPnlByMonth, getPnlByMarket } from '../../services/pnl.service.js';
import { getTrades } from '../../services/trade.service.js';
import { getAnalyticsSummary } from '../../services/analytics.service.js';
import { getLatestPrices } from '../../services/market.service.js';
import { getSyncStatus, getSyncLog } from '../../services/sync.service.js';
import { runWhatIf as runWhatIfService, type WhatIfInput } from '../../services/whatif.service.js';
import { prisma } from '../../lib/db.js';

export type ToolExecutor = (
  userId: string,
  input: Record<string, unknown>
) => Promise<unknown>;

// ─── Tool Schemas ───────────────────────────────────────────────

export const coreToolSchemas: Anthropic.Messages.Tool[] = [
  {
    name: 'get_portfolio_summary',
    description:
      'Get current open positions with live market prices, total portfolio value, unrealized P&L, and realized P&L summary. Use this when the user asks about their portfolio, positions, current holdings, or portfolio value.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'query_trades',
    description:
      'Search and filter trade history. Returns paginated trade records. Use this when the user asks about specific trades, trade history, or wants to look up transactions by ticker, date, market, or direction.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: {
          type: 'string',
          description: 'Filter by ticker symbol (partial match supported)',
        },
        dateFrom: {
          type: 'string',
          description: 'Start date filter (ISO 8601 format, e.g. 2024-01-01)',
        },
        dateTo: {
          type: 'string',
          description: 'End date filter (ISO 8601 format, e.g. 2024-12-31)',
        },
        direction: {
          type: 'string',
          enum: ['BUY', 'SELL'],
          description: 'Filter by trade direction',
        },
        market: {
          type: 'string',
          enum: ['TASE', 'NYSE', 'NASDAQ'],
          description: 'Filter by market',
        },
        limit: {
          type: 'number',
          description: 'Max number of trades to return (default 20, max 100)',
        },
        includeNonTrades: {
          type: 'boolean',
          description: 'Include non-trade transactions like dividends, fees, taxes (default false)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_pnl_breakdown',
    description:
      'Get realized P&L breakdown grouped by ticker, month, or market. Use this when the user asks about profitability, which stocks made/lost money, monthly performance, or TASE vs US comparison.',
    input_schema: {
      type: 'object' as const,
      properties: {
        groupBy: {
          type: 'string',
          enum: ['ticker', 'month', 'market'],
          description: 'How to group the P&L data',
        },
      },
      required: ['groupBy'],
    },
  },
  {
    name: 'get_behavioral_report',
    description:
      'Get comprehensive behavioral analytics including win rate, average holding periods for winners vs losers, profit factor, largest win/loss, and open position summary. Use this for behavioral coaching and pattern analysis.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_market_price',
    description:
      'Get the current market price for a specific ticker. Returns live price from Yahoo Finance (or cached within 15 minutes), day change, 52-week range, and volume.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: {
          type: 'string',
          description: 'The ticker symbol to look up',
        },
        market: {
          type: 'string',
          enum: ['TASE', 'NYSE', 'NASDAQ'],
          description: 'The market (helps resolve TASE paper numbers to Yahoo symbols)',
        },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'get_sync_status',
    description:
      'Get the status of the most recent data import and recent import history. Use this when the user asks about sync status, last import, or data freshness.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  // ─── Alert tools (Step 4) ───
  {
    name: 'create_alert',
    description:
      'Create a new alert to monitor a condition. Supports price drops, price targets, holding duration, portfolio P&L, and sync failure alerts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: ['price_drop', 'price_target', 'holding_duration', 'portfolio_pnl', 'sync_failure', 'inactivity'],
          description: 'The type of alert',
        },
        ticker: {
          type: 'string',
          description: 'Ticker symbol (required for price_drop, price_target, holding_duration)',
        },
        threshold: {
          type: 'number',
          description: 'Alert threshold value (e.g., percentage for price_drop, price for price_target, days for holding_duration)',
        },
        message: {
          type: 'string',
          description: 'Optional custom message for the alert',
        },
      },
      required: ['type', 'threshold'],
    },
  },
  {
    name: 'list_alerts',
    description:
      'List all alerts, optionally filtered by status or ticker.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'triggered', 'dismissed'],
          description: 'Filter by alert status',
        },
        ticker: {
          type: 'string',
          description: 'Filter by ticker symbol',
        },
      },
      required: [],
    },
  },
  {
    name: 'delete_alert',
    description:
      'Delete an alert by its ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'The alert ID to delete',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'trigger_sync',
    description:
      'Trigger a data sync. Currently data is imported via XLSX file upload, so this will provide guidance on how to import data.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'run_what_if',
    description:
      'Run a what-if scenario analysis. Supports stop-loss simulation (what if every loss was cut at X%?) and modified sell date scenarios.',
    input_schema: {
      type: 'object' as const,
      properties: {
        scenario: {
          type: 'string',
          enum: ['stop_loss', 'modified_sell_date'],
          description: 'Type of what-if scenario',
        },
        ticker: {
          type: 'string',
          description: 'Specific ticker to analyze (optional for stop_loss, required for modified_sell_date)',
        },
        stopLossPercent: {
          type: 'number',
          description: 'Stop-loss threshold percentage (e.g., 5 means cut losses at -5%). Used with stop_loss scenario.',
        },
        sellDate: {
          type: 'string',
          description: 'Hypothetical sell date (ISO 8601). Used with modified_sell_date scenario.',
        },
      },
      required: ['scenario'],
    },
  },
];

// ─── Tool Executors ─────────────────────────────────────────────

async function execGetPortfolioSummary(userId: string): Promise<unknown> {
  const [positions, summary] = await Promise.all([
    getOpenPositions(userId),
    getPortfolioSummary(userId),
  ]);

  return {
    positions: positions.map((p) => ({
      ticker: p.ticker,
      securityName: p.securityName,
      market: p.market,
      currency: p.currency,
      quantity: p.quantity,
      avgCostBasis: p.avgCostBasis,
      currentPrice: p.currentPrice,
      marketValue: p.marketValue,
      marketValueIls: p.marketValueIls,
      unrealizedPnl: p.unrealizedPnl,
      unrealizedPnlIls: p.unrealizedPnlIls,
      unrealizedPnlPct: p.unrealizedPnlPct,
      weight: p.weight,
      dayChange: p.dayChange,
      dayChangePct: p.dayChangePct,
      priceSource: p.priceSource,
    })),
    totalPortfolioValueIls: positions.reduce((s, p) => s + p.marketValueIls, 0),
    totalUnrealizedPnlIls: positions.reduce((s, p) => s + p.unrealizedPnlIls, 0),
    totalsCurrency: 'ILS',
    ...summary,
  };
}

async function execQueryTrades(
  userId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const limit = Math.min(Number(input.limit) || 20, 100);
  return getTrades(userId, {
    ticker: input.ticker as string | undefined,
    dateFrom: input.dateFrom as string | undefined,
    dateTo: input.dateTo as string | undefined,
    direction: input.direction as any,
    market: input.market as any,
    includeNonTrades: (input.includeNonTrades as boolean) || false,
    limit,
    page: 1,
  });
}

async function execGetPnlBreakdown(
  userId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const groupBy = (input.groupBy as string) || 'ticker';
  switch (groupBy) {
    case 'ticker':
      return getPnlByTicker(userId);
    case 'month':
      return getPnlByMonth(userId);
    case 'market':
      return getPnlByMarket(userId);
    default:
      return getPnlByTicker(userId);
  }
}

async function execGetBehavioralReport(userId: string): Promise<unknown> {
  return getAnalyticsSummary(userId);
}

async function execGetMarketPrice(
  _userId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const ticker = input.ticker as string;
  const market = (input.market as string) || 'NYSE';
  const currency = market === 'TASE' ? 'ILS' : 'USD';

  const prices = await getLatestPrices([{ ticker, market, currency }]);
  const quote = prices.get(ticker);

  if (!quote) {
    return { error: `No price data available for ${ticker}. It may be an unmapped TASE ticker.` };
  }

  return {
    ticker,
    price: quote.price,
    currency: quote.currency,
    dayChange: quote.dayChange,
    dayChangePct: quote.dayChangePct,
    high52w: quote.high52w,
    low52w: quote.low52w,
    volume: quote.volume,
    fetchedAt: quote.fetchedAt,
  };
}

async function execGetSyncStatus(userId: string): Promise<unknown> {
  const [status, recentLogs] = await Promise.all([
    getSyncStatus(userId),
    getSyncLog(userId, 5),
  ]);

  return {
    ...status,
    recentImports: recentLogs.map((log) => ({
      syncedAt: log.syncedAt.toISOString(),
      status: log.status,
      recordsAdded: log.recordsAdded,
      fileName: log.fileName,
      errorMessage: log.errorMessage,
    })),
  };
}

async function execCreateAlert(
  userId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const alert = await prisma.alert.create({
    data: {
      userId,
      type: input.type as string,
      ticker: (input.ticker as string) || null,
      threshold: input.threshold as number,
      message: (input.message as string) || null,
      status: 'active',
    },
  });

  return {
    id: alert.id,
    type: alert.type,
    ticker: alert.ticker,
    threshold: Number(alert.threshold),
    status: alert.status,
    message: alert.message,
    createdAt: alert.createdAt.toISOString(),
  };
}

async function execListAlerts(
  userId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const where: Record<string, unknown> = { userId };
  if (input.status) where.status = input.status;
  if (input.ticker) where.ticker = input.ticker;

  const alerts = await prisma.alert.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  return alerts.map((a) => ({
    id: a.id,
    type: a.type,
    ticker: a.ticker,
    threshold: Number(a.threshold),
    status: a.status,
    triggeredAt: a.triggeredAt?.toISOString() ?? null,
    message: a.message,
    createdAt: a.createdAt.toISOString(),
  }));
}

async function execDeleteAlert(
  userId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const id = input.id as string;
  // deleteMany so the alert is only removed if it belongs to this user.
  const result = await prisma.alert.deleteMany({ where: { id, userId } });
  if (result.count === 0) {
    return { error: `Alert with ID ${id} not found.` };
  }
  return { success: true, message: `Alert ${id} deleted.` };
}

async function execTriggerSync(): Promise<unknown> {
  return {
    message:
      'Data import is currently done via XLSX file upload. Go to the Import page in Takumi to upload an IBI transactions export file. I can check the latest import status for you — just ask!',
  };
}

async function execRunWhatIf(
  userId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  return runWhatIfService(userId, {
    scenario: input.scenario as WhatIfInput['scenario'],
    ticker: input.ticker as string | undefined,
    stopLossPercent: input.stopLossPercent as number | undefined,
    sellDate: input.sellDate as string | undefined,
  });
}

// ─── Executor Map ───────────────────────────────────────────────

export const coreToolExecutors: Map<string, ToolExecutor> = new Map([
  ['get_portfolio_summary', execGetPortfolioSummary],
  ['query_trades', execQueryTrades],
  ['get_pnl_breakdown', execGetPnlBreakdown],
  ['get_behavioral_report', execGetBehavioralReport],
  ['get_market_price', execGetMarketPrice],
  ['get_sync_status', execGetSyncStatus],
  ['create_alert', execCreateAlert],
  ['list_alerts', execListAlerts],
  ['delete_alert', execDeleteAlert],
  ['trigger_sync', execTriggerSync],
  ['run_what_if', execRunWhatIf],
]);
