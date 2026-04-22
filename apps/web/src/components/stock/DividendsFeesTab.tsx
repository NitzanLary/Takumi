"use client";

import { useQuery } from "@tanstack/react-query";
import type { PaginatedResponse, Trade } from "@takumi/types";
import { apiFetch } from "@/lib/api-client";
import { formatCurrency, formatDate, formatNumber } from "@/lib/formatters";

export function DividendsFeesTab({ ticker }: { ticker: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["stock-all-trades", ticker],
    queryFn: () =>
      apiFetch<PaginatedResponse<Trade>>(
        `/api/trades?ticker=${encodeURIComponent(ticker)}&limit=500&includeNonTrades=true`
      ),
  });

  const all = data?.data ?? [];
  const dividends = all.filter((t) => t.direction === "DIVIDEND");
  const taxes = all.filter((t) => t.direction === "TAX");
  const trades = all.filter(
    (t) => t.direction === "BUY" || t.direction === "SELL"
  );

  // Pair tax rows with dividend rows by date (same ticker + tradeDate — the
  // XLSX importer writes them as sibling rows).
  const taxByDate = new Map<string, number>();
  for (const tax of taxes) {
    const key = tax.tradeDate.slice(0, 10);
    const amount = Math.abs(tax.quantity * tax.price);
    taxByDate.set(key, (taxByDate.get(key) ?? 0) + amount);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Dividends</h3>
          <p className="text-xs text-gray-500">
            Cash dividends received, with any withheld tax listed alongside.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {["Date", "Gross", "Tax withheld", "Net"].map((h) => (
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
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">
                    Loading…
                  </td>
                </tr>
              ) : dividends.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">
                    No dividends recorded.
                  </td>
                </tr>
              ) : (
                dividends.map((d) => {
                  const gross = d.quantity * d.price;
                  const tax = taxByDate.get(d.tradeDate.slice(0, 10)) ?? 0;
                  const net = gross - tax;
                  return (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-2 text-sm">
                        {formatDate(d.tradeDate)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-sm">
                        {formatCurrency(gross, d.currency)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-500">
                        {tax > 0 ? formatCurrency(tax, d.currency) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-sm font-medium text-gray-900">
                        {formatCurrency(net, d.currency)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-gray-900">
            Commissions paid
          </h3>
          <p className="text-xs text-gray-500">
            Broker fees attached to each BUY and SELL.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {["Date", "Action", "Qty", "Commission"].map((h) => (
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
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">
                    Loading…
                  </td>
                </tr>
              ) : trades.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">
                    No trades recorded.
                  </td>
                </tr>
              ) : (
                trades.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-2 text-sm">
                      {formatDate(t.tradeDate)}
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
                      {formatCurrency(t.commission, t.currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
