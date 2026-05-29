export interface PnlBreakdown {
  ticker: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  tradeCount: number;
  winRate: number;
  avgHoldingDays: number;
  currency: string;
}

export type PnlWindow = 'all' | 'ytd' | '12m' | '1w' | '1m' | '1y';

export type EquityCurveWindow = '1w' | '1m' | 'ytd' | '1y' | 'all';

export interface EquityCurvePoint {
  date: string;
  totalValueIls: number;
  externalCapitalIls: number;
}

export interface EquityCurveKpis {
  realizedPnlIls: number;
  totalReturnPct: number;
}

export interface EquityCurveResponse {
  window: EquityCurveWindow;
  points: EquityCurvePoint[];
  kpis: EquityCurveKpis;
  warnings: string[];
}

export interface MarketPnlBreakdown {
  market: string;
  realizedPnl: number;
  realizedPnlIls: number;
  tradeCount: number;
  winRate: number;
}

export interface BehavioralReport {
  overallWinRate: number;
  avgWinningHoldDays: number;
  avgLosingHoldDays: number;
  bestDayOfWeek: string;
  worstDayOfWeek: string;
  taseWinRate: number;
  usWinRate: number;
  avgWinAmount: number;
  avgLossAmount: number;
  profitFactor: number;
  overtradingPeriods: string[];
}

export interface MonthlyPnl {
  year: number;
  month: number;
  pnl: number;
  tradeCount: number;
}

export interface DailyYield {
  date: string;
  cumulativeReturn: number;
  dailyReturn: number;
}
