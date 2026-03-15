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
