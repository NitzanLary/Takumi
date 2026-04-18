"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { formatCurrency, formatPercent, isHebrew } from "@/lib/formatters";

interface AnalyticsSummary {
  totalRealizedPnl: number;
  totalTrades: number;
  totalTradeCount: number;
  winRate: number;
  avgHoldingDays: number;
  avgReturn: number;
  avgWinningHoldDays: number;
  avgLosingHoldDays: number;
  avgWinAmount: number;
  avgLossAmount: number;
  profitFactor: number;
  largestWin: number;
  largestLoss: number;
  openPositionCount: number;
  totalOpenValue: number;
}

interface TickerPnl {
  ticker: string;
  securityName: string;
  market: string;
  currency: string;
  realizedPnl: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgHoldingDays: number;
}

interface MarketPnl {
  market: string;
  realizedPnl: number;
  tradeCount: number;
  winRate: number;
}

interface MonthlyPnl {
  year: number;
  month: number;
  realizedPnl: number;
  tradeCount: number;
}

interface RiskMetrics {
  herfindahlIndex: number | null;
  maxDrawdown: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  topConcentration: { top3: number; top5: number } | null;
  dataPoints: number;
}

export default function AnalyticsPage() {
  const { data: summary } = useQuery({
    queryKey: ["analytics-summary"],
    queryFn: () => apiFetch<AnalyticsSummary>("/api/analytics/summary"),
  });

  const { data: tickerPnl } = useQuery({
    queryKey: ["analytics-pnl", "ticker"],
    queryFn: () =>
      apiFetch<TickerPnl[]>("/api/analytics/pnl?groupBy=ticker"),
  });

  const { data: marketPnl } = useQuery({
    queryKey: ["analytics-pnl", "market"],
    queryFn: () =>
      apiFetch<MarketPnl[]>("/api/analytics/pnl?groupBy=market"),
  });

  const { data: monthlyPnl } = useQuery({
    queryKey: ["analytics-pnl", "month"],
    queryFn: () =>
      apiFetch<MonthlyPnl[]>("/api/analytics/pnl?groupBy=month"),
  });

  const { data: riskMetrics } = useQuery({
    queryKey: ["analytics-risk"],
    queryFn: () => apiFetch<RiskMetrics>("/api/analytics/risk"),
  });

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Analytics</h2>

      {/* Behavioral stats */}
      {summary && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Win Rate"
            value={`${summary.winRate.toFixed(1)}%`}
          />
          <StatCard
            label="Profit Factor"
            value={
              summary.profitFactor === Infinity
                ? "N/A"
                : summary.profitFactor.toFixed(2)
            }
          />
          <StatCard
            label="Avg Win"
            value={formatCurrency(summary.avgWinAmount, "USD")}
            color="text-green-600"
          />
          <StatCard
            label="Avg Loss"
            value={`-${formatCurrency(summary.avgLossAmount, "USD")}`}
            color="text-red-600"
          />
          <StatCard
            label="Largest Win"
            value={formatCurrency(summary.largestWin, "USD")}
            color="text-green-600"
          />
          <StatCard
            label="Largest Loss"
            value={formatCurrency(summary.largestLoss, "USD")}
            color="text-red-600"
          />
          <StatCard
            label="Avg Winning Hold"
            value={`${Math.round(summary.avgWinningHoldDays)} days`}
          />
          <StatCard
            label="Avg Losing Hold"
            value={`${Math.round(summary.avgLosingHoldDays)} days`}
          />
        </div>
      )}

      {/* TASE vs US comparison */}
      {marketPnl && marketPnl.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h3 className="mb-4 text-lg font-semibold">TASE vs US Performance</h3>
          <div className="grid grid-cols-2 gap-6">
            {marketPnl.map((m) => (
              <div
                key={m.market}
                className="rounded-lg border border-gray-100 bg-gray-50 p-4"
              >
                <p className="text-sm font-medium text-gray-600">
                  {m.market === "TASE" ? "TASE (Israeli)" : "US (NYSE/NASDAQ)"}
                </p>
                <p
                  className={`mt-1 text-2xl font-bold ${
                    m.realizedPnl >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {formatCurrency(m.realizedPnl, m.market === "TASE" ? "ILS" : "USD")}
                </p>
                <div className="mt-2 flex gap-4 text-sm text-gray-500">
                  <span>{m.tradeCount} trades</span>
                  <span>{m.winRate.toFixed(0)}% win rate</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-ticker P&L breakdown */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">P&L Breakdown by Ticker</h3>
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-100">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {[
                  "Ticker",
                  "Name",
                  "Market",
                  "Realized P&L",
                  "Trades",
                  "Win/Loss",
                  "Win Rate",
                  "Avg Hold",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {!tickerPnl?.length ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-gray-400"
                  >
                    No closed trades to analyze yet.
                  </td>
                </tr>
              ) : (
                tickerPnl.map((t) => (
                  <tr key={t.ticker} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                      {t.ticker}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                      <span dir={isHebrew(t.securityName) ? "rtl" : "ltr"}>
                        {t.securityName}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {t.market}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-3 text-sm font-medium ${
                        t.realizedPnl >= 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {formatCurrency(t.realizedPnl, t.currency as "ILS" | "USD")}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      {t.tradeCount}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <span className="text-green-600">{t.winCount}W</span>
                      {" / "}
                      <span className="text-red-600">{t.lossCount}L</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      {t.winRate.toFixed(0)}%
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {Math.round(t.avgHoldingDays)}d
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly P&L Heatmap */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold">Monthly P&L Heatmap</h3>
        {!monthlyPnl?.length ? (
          <div className="flex h-40 items-center justify-center text-gray-400">
            No monthly data available yet.
          </div>
        ) : (
          <MonthlyHeatmap data={monthlyPnl} />
        )}
      </div>

      {/* Risk Metrics */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold">Risk Metrics</h3>
        {riskMetrics ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Concentration (HHI)"
              value={
                riskMetrics.herfindahlIndex != null
                  ? riskMetrics.herfindahlIndex.toFixed(3)
                  : "N/A"
              }
              subtitle={
                riskMetrics.topConcentration
                  ? `Top 3: ${(riskMetrics.topConcentration.top3 * 100).toFixed(0)}%`
                  : undefined
              }
            />
            <StatCard
              label="Max Drawdown"
              value={
                riskMetrics.maxDrawdown != null
                  ? formatPercent(riskMetrics.maxDrawdown * 100)
                  : "Insufficient data"
              }
              color={riskMetrics.maxDrawdown != null ? "text-red-600" : "text-gray-400"}
            />
            <StatCard
              label="Sharpe Ratio"
              value={
                riskMetrics.sharpeRatio != null
                  ? riskMetrics.sharpeRatio.toFixed(2)
                  : "Insufficient data"
              }
              color={
                riskMetrics.sharpeRatio != null
                  ? riskMetrics.sharpeRatio >= 1
                    ? "text-green-600"
                    : "text-gray-900"
                  : "text-gray-400"
              }
            />
            <StatCard
              label="Sortino Ratio"
              value={
                riskMetrics.sortinoRatio != null
                  ? riskMetrics.sortinoRatio.toFixed(2)
                  : "Insufficient data"
              }
              color={
                riskMetrics.sortinoRatio != null
                  ? riskMetrics.sortinoRatio >= 1
                    ? "text-green-600"
                    : "text-gray-900"
                  : "text-gray-400"
              }
            />
          </div>
        ) : (
          <div className="flex h-20 items-center justify-center text-gray-400">
            Loading risk metrics...
          </div>
        )}
        {riskMetrics && riskMetrics.dataPoints < 10 && (
          <p className="mt-3 text-xs text-gray-400">
            {riskMetrics.dataPoints} snapshots captured. Sharpe, Sortino, and max drawdown require at least 10 daily snapshots.
          </p>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color = "text-gray-900",
  subtitle,
}: {
  label: string;
  value: string;
  color?: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${color}`}>{value}</p>
      {subtitle && <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>}
    </div>
  );
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function MonthlyHeatmap({ data }: { data: MonthlyPnl[] }) {
  // Group by year
  const byYear = new Map<number, Map<number, MonthlyPnl>>();
  for (const entry of data) {
    if (!byYear.has(entry.year)) byYear.set(entry.year, new Map());
    byYear.get(entry.year)!.set(entry.month, entry);
  }

  const years = Array.from(byYear.keys()).sort();

  // Find max absolute P&L for color scaling
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.realizedPnl)), 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left text-xs font-medium text-gray-500">Year</th>
            {MONTH_LABELS.map((m) => (
              <th key={m} className="px-1 py-1 text-center text-xs font-medium text-gray-500">
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {years.map((year) => (
            <tr key={year}>
              <td className="px-2 py-1 text-sm font-medium text-gray-700">{year}</td>
              {MONTH_LABELS.map((_, monthIdx) => {
                const entry = byYear.get(year)?.get(monthIdx + 1);
                if (!entry) {
                  return (
                    <td key={monthIdx} className="px-1 py-1">
                      <div className="mx-auto h-8 w-full rounded bg-gray-50" />
                    </td>
                  );
                }
                const intensity = Math.min(Math.abs(entry.realizedPnl) / maxAbs, 1);
                const alpha = 0.15 + intensity * 0.75;
                const bg = entry.realizedPnl >= 0
                  ? `rgba(34, 197, 94, ${alpha})`
                  : `rgba(239, 68, 68, ${alpha})`;
                return (
                  <td key={monthIdx} className="px-1 py-1">
                    <div
                      className="flex h-8 items-center justify-center rounded text-xs font-medium"
                      style={{ backgroundColor: bg }}
                      title={`${MONTH_LABELS[monthIdx]} ${year}: $${Math.round(entry.realizedPnl)} (${entry.tradeCount} trades)`}
                    >
                      {entry.tradeCount > 0 && (
                        <span className={entry.realizedPnl >= 0 ? "text-green-900" : "text-red-900"}>
                          {entry.realizedPnl >= 0 ? "+" : ""}{Math.round(entry.realizedPnl)}
                        </span>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
