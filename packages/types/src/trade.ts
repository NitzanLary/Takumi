export type Market = "TASE" | "NYSE" | "NASDAQ";
export type CoreDirection = "BUY" | "SELL";
export type NonTradeDirection =
  | "TRANSFER"
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "FEE"
  | "DIVIDEND"
  | "INTEREST"
  | "TAX"
  | "CREDIT"
  | "DEBIT"
  | "REDEMPTION"
  | "CONVERSION"
  | "RIGHTS"
  | "BONUS"
  | "SPLIT";
export type Direction = CoreDirection | NonTradeDirection;
export const CORE_DIRECTIONS: CoreDirection[] = ["BUY", "SELL"];
export type Currency = "ILS" | "USD";
export type TradeSource = "ibi_api" | "csv_import" | "xlsx_import";

export interface Trade {
  id: string;
  tradeId: string;
  ticker: string;
  securityName: string;
  market: Market;
  direction: Direction;
  quantity: number;
  price: number;
  currency: Currency;
  commission: number;
  proceedsFx?: number;
  proceedsIls?: number;
  capitalGainsTax?: number;
  tradeDate: string; // ISO 8601
  source: TradeSource;
  rawPayload?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TradeFilters {
  ticker?: string;
  market?: Market;
  direction?: Direction;
  dateFrom?: string;
  dateTo?: string;
  source?: TradeSource;
  page?: number;
  limit?: number;
  includeNonTrades?: boolean;
}
