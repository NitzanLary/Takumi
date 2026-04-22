"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  PaginatedResponse,
  StockChartResponse,
  StockSummary,
  Trade,
} from "@takumi/types";
import { apiFetch } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/formatters";

interface Props {
  summary: StockSummary;
}

export function StockChart({ summary }: Props) {
  const { data: chart, isLoading } = useQuery<StockChartResponse>({
    queryKey: ["stock-chart", summary.ticker],
    queryFn: () =>
      apiFetch<StockChartResponse>(
        `/api/stock/${encodeURIComponent(summary.ticker)}/chart`
      ),
  });

  // Include SPLIT rows so pre-split marker prices can be adjusted to match
  // Yahoo's split-adjusted price line (same math as pnl.service FIFO).
  const { data: tradesRes } = useQuery({
    queryKey: ["stock-trades-for-chart", summary.ticker],
    queryFn: () =>
      apiFetch<PaginatedResponse<Trade>>(
        `/api/trades?ticker=${encodeURIComponent(summary.ticker)}&limit=500&includeNonTrades=true`
      ),
  });

  const trades = tradesRes?.data ?? [];
  const currency = summary.currency;

  const chartData = useMemo(() => {
    if (!chart?.available) return [];
    return chart.points.map((p) => ({ date: p.date, close: p.close }));
  }, [chart]);

  // Match each BUY/SELL to a chart point by date. If the exact day is missing
  // (weekend/holiday), fall back to the nearest prior data point so the
  // marker still renders on the axis. For tickers that had stock splits, the
  // raw trade price is pre-split but Yahoo's line is split-adjusted — apply
  // cumulative split ratios so markers sit on the line.
  const markers = useMemo(() => {
    if (!chart?.available || chartData.length === 0) return [];
    const dates = chartData.map((d) => d.date);

    // Walk chronologically, tracking running share count so we can compute
    // each SPLIT's ratio = (openQtyBeforeSplit + bonus) / openQtyBeforeSplit.
    // Then for every prior BUY/SELL, divide its price by that ratio (same
    // transform pnl.service applies to cost basis).
    const chrono = [...trades]
      .filter((t) => t.direction === "BUY" || t.direction === "SELL" || t.direction === "SPLIT")
      .sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime());

    type Marker = { date: string; price: number; direction: "BUY" | "SELL" };
    const collected: Marker[] = [];
    let openQty = 0;
    for (const t of chrono) {
      if (t.direction === "SPLIT") {
        if (openQty > 0 && t.quantity !== 0) {
          const ratio = (openQty + t.quantity) / openQty;
          for (const m of collected) {
            m.price /= ratio;
          }
        }
        openQty += t.quantity;
        continue;
      }
      const day = t.tradeDate.slice(0, 10);
      let matched = day;
      if (!dates.includes(day)) {
        const prior = dates.filter((d) => d <= day);
        matched = prior.length > 0 ? prior[prior.length - 1] : dates[0];
      }
      const direction: "BUY" | "SELL" = t.direction === "BUY" ? "BUY" : "SELL";
      collected.push({ date: matched, price: t.price, direction });
      openQty += direction === "BUY" ? t.quantity : -t.quantity;
    }
    return collected;
  }, [chart, chartData, trades]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Price history</h3>
          <p className="text-xs text-gray-500">
            {summary.firstBuyDate
              ? `From ${formatDate(summary.firstBuyDate)} to today`
              : "From first buy to today"}
            {chart?.available && chart.priceSource === "stooq" && " · Stooq"}
            {chart?.available && chart.priceSource === "yahoo" && " · Yahoo Finance"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <LegendDot color="bg-green-500" label="Buy" />
          <LegendDot color="bg-red-500" label="Sell" />
          {summary.position && (
            <span className="flex items-center gap-1 text-gray-500">
              <span className="inline-block h-0.5 w-4 bg-gray-400" />
              Avg cost
            </span>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center text-sm text-gray-400">
          Loading price history…
        </div>
      ) : !chart?.available ? (
        <div className="flex h-64 flex-col items-center justify-center gap-1 text-sm text-gray-500">
          <p className="font-medium text-gray-700">
            Price chart unavailable
          </p>
          <p className="text-xs text-gray-500">{chart?.message}</p>
        </div>
      ) : chartData.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-gray-400">
          No price data for this range.
        </div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
                tickFormatter={(v: string) =>
                  new Date(v).toLocaleDateString("en-US", {
                    month: "short",
                    year: "2-digit",
                  })
                }
                minTickGap={40}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => formatCurrency(v, currency)}
                width={80}
              />
              <Tooltip
                formatter={(value: number) => [formatCurrency(value, currency), "Close"]}
                labelFormatter={(v: string) => formatDate(v)}
              />
              <Line
                type="monotone"
                dataKey="close"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              {summary.position && (
                <ReferenceLine
                  y={summary.position.avgCostBasis}
                  stroke="#9ca3af"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                />
              )}
              {markers.map((m, i) => (
                <ReferenceDot
                  key={`${m.date}-${m.direction}-${i}`}
                  x={m.date}
                  y={m.price}
                  r={5}
                  fill={m.direction === "BUY" ? "#16a34a" : "#dc2626"}
                  stroke="#fff"
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-gray-500">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
