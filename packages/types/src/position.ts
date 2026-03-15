import type { Currency, Market } from "./trade";

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
