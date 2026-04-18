"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/formatters";
import type { SyncState } from "@takumi/types";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface CurrencyPnl {
  currency: string;
  realizedPnl: number;
  tradeCount: number;
}

interface SnapshotData {
  id: string;
  date: string;
  totalValue: number;
  totalCostBasis: number;
  unrealizedPnl: number;
  realizedPnl: number;
  positionCount: number;
}

interface AnalyticsSummary {
  totalRealizedPnl: number;
  pnlByCurrency: CurrencyPnl[];
  totalTrades: number;
  totalTradeCount: number;
  winRate: number;
  avgHoldingDays: number;
  avgReturn: number;
  openPositionCount: number;
  totalOpenValue: number;
}

export default function DashboardPage() {
  const queryClient = useQueryClient();

  const { data: syncStatus } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => apiFetch<SyncState>("/api/sync/status"),
    refetchInterval: 30_000,
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ["analytics-summary"],
    queryFn: () => apiFetch<AnalyticsSummary>("/api/analytics/summary"),
  });

  const { data: snapshots } = useQuery({
    queryKey: ["snapshots"],
    queryFn: () => apiFetch<SnapshotData[]>("/api/snapshots"),
  });

  const captureMutation = useMutation({
    mutationFn: () => apiFetch("/api/snapshots/capture", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["snapshots"] }),
  });

  const pnlDisplay = analytics?.pnlByCurrency?.length
    ? analytics.pnlByCurrency
        .map((p) => formatCurrency(p.realizedPnl, p.currency as "ILS" | "USD"))
        .join("\n")
    : analytics
      ? formatCurrency(analytics.totalRealizedPnl, "USD")
      : "—";

  const pnlColor =
    analytics && analytics.totalRealizedPnl >= 0
      ? "text-green-600"
      : "text-red-600";

  const kpis = [
    {
      label: "Total Realized P&L",
      value: pnlDisplay,
      color: pnlColor,
      multiLine: (analytics?.pnlByCurrency?.length ?? 0) > 1,
    },
    {
      label: "Win Rate",
      value: analytics
        ? `${analytics.winRate.toFixed(1)}%`
        : "—",
      color: "text-gray-900",
      multiLine: false,
    },
    {
      label: "Total Trades",
      value: analytics ? formatNumber(analytics.totalTradeCount) : "—",
      color: "text-gray-900",
      multiLine: false,
    },
    {
      label: "Avg Return",
      value: analytics ? formatPercent(analytics.avgReturn) : "—",
      color:
        analytics && analytics.avgReturn >= 0
          ? "text-green-600"
          : "text-red-600",
      multiLine: false,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
          {syncStatus?.lastSyncAt && (
            <p className="text-sm text-gray-500">
              Last import: {new Date(syncStatus.lastSyncAt).toLocaleString()}
              {syncStatus.lastStatus === "success" &&
                syncStatus.recordsAdded !== undefined && (
                  <span className="ml-2 text-green-600">
                    ({syncStatus.recordsAdded} records imported)
                  </span>
                )}
              {syncStatus.lastStatus === "failed" && (
                <span className="ml-2 text-red-600">— failed</span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl border border-gray-200 bg-white p-5"
          >
            <p className="text-sm text-gray-500">{kpi.label}</p>
            {analyticsLoading ? (
              <span className="mt-1 inline-block h-7 w-24 animate-pulse rounded bg-gray-100" />
            ) : kpi.multiLine && analytics?.pnlByCurrency ? (
              <div className="mt-1 space-y-0.5">
                {analytics.pnlByCurrency.map((p) => (
                  <p
                    key={p.currency}
                    className={`text-xl font-semibold ${
                      p.realizedPnl >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatCurrency(p.realizedPnl, p.currency as "ILS" | "USD")}
                  </p>
                ))}
              </div>
            ) : (
              <p className={`mt-1 text-2xl font-semibold ${kpi.color}`}>
                {kpi.value}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Summary cards */}
      {analytics && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-500">Open Positions</p>
            <p className="mt-1 text-xl font-semibold text-gray-900">
              {analytics.openPositionCount}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-500">Avg Holding Period</p>
            <p className="mt-1 text-xl font-semibold text-gray-900">
              {Math.round(analytics.avgHoldingDays)} days
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-500">Closed Trades (FIFO)</p>
            <p className="mt-1 text-xl font-semibold text-gray-900">
              {analytics.totalTrades}
            </p>
          </div>
        </div>
      )}

      {/* Equity Curve */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Equity Curve</h3>
          <button
            onClick={() => captureMutation.mutate()}
            disabled={captureMutation.isPending}
            className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
          >
            {captureMutation.isPending ? "Capturing..." : "Capture Snapshot"}
          </button>
        </div>
        {!snapshots || snapshots.length < 2 ? (
          <div className="flex h-64 items-center justify-center text-gray-400">
            <p className="text-center">
              {snapshots?.length === 1
                ? "One snapshot captured. Need at least 2 data points for the chart."
                : "No snapshots yet. Click \"Capture Snapshot\" to start tracking your portfolio value over time."}
            </p>
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={snapshots.map((s) => ({
                  date: new Date(s.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  }),
                  fullDate: new Date(s.date).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  }),
                  value: Math.round(s.totalValue),
                  pnl: Math.round(s.unrealizedPnl),
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  stroke="#9ca3af"
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  stroke="#9ca3af"
                  tickFormatter={(v: number) => formatNumber(v)}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    formatNumber(value),
                    name === "value" ? "Portfolio Value" : "Unrealized P&L",
                  ]}
                  labelFormatter={(_label: string, payload: Array<{ payload?: { fullDate?: string } }>) =>
                    payload?.[0]?.payload?.fullDate ?? _label
                  }
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={false}
                  name="value"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
