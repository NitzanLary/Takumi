"use client";

import Link from "next/link";
import type { StockSummary } from "@takumi/types";
import { useChatStore } from "@/stores/chat-store";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  isHebrew,
} from "@/lib/formatters";

export function StockHeader({ summary }: { summary: StockSummary }) {
  const openChat = useChatStore((s) => s.open);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const startNew = useChatStore((s) => s.startNewConversation);

  const askAi = () => {
    startNew();
    openChat();
    const prompt = summary.isClosed
      ? `Analyze my historical trading in ${summary.ticker} (${summary.securityName}). I no longer hold this position.`
      : `Analyze my current position in ${summary.ticker} (${summary.securityName}).`;
    void sendMessage(prompt);
  };

  const p = summary.position;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-bold text-gray-900">{summary.ticker}</h2>
            <span
              className="text-lg text-gray-600"
              dir={isHebrew(summary.securityName) ? "rtl" : "ltr"}
            >
              {summary.securityName}
            </span>
          </div>
          {summary.priorNames.length > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              Formerly known as{" "}
              {summary.priorNames.map((n, i) => (
                <span key={n}>
                  <span
                    className="font-medium text-gray-700"
                    dir={isHebrew(n) ? "rtl" : "ltr"}
                  >
                    {n}
                  </span>
                  {i < summary.priorNames.length - 1 ? ", " : ""}
                </span>
              ))}
              {" "}— the broker renamed this security, trade history below reflects original labels.
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">
              {summary.market}
            </span>
            {summary.sector && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
                {summary.sector}
                {summary.industry ? ` · ${summary.industry}` : ""}
              </span>
            )}
            {summary.isClosed ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">
                Fully sold
              </span>
            ) : (
              <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700">
                Open position
              </span>
            )}
            {summary.firstBuyDate && (
              <span className="text-gray-500">
                First buy {formatDate(summary.firstBuyDate)}
                {summary.holdingDays != null && ` · ${summary.holdingDays} days`}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={askAi}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Ask AI about this stock
          </button>
          <Link
            href="/positions"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ← Positions
          </Link>
        </div>
      </div>

      {p ? (
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Shares" value={formatNumber(p.quantity)} />
          <Stat
            label="Avg cost"
            value={formatCurrency(p.avgCostBasis, p.currency)}
          />
          <Stat
            label="Current price"
            value={formatCurrency(p.currentPrice, p.currency)}
            subtitle={
              p.dayChangePct != null
                ? `${p.dayChangePct >= 0 ? "+" : ""}${p.dayChangePct.toFixed(2)}% today`
                : undefined
            }
            subtitleColor={
              p.dayChangePct != null
                ? p.dayChangePct >= 0
                  ? "text-green-600"
                  : "text-red-600"
                : undefined
            }
          />
          <Stat
            label="Market value"
            value={formatCurrency(p.marketValue, p.currency)}
          />
          <Stat
            label="Unrealized P&L"
            value={formatCurrency(p.unrealizedPnl, p.currency)}
            subtitle={formatPercent(p.unrealizedPnlPct)}
            subtitleColor={
              p.unrealizedPnl >= 0 ? "text-green-600" : "text-red-600"
            }
            valueColor={p.unrealizedPnl >= 0 ? "text-green-600" : "text-red-600"}
          />
          <Stat label="Portfolio weight" value={`${p.weight.toFixed(1)}%`} />
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
          Fully sold. Last transaction{" "}
          {summary.lastTransactionDate
            ? formatDate(summary.lastTransactionDate)
            : "—"}
          .
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  subtitle,
  valueColor = "text-gray-900",
  subtitleColor = "text-gray-500",
}: {
  label: string;
  value: string;
  subtitle?: string;
  valueColor?: string;
  subtitleColor?: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-1 text-base font-semibold ${valueColor}`}>{value}</p>
      {subtitle && (
        <p className={`text-xs ${subtitleColor}`}>{subtitle}</p>
      )}
    </div>
  );
}
