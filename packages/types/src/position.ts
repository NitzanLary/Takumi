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
