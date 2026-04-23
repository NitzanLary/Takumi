import type { Currency, Market } from "./trade";
import type { Position } from "./position";

export interface StockOpenLot {
  buyDate: string;
  quantity: number;
  buyPrice: number;
  commission: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  currency: Currency;
}

export interface StockRoundTrip {
  buyDate: string;
  sellDate: string;
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  commission: number;
  realizedPnl: number;
  returnPct: number;
  holdingDays: number;
  currency: Currency;
}

export interface StockRealizedPnl {
  currency: Currency;
  realizedPnl: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
}

export interface StockFeesPaid {
  currency: Currency;
  amount: number;
  buyCount: number;
  sellCount: number;
}

export interface StockDividendSummary {
  currency: Currency;
  gross: number;
  taxWithheld: number;
  net: number;
  paymentCount: number;
}

export interface StockCurrencyImpact {
  priceMoveIls: number;
  fxMoveIls: number;
  totalUnrealizedPnlIls: number;
  rateNow: number;
}

export interface StockSummary {
  ticker: string;
  /** Current display name (Yahoo longName / shortName when available, else latest trade's securityName). */
  securityName: string;
  /** Distinct legacy names from the user's own trades that differ from securityName — populated after ticker renames (e.g. "FACEBOOK(FB)" on the META page). */
  priorNames: string[];
  market: Market;
  currency: Currency;
  sector: string | null;
  industry: string | null;
  firstBuyDate: string | null;
  lastTransactionDate: string | null;
  holdingDays: number | null;
  isClosed: boolean;
  position: Position | null;
  realizedPnl: StockRealizedPnl[];
  totalFeesPaid: StockFeesPaid[];
  totalDividends: StockDividendSummary[];
  currencyImpact: StockCurrencyImpact | null;
}

export interface StockChartPoint {
  date: string;
  close: number;
}

export type StockChartReason = "unmapped_tase" | "fetch_failed" | "no_buys";

export type StockChartResponse =
  | {
      available: true;
      currency: Currency;
      priceSource: "yahoo" | "stooq";
      points: StockChartPoint[];
    }
  | {
      available: false;
      reason: StockChartReason;
      message: string;
    };
