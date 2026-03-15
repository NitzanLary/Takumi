export type AlertType =
  | "price_drop"
  | "price_target"
  | "holding_duration"
  | "portfolio_pnl"
  | "sync_failure"
  | "inactivity";

export type AlertStatus = "active" | "triggered" | "dismissed";

export interface Alert {
  id: string;
  ticker?: string;
  type: AlertType;
  threshold: number;
  status: AlertStatus;
  triggeredAt?: string;
  message?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAlertInput {
  ticker?: string;
  type: AlertType;
  threshold: number;
  message?: string;
}
