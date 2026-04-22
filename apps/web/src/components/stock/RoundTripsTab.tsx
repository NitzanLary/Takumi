"use client";

import { useQuery } from "@tanstack/react-query";
import type { StockRoundTrip } from "@takumi/types";
import { apiFetch } from "@/lib/api-client";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "@/lib/formatters";

export function RoundTripsTab({ ticker }: { ticker: string }) {
  const { data: trips, isLoading } = useQuery({
    queryKey: ["stock-round-trips", ticker],
    queryFn: () =>
      apiFetch<StockRoundTrip[]>(
        `/api/stock/${encodeURIComponent(ticker)}/round-trips`
      ),
  });

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-5 py-3">
        <h3 className="text-sm font-semibold text-gray-900">
          Completed round-trips
        </h3>
        <p className="text-xs text-gray-500">
          Each row is a FIFO-matched buy→sell cycle: entry → exit with
          realized P&amp;L.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {[
                "Entry date",
                "Exit date",
                "Qty",
                "Entry price",
                "Exit price",
                "Holding",
                "Return",
                "Realized P&L",
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
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-400">
                  Loading round-trips…
                </td>
              </tr>
            ) : !trips?.length ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-400">
                  No closed round-trips yet.
                </td>
              </tr>
            ) : (
              trips.map((t, i) => (
                <tr key={`${t.buyDate}-${t.sellDate}-${i}`} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-2 text-sm">
                    {formatDate(t.buyDate)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-sm">
                    {formatDate(t.sellDate)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-sm">
                    {formatNumber(t.quantity)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-sm">
                    {formatCurrency(t.buyPrice, t.currency)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-sm">
                    {formatCurrency(t.sellPrice, t.currency)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-500">
                    {t.holdingDays}d
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-2 text-sm ${
                      t.returnPct >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatPercent(t.returnPct)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-2 text-sm font-medium ${
                      t.realizedPnl >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatCurrency(t.realizedPnl, t.currency)}
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
