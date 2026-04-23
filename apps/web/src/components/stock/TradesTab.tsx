"use client";

import { useQuery } from "@tanstack/react-query";
import type { PaginatedResponse, Trade } from "@takumi/types";
import { apiFetch } from "@/lib/api-client";
import { formatCurrency, formatDate, formatNumber, isHebrew } from "@/lib/formatters";

export function TradesTab({
  ticker,
  priorNames,
}: {
  ticker: string;
  priorNames: string[];
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["stock-trades", ticker],
    queryFn: () =>
      apiFetch<PaginatedResponse<Trade>>(
        `/api/trades?ticker=${encodeURIComponent(ticker)}&limit=500`
      ),
  });

  const trades = data?.data ?? [];
  const priorNamesSet = new Set(priorNames);

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-5 py-3">
        <h3 className="text-sm font-semibold text-gray-900">All buys & sells</h3>
        <p className="text-xs text-gray-500">
          Chronological list of every BUY and SELL on this ticker.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {["Date", "Direction", "Qty", "Price", "Commission", "Proceeds"].map(
                (h) => (
                  <th
                    key={h}
                    className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400">
                  Loading trades…
                </td>
              </tr>
            ) : trades.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400">
                  No trades recorded for this ticker.
                </td>
              </tr>
            ) : (
              trades.map((t) => {
                const proceeds = t.quantity * t.price;
                // Surface the historical name on rows that pre-date a rename —
                // e.g. the 2020 BUY on the META detail page still shows
                // "FIVG US" here, which is the evidence behind the "Formerly
                // known as" banner above. Only applies to names we classify
                // as real renames (in priorNames), not IBI-vs-Yahoo format
                // mismatches.
                const isLegacyName = priorNamesSet.has(t.securityName);
                return (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-2 text-sm">
                      <div>{formatDate(t.tradeDate)}</div>
                      {isLegacyName && (
                        <div
                          className="text-xs text-gray-400"
                          dir={isHebrew(t.securityName) ? "rtl" : "ltr"}
                          title="Security name at the time of this trade (ticker was later renamed)"
                        >
                          as {t.securityName}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          t.direction === "BUY"
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {t.direction}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm">
                      {formatNumber(t.quantity)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm">
                      {formatCurrency(t.price, t.currency)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-500">
                      {formatCurrency(t.commission, t.currency)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm">
                      {formatCurrency(proceeds, t.currency)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
