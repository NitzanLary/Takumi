import type { Currency } from "./trade";

export interface MarketQuote {
  ticker: string;
  price: number;
  dayChange: number | null;
  dayChangePct: number | null;
  high52w: number | null;
  low52w: number | null;
  volume: number | null;
  currency: Currency;
  fetchedAt: string;
}

export interface ExchangeRateEntry {
  date: string;
  rate: number;
}

export type PriceSource = "live" | "cached" | "placeholder";

export interface RiskMetrics {
  herfindahlIndex: number | null;
  maxDrawdown: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  topConcentration: {
    top3: number;
    top5: number;
  } | null;
  dataPoints: number;
}
