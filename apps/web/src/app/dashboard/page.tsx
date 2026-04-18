"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { formatCurrency, formatNumber } from "@/lib/formatters";
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

type Currency = "ILS" | "USD";
type MarketRegion = "TASE" | "US";

interface OpenPosition {
  ticker: string;
  market: string;
  currency: Currency;
  totalCost: number;
  marketValue: number;
  unrealizedPnl: number;
  priceSource: "live" | "cached" | "placeholder";
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

interface ExchangeRate {
  date: string;
  rate: number | null;
}

interface MarketBucket {
  region: MarketRegion;
  currency: Currency;
  marketValue: number;
  totalCost: number;
  unrealizedPnl: number;
  positionCount: number;
}

interface CurrencyBucket {
  marketValue: number;
  totalCost: number;
  unrealizedPnl: number;
  positionCount: number;
}

function regionFor(market: string): MarketRegion {
  return market === "TASE" ? "TASE" : "US";
}

export default function DashboardPage() {
  const queryClient = useQueryClient();

  const { data: syncStatus } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => apiFetch<SyncState>("/api/sync/status"),
    refetchInterval: 30_000,
  });

  const { data: positions, isLoading: positionsLoading } = useQuery({
    queryKey: ["positions"],
    queryFn: () => apiFetch<OpenPosition[]>("/api/positions"),
    refetchInterval: 60_000,
  });

  const { data: snapshots } = useQuery({
    queryKey: ["snapshots"],
    queryFn: () => apiFetch<SnapshotData[]>("/api/snapshots"),
  });

  const { data: fx } = useQuery({
    queryKey: ["exchange-rate"],
    queryFn: () => apiFetch<ExchangeRate>("/api/exchange-rates"),
  });

  const captureMutation = useMutation({
    mutationFn: () => apiFetch("/api/snapshots/capture", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["snapshots"] }),
  });

  const rate = fx?.rate ?? null; // ILS per USD

  const convert = (value: number, from: Currency, to: Currency): number | null => {
    if (from === to) return value;
    if (!rate || rate <= 0) return null;
    if (from === "USD" && to === "ILS") return value * rate;
    if (from === "ILS" && to === "USD") return value / rate;
    return null;
  };

  // Aggregate per market region and per currency
  const byRegion = new Map<MarketRegion, MarketBucket>();
  const byCurrency: Record<Currency, CurrencyBucket> = {
    ILS: { marketValue: 0, totalCost: 0, unrealizedPnl: 0, positionCount: 0 },
    USD: { marketValue: 0, totalCost: 0, unrealizedPnl: 0, positionCount: 0 },
  };

  for (const p of positions ?? []) {
    const region = regionFor(p.market);
    const bucket = byRegion.get(region) ?? {
      region,
      currency: p.currency,
      marketValue: 0,
      totalCost: 0,
      unrealizedPnl: 0,
      positionCount: 0,
    };
    bucket.marketValue += p.marketValue;
    bucket.totalCost += p.totalCost;
    bucket.unrealizedPnl += p.unrealizedPnl;
    bucket.positionCount += 1;
    byRegion.set(region, bucket);

    byCurrency[p.currency].marketValue += p.marketValue;
    byCurrency[p.currency].totalCost += p.totalCost;
    byCurrency[p.currency].unrealizedPnl += p.unrealizedPnl;
    byCurrency[p.currency].positionCount += 1;
  }

  const currencies: Currency[] = (["ILS", "USD"] as const).filter(
    (c) => byCurrency[c].positionCount > 0
  );

  const totalPositions = positions?.length ?? 0;
  const hasPlaceholders = positions?.some((p) => p.priceSource === "placeholder");

  const regionOrder: MarketRegion[] = ["TASE", "US"];
  const regionCards = regionOrder
    .map((r) => byRegion.get(r))
    .filter((b): b is MarketBucket => Boolean(b));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
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

      {hasPlaceholders && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          Some TASE positions show placeholder prices. Unrealized P&L for those holdings reflects cost basis until live prices become available.
        </div>
      )}

      {/* KPI Cards — unrealized focus */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiMultiCurrencyCard
          label="Total Unrealized P&L"
          loading={positionsLoading}
          currencies={currencies}
          values={Object.fromEntries(
            currencies.map((c) => [c, byCurrency[c].unrealizedPnl])
          ) as Record<Currency, number>}
          signedColor
        />
        <KpiMultiCurrencyCard
          label="Total Market Value"
          loading={positionsLoading}
          currencies={currencies}
          values={Object.fromEntries(
            currencies.map((c) => [c, byCurrency[c].marketValue])
          ) as Record<Currency, number>}
        />
        <KpiMultiCurrencyCard
          label="Total Cost Basis"
          loading={positionsLoading}
          currencies={currencies}
          values={Object.fromEntries(
            currencies.map((c) => [c, byCurrency[c].totalCost])
          ) as Record<Currency, number>}
        />
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-500">Open Positions</p>
          {positionsLoading ? (
            <span className="mt-1 inline-block h-7 w-16 animate-pulse rounded bg-gray-100" />
          ) : (
            <p className="mt-1 text-2xl font-semibold text-gray-900">
              {totalPositions}
            </p>
          )}
        </div>
      </div>

      {/* Unrealized P&L by Market */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Unrealized P&L by Market</h3>
          {rate && (
            <p className="text-xs text-gray-400">
              FX: 1 USD = {rate.toFixed(3)} ILS
            </p>
          )}
        </div>
        {regionCards.length === 0 ? (
          <div className="flex h-28 items-center justify-center text-gray-400">
            No open positions.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {regionCards.map((bucket) => {
              const nativeCurrency = bucket.currency;
              const otherCurrency: Currency =
                nativeCurrency === "ILS" ? "USD" : "ILS";
              const convertedPnl = convert(
                bucket.unrealizedPnl,
                nativeCurrency,
                otherCurrency
              );
              const pnlPct =
                bucket.totalCost > 0
                  ? (bucket.unrealizedPnl / bucket.totalCost) * 100
                  : 0;
              const positive = bucket.unrealizedPnl >= 0;
              return (
                <div
                  key={bucket.region}
                  className="rounded-lg border border-gray-100 bg-gray-50 p-4"
                >
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm font-medium text-gray-600">
                      {bucket.region === "TASE"
                        ? "TASE (Israeli)"
                        : "US (NYSE/NASDAQ)"}
                    </p>
                    <span className="text-xs text-gray-400">
                      {bucket.positionCount} position
                      {bucket.positionCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p
                    className={`mt-1 text-2xl font-bold ${
                      positive ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatCurrency(bucket.unrealizedPnl, nativeCurrency)}
                  </p>
                  <p
                    className={`text-sm ${
                      positive ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {convertedPnl !== null
                      ? formatCurrency(convertedPnl, otherCurrency)
                      : `— ${otherCurrency} (no FX rate)`}
                  </p>
                  <div className="mt-2 flex gap-4 text-xs text-gray-500">
                    <span>
                      Market value:{" "}
                      {formatCurrency(bucket.marketValue, nativeCurrency)}
                    </span>
                    <span>
                      {positive ? "+" : ""}
                      {pnlPct.toFixed(2)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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

function KpiMultiCurrencyCard({
  label,
  loading,
  currencies,
  values,
  signedColor = false,
}: {
  label: string;
  loading: boolean;
  currencies: Currency[];
  values: Record<Currency, number>;
  signedColor?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-sm text-gray-500">{label}</p>
      {loading ? (
        <span className="mt-1 inline-block h-7 w-24 animate-pulse rounded bg-gray-100" />
      ) : currencies.length === 0 ? (
        <p className="mt-1 text-2xl font-semibold text-gray-900">—</p>
      ) : (
        <div className="mt-1 space-y-0.5">
          {currencies.map((c) => {
            const v = values[c];
            const color = signedColor
              ? v >= 0
                ? "text-green-600"
                : "text-red-600"
              : "text-gray-900";
            return (
              <p key={c} className={`text-xl font-semibold ${color}`}>
                {formatCurrency(v, c)}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
