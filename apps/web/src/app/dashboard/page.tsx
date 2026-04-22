"use client";

import { useMemo, useCallback, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { formatNumber } from "@/lib/formatters";
import type { PnlWindow, SyncState } from "@takumi/types";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { WindowToggle } from "@/components/dashboard/WindowToggle";
import { PortfolioTotalCard } from "@/components/dashboard/PortfolioTotalCard";
import {
  MarketCard,
  type MarketRegion,
} from "@/components/dashboard/MarketCard";

type Currency = "ILS" | "USD";

interface OpenPosition {
  ticker: string;
  market: string;
  currency: Currency;
  marketValue: number;
  marketValueIls: number;
  unrealizedPnl: number;
  unrealizedPnlIls: number;
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

interface MarketPnlRow {
  market: string;
  realizedPnl: number;
  realizedPnlIls: number;
  tradeCount: number;
  winRate: number;
}

const WINDOWS: readonly PnlWindow[] = ["all", "ytd", "12m"];
const REGIONS: readonly MarketRegion[] = ["TASE", "US"];

function regionFor(market: string): MarketRegion {
  return market === "TASE" ? "TASE" : "US";
}

function parseWindow(raw: string | null): PnlWindow {
  return raw && (WINDOWS as readonly string[]).includes(raw)
    ? (raw as PnlWindow)
    : "all";
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="p-2 text-sm text-gray-400">Loading…</div>}>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const pnlWindow: PnlWindow = parseWindow(searchParams.get("window"));

  const setWindow = useCallback(
    (next: PnlWindow) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "all") params.delete("window");
      else params.set("window", next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname]
  );

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

  const { data: pnlByMarket, isLoading: pnlLoading } = useQuery({
    queryKey: ["pnl-by-market", pnlWindow],
    queryFn: () =>
      apiFetch<MarketPnlRow[]>(
        `/api/analytics/pnl?groupBy=market&window=${pnlWindow}`
      ),
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

  const rate = fx?.rate ?? null;
  const loading = positionsLoading || pnlLoading;

  const { perMarket, aggregate, hasPlaceholders } = useMemo(
    () => aggregateDashboard(positions ?? [], pnlByMarket ?? []),
    [positions, pnlByMarket]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
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
          {rate !== null && fx?.date && (
            <p className="mt-0.5 text-xs text-gray-400">
              USD/ILS {rate.toFixed(3)} · {new Date(fx.date).toLocaleDateString()}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <WindowToggle value={pnlWindow} onChange={setWindow} />
          <p className="text-xs text-gray-400">
            Window applies to Realized &amp; Total P&amp;L only.
          </p>
        </div>
      </div>

      {hasPlaceholders && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          Some TASE positions show placeholder prices. Unrealized P&amp;L for those holdings reflects cost basis until live prices become available.
        </div>
      )}

      {/* Aggregate */}
      <PortfolioTotalCard
        totals={aggregate}
        fxRate={rate}
        loading={loading}
      />

      {/* Per-market */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {REGIONS.map((region) => (
          <MarketCard
            key={region}
            region={region}
            positionCount={perMarket[region].positionCount}
            totals={perMarket[region]}
            fxRate={rate}
            loading={loading}
          />
        ))}
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
                : 'No snapshots yet. Click "Capture Snapshot" to start tracking your portfolio value over time.'}
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
                <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#9ca3af" />
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
                  labelFormatter={(
                    _label: string,
                    payload: Array<{ payload?: { fullDate?: string } }>
                  ) => payload?.[0]?.payload?.fullDate ?? _label}
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

interface MarketAgg {
  marketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
  positionCount: number;
}

interface AggregateIls {
  marketValueIls: number;
  unrealizedPnlIls: number;
  realizedPnlIls: number;
  totalPnlIls: number;
}

function aggregateDashboard(
  positions: OpenPosition[],
  pnlByMarket: MarketPnlRow[]
): {
  perMarket: Record<MarketRegion, MarketAgg>;
  aggregate: AggregateIls;
  hasPlaceholders: boolean;
} {
  const perMarket: Record<MarketRegion, MarketAgg> = {
    TASE: { marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, totalPnl: 0, positionCount: 0 },
    US: { marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, totalPnl: 0, positionCount: 0 },
  };

  let marketValueIls = 0;
  let unrealizedPnlIls = 0;
  let hasPlaceholders = false;

  for (const p of positions) {
    const region = regionFor(p.market);
    perMarket[region].marketValue += p.marketValue;
    perMarket[region].unrealizedPnl += p.unrealizedPnl;
    perMarket[region].positionCount += 1;
    marketValueIls += p.marketValueIls;
    unrealizedPnlIls += p.unrealizedPnlIls;
    if (p.priceSource === "placeholder") hasPlaceholders = true;
  }

  let realizedPnlIls = 0;
  for (const row of pnlByMarket) {
    const region: MarketRegion = row.market === "TASE" ? "TASE" : "US";
    perMarket[region].realizedPnl += row.realizedPnl;
    realizedPnlIls += row.realizedPnlIls;
  }

  for (const region of REGIONS) {
    perMarket[region].totalPnl =
      perMarket[region].unrealizedPnl + perMarket[region].realizedPnl;
  }

  const aggregate: AggregateIls = {
    marketValueIls,
    unrealizedPnlIls,
    realizedPnlIls,
    totalPnlIls: unrealizedPnlIls + realizedPnlIls,
  };

  return { perMarket, aggregate, hasPlaceholders };
}
