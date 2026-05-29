"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { SyncState } from "@takumi/types";
import { PortfolioTotalCard } from "@/components/dashboard/PortfolioTotalCard";
import {
  MarketCard,
  type MarketRegion,
} from "@/components/dashboard/MarketCard";
import { EquityCurveCard } from "@/components/dashboard/EquityCurveCard";

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

const REGIONS: readonly MarketRegion[] = ["TASE", "US"];

function regionFor(market: string): MarketRegion {
  return market === "TASE" ? "TASE" : "US";
}

export default function DashboardPage() {
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
    queryKey: ["pnl-by-market"],
    queryFn: () =>
      apiFetch<MarketPnlRow[]>("/api/analytics/pnl?groupBy=market"),
  });

  const { data: fx } = useQuery({
    queryKey: ["exchange-rate"],
    queryFn: () => apiFetch<ExchangeRate>("/api/exchange-rates"),
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

      <EquityCurveCard />
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
