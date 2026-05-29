"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { EquityCurveResponse, EquityCurveWindow } from "@takumi/types";
import { apiFetch } from "@/lib/api-client";
import { formatCurrency, formatNumber } from "@/lib/formatters";

const WINDOWS: { value: EquityCurveWindow; label: string }[] = [
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "ytd", label: "YTD" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "All" },
];

export function EquityCurveCard() {
  const [window, setWindow] = useState<EquityCurveWindow>("1m");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["equity-curve", window],
    queryFn: () =>
      apiFetch<EquityCurveResponse>(`/api/analytics/equity-curve?window=${window}`),
  });

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-gray-900">Equity Curve</h3>
        <TimeframeToggle value={window} onChange={setWindow} />
      </div>

      <div className="h-64">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-gray-400">
            <p>Loading historical data…</p>
          </div>
        ) : isError ? (
          <div className="flex h-full items-center justify-center text-red-500">
            <p>Failed to load equity curve.</p>
          </div>
        ) : !data || data.points.length < 2 ? (
          <div className="flex h-full items-center justify-center text-gray-400">
            <p>Not enough history yet for this window.</p>
          </div>
        ) : (
          <EquityChart points={data.points} />
        )}
      </div>

      <KpiStrip kpis={data?.kpis} loading={isLoading} />

      {data && data.warnings.length > 0 && (
        <details className="mt-3 text-xs text-amber-700">
          <summary className="cursor-pointer">
            {data.warnings.length} ticker{data.warnings.length === 1 ? "" : "s"} without complete history
          </summary>
          <ul className="mt-1 ml-4 list-disc text-amber-600">
            {data.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function TimeframeToggle({
  value,
  onChange,
}: {
  value: EquityCurveWindow;
  onChange: (w: EquityCurveWindow) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
      {WINDOWS.map(({ value: v, label }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            value === v
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

interface ChartPoint {
  date: string;
  totalValueIls: number;
  externalCapitalIls: number;
}

function EquityChart({ points }: { points: ChartPoint[] }) {
  const chartData = points.map((p) => ({
    date: p.date,
    label: formatChartDate(p.date),
    fullDate: formatFullDate(p.date),
    "Account Value": Math.round(p.totalValueIls),
    "Cumulative Invested": Math.round(p.externalCapitalIls),
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11 }}
          stroke="#9ca3af"
          minTickGap={30}
        />
        <YAxis
          tick={{ fontSize: 11 }}
          stroke="#9ca3af"
          tickFormatter={(v: number) => formatNumber(v)}
          width={70}
        />
        <Tooltip
          formatter={(value: number) => formatCurrency(value, "ILS")}
          labelFormatter={(_label, payload: Array<{ payload?: { fullDate?: string } }>) =>
            payload?.[0]?.payload?.fullDate ?? _label
          }
        />
        <Legend
          wrapperStyle={{ fontSize: 12 }}
          iconType="line"
          align="left"
          verticalAlign="top"
          height={28}
        />
        <Line
          type="monotone"
          dataKey="Account Value"
          stroke="#2563eb"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="Cumulative Invested"
          stroke="#9ca3af"
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function KpiStrip({
  kpis,
  loading,
}: {
  kpis: EquityCurveResponse["kpis"] | undefined;
  loading: boolean;
}) {
  const realized = kpis?.realizedPnlIls ?? 0;
  const returnPct = kpis?.totalReturnPct ?? 0;

  return (
    <div className="mt-4 grid grid-cols-2 gap-4 border-t border-gray-100 pt-4">
      <Kpi
        label="Realized P&L (window)"
        value={
          loading ? (
            <Skeleton />
          ) : (
            <SignedAmount amount={realized} render={(n) => formatCurrency(n, "ILS")} />
          )
        }
      />
      <Kpi
        label="Total Return (window)"
        value={
          loading ? (
            <Skeleton />
          ) : (
            <SignedAmount
              amount={returnPct}
              render={(n) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`}
            />
          )
        }
      />
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <p className="text-sm text-gray-600">{label}</p>
      <div className="text-right">{value}</div>
    </div>
  );
}

function SignedAmount({
  amount,
  render,
}: {
  amount: number;
  render: (n: number) => string;
}) {
  const color =
    amount > 0
      ? "text-green-600"
      : amount < 0
        ? "text-red-600"
        : "text-gray-900";
  const prefix = amount > 0 ? "+" : "";
  const text = render(amount);
  // Avoid double "+" when render already adds one
  const display = text.startsWith("+") || text.startsWith("-") ? text : `${prefix}${text}`;
  return <p className={`text-lg font-semibold ${color}`}>{display}</p>;
}

function Skeleton() {
  return <span className="inline-block h-5 w-24 animate-pulse rounded bg-gray-100" />;
}

function formatChartDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatFullDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}
