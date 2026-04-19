import type { Currency, Market } from "./trade";
import type { PriceSource } from "./market";

export interface Position {
  ticker: string;
  securityName: string;
  market: Market;
  quantity: number;
  avgCostBasis: number;
  currentPrice: number;
  currency: Currency;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  marketValue: number;
  // ILS-normalized fields — use these for cross-position aggregation/weights.
  // Equal to the native fields for ILS positions; for USD positions, converted
  // at the current BOI rate.
  marketValueIls: number;
  totalCostIls: number;
  unrealizedPnlIls: number;
  priceSource: PriceSource;
  dayChange: number | null;
  dayChangePct: number | null;
  weight: number;
}

export interface PortfolioSummary {
  totalValue: number;
  totalRealizedPnl: number;
  totalUnrealizedPnl: number;
  winRate: number;
  totalTrades: number;
  avgHoldingDays: number;
  currency: Currency;
}
