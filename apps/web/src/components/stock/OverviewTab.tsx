"use client";

import { useQuery } from "@tanstack/react-query";
import type { StockOpenLot, StockSummary } from "@takumi/types";
import { apiFetch } from "@/lib/api-client";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
} from "@/lib/formatters";

export function OverviewTab({ summary }: { summary: StockSummary }) {
  const { data: openLots } = useQuery({
    queryKey: ["stock-open-lots", summary.ticker],
    queryFn: () =>
      apiFetch<StockOpenLot[]>(
        `/api/stock/${encodeURIComponent(summary.ticker)}/open-lots`
      ),
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Realized P&L">
          {summary.realizedPnl.length === 0 ? (
            <p className="text-lg font-semibold text-gray-400">—</p>
          ) : (
            summary.realizedPnl.map((r) => (
              <p
                key={r.currency}
                className={`text-lg font-semibold ${
                  r.realizedPnl >= 0 ? "text-green-600" : "text-red-600"
                }`}
              >
                {formatCurrency(r.realizedPnl, r.currency)}
                <span className="ml-1 text-xs font-normal text-gray-500">
                  ({r.tradeCount} closed · {r.winCount}W/{r.lossCount}L)
                </span>
              </p>
            ))
          )}
        </KpiCard>

        <KpiCard title="Total fees paid">
          {summary.totalFeesPaid.length === 0 ? (
            <p className="text-lg font-semibold text-gray-400">—</p>
          ) : (
            summary.totalFeesPaid.map((f) => (
              <p key={f.currency} className="text-lg font-semibold text-gray-900">
                {formatCurrency(f.amount, f.currency)}
                <span className="ml-1 text-xs font-normal text-gray-500">
                  ({f.buyCount} buys · {f.sellCount} sells)
                </span>
              </p>
            ))
          )}
        </KpiCard>

        <KpiCard title="Dividends (net)">
          {summary.totalDividends.length === 0 ? (
            <p className="text-lg font-semibold text-gray-400">—</p>
          ) : (
            summary.totalDividends.map((d) => (
              <div key={d.currency}>
                <p className="text-lg font-semibold text-gray-900">
                  {formatCurrency(d.net, d.currency)}
                </p>
                <p className="text-xs text-gray-500">
                  Gross {formatCurrency(d.gross, d.currency)} · Tax withheld{" "}
                  {formatCurrency(d.taxWithheld, d.currency)} · {d.paymentCount}{" "}
                  payments
                </p>
              </div>
            ))
          )}
        </KpiCard>

        {summary.currencyImpact ? (
          <KpiCard title="Currency impact (unrealized)">
            <p
              className={`text-sm ${
                summary.currencyImpact.priceMoveIls >= 0
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              Price move{" "}
              <span className="font-semibold">
                {formatCurrency(summary.currencyImpact.priceMoveIls, "ILS")}
              </span>
            </p>
            <p
              className={`text-sm ${
                summary.currencyImpact.fxMoveIls >= 0
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              FX move{" "}
              <span className="font-semibold">
                {formatCurrency(summary.currencyImpact.fxMoveIls, "ILS")}
              </span>
            </p>
            <p className="mt-1 text-xs text-gray-500">
              USD/ILS now {summary.currencyImpact.rateNow.toFixed(3)} · total{" "}
              {formatCurrency(
                summary.currencyImpact.totalUnrealizedPnlIls,
                "ILS"
              )}
            </p>
          </KpiCard>
        ) : (
          <KpiCard title="Position summary">
            <p className="text-sm text-gray-600">
              {summary.isClosed
                ? "Fully sold."
                : summary.currency === "ILS"
                ? "ILS-denominated position. Currency impact only applies to USD holdings."
                : "Waiting on open lots to compute FX attribution."}
            </p>
          </KpiCard>
        )}
      </div>

      <OpenLotsTable lots={openLots ?? []} loading={openLots === undefined} />
    </div>
  );
}

function KpiCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wider text-gray-500">{title}</p>
      <div className="mt-1 space-y-0.5">{children}</div>
    </div>
  );
}

function OpenLotsTable({
  lots,
  loading,
}: {
  lots: StockOpenLot[];
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-5 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Open FIFO lots</h3>
        <p className="text-xs text-gray-500">
          Specific buy lots that haven&apos;t been sold yet. Selling will
          draw from these oldest-first.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {[
                "Buy date",
                "Qty",
                "Buy price",
                "Current price",
                "Market value",
                "Unrealized P&L",
              ].map((h) => (
                <th
                  key={h}
                  className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400">
                  Loading lots…
                </td>
              </tr>
            ) : lots.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400">
                  No open lots. Position is fully closed.
                </td>
              </tr>
            ) : (
              lots.map((lot, i) => (
                <tr key={`${lot.buyDate}-${i}`} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-700">
                    {formatDate(lot.buyDate)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-sm">
                    {formatNumber(lot.quantity)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-sm">
                    {formatCurrency(lot.buyPrice, lot.currency)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-sm">
                    {formatCurrency(lot.currentPrice, lot.currency)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-sm">
                    {formatCurrency(lot.marketValue, lot.currency)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-2 text-sm font-medium ${
                      lot.unrealizedPnl >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatCurrency(lot.unrealizedPnl, lot.currency)}
                    <span className="ml-1 text-xs font-normal">
                      ({formatPercent(lot.unrealizedPnlPct)})
                    </span>
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
