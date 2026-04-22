"use client";

import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { formatCurrency, formatPercent, formatNumber, isHebrew } from "@/lib/formatters";

interface OpenPosition {
  ticker: string;
  securityName: string;
  market: string;
  currency: "ILS" | "USD";
  quantity: number;
  avgCostBasis: number;
  totalCost: number;
  currentPrice: number;
  marketValue: number;
  marketValueIls: number;
  totalCostIls: number;
  unrealizedPnlIls: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  weight: number;
  priceSource: "live" | "cached" | "placeholder";
  dayChange: number | null;
  dayChangePct: number | null;
}

export default function PositionsPage() {
  const queryClient = useQueryClient();
  const { data: positions, isLoading } = useQuery({
    queryKey: ["positions"],
    queryFn: () => apiFetch<OpenPosition[]>("/api/positions"),
    refetchInterval: 60_000, // auto-refresh every 60s
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiFetch("/api/market/refresh", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["positions"] }),
  });

  // Totals are shown in ILS (home currency). Summing native marketValue across
  // TASE (ILS) and US (USD) positions would produce a meaningless mixed-currency
  // number (1 USD ≈ 3.7 ILS). The API pre-computes the ILS-normalized fields.
  const totalValueIls = positions?.reduce((s, p) => s + p.marketValueIls, 0) ?? 0;
  const totalCostIls = positions?.reduce((s, p) => s + p.totalCostIls, 0) ?? 0;
  const totalUnrealizedPnlIls = totalValueIls - totalCostIls;
  const hasPlaceholders = positions?.some((p) => p.priceSource === "placeholder");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Open Positions</h2>
          <p className="text-sm text-gray-500">
            Derived from FIFO lot matching with live market prices.
          </p>
        </div>
        <button
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {refreshMutation.isPending ? "Refreshing..." : "Refresh Prices"}
        </button>
      </div>

      {hasPlaceholders && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          Some TASE positions show placeholder prices. Map their Yahoo Finance symbols via Settings to get live data.
        </div>
      )}

      {/* Summary strip */}
      {positions && positions.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-500">Positions</p>
            <p className="mt-1 text-xl font-semibold text-gray-900">
              {positions.length}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-500">Total Cost Basis (₪)</p>
            <p className="mt-1 text-xl font-semibold text-gray-900">
              {formatCurrency(Math.round(totalCostIls), "ILS")}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-500">Total Market Value (₪)</p>
            <p className="mt-1 text-xl font-semibold text-gray-900">
              {formatCurrency(Math.round(totalValueIls), "ILS")}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-500">Unrealized P&L (₪)</p>
            <p className={`mt-1 text-xl font-semibold ${totalUnrealizedPnlIls >= 0 ? "text-green-600" : "text-red-600"}`}>
              {formatCurrency(Math.round(totalUnrealizedPnlIls), "ILS")}
            </p>
          </div>
        </div>
      )}

      {/* Positions table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {[
                "Ticker",
                "Name",
                "Market",
                "Qty",
                "Avg Cost",
                "Current Price",
                "Market Value",
                "Unrealized P&L",
                "Weight",
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
            {isLoading ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-gray-400"
                >
                  Loading positions...
                </td>
              </tr>
            ) : !positions?.length ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-gray-400"
                >
                  No open positions. All trades have been fully closed.
                </td>
              </tr>
            ) : (
              positions.map((pos) => (
                <tr key={pos.ticker} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium">
                    <Link
                      href={`/positions/${encodeURIComponent(pos.ticker)}`}
                      className="text-blue-600 hover:underline"
                    >
                      {pos.ticker}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                    <span dir={isHebrew(pos.securityName) ? "rtl" : "ltr"}>
                      {pos.securityName}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {pos.market}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {formatNumber(pos.quantity)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {formatCurrency(pos.avgCostBasis, pos.currency)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    <span className={pos.priceSource === "placeholder" ? "text-gray-400" : "text-gray-900"}>
                      {formatCurrency(pos.currentPrice, pos.currency)}
                    </span>
                    {pos.priceSource === "placeholder" && (
                      <span className="ml-1 text-xs text-gray-400">(placeholder)</span>
                    )}
                    {pos.dayChangePct != null && pos.priceSource !== "placeholder" && (
                      <span className={`ml-1 text-xs ${pos.dayChangePct >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {pos.dayChangePct >= 0 ? "+" : ""}{pos.dayChangePct.toFixed(2)}%
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {formatCurrency(pos.marketValue, pos.currency)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-3 text-sm font-medium ${
                      pos.unrealizedPnl >= 0
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {formatCurrency(pos.unrealizedPnl, pos.currency)}
                    <span className="ml-1 text-xs">
                      ({formatPercent(pos.unrealizedPnlPct)})
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {pos.weight.toFixed(1)}%
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
