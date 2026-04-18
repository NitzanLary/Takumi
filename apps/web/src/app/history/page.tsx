"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { formatCurrency, formatDate, formatNumber, isHebrew } from "@/lib/formatters";
import type { Trade, PaginatedResponse } from "@takumi/types";

export default function HistoryPage() {
  const [page, setPage] = useState(1);
  const [ticker, setTicker] = useState("");
  const [market, setMarket] = useState("");
  const [direction, setDirection] = useState("");
  const [showAll, setShowAll] = useState(false);

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", "30");
  if (ticker) params.set("ticker", ticker);
  if (market) params.set("market", market);
  if (direction) params.set("direction", direction);
  if (showAll) params.set("includeNonTrades", "true");

  const { data, isLoading } = useQuery({
    queryKey: ["trades", page, ticker, market, direction, showAll],
    queryFn: () =>
      apiFetch<PaginatedResponse<Trade>>(`/api/trades?${params.toString()}`),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-900">Trade History</h2>

      {/* Filters */}
      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Filter by ticker..."
          value={ticker}
          onChange={(e) => {
            setTicker(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
        <select
          value={market}
          onChange={(e) => {
            setMarket(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">All Markets</option>
          <option value="TASE">TASE</option>
          <option value="NYSE">NYSE</option>
          <option value="NASDAQ">NASDAQ</option>
        </select>
        <select
          value={direction}
          onChange={(e) => {
            setDirection(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">All Directions</option>
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => {
              setShowAll(e.target.checked);
              setPage(1);
            }}
            className="rounded border-gray-300"
          />
          Show all transactions
        </label>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {[
                "Date",
                "Ticker",
                "Direction",
                "Quantity",
                "Price",
                "Commission",
                "Market",
                "Source",
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
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  Loading trades...
                </td>
              </tr>
            ) : !data?.data.length ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  No trades found. Import your transactions from the Import page.
                </td>
              </tr>
            ) : (
              data.data.map((trade) => (
                <tr key={trade.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {formatDate(trade.tradeDate)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium">
                    <span dir={isHebrew(trade.ticker) ? "rtl" : "ltr"}>
                      {trade.ticker}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        trade.direction === "BUY"
                          ? "bg-green-100 text-green-700"
                          : trade.direction === "SELL"
                            ? "bg-red-100 text-red-700"
                            : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {trade.direction}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {formatNumber(trade.quantity)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {formatCurrency(trade.price, trade.currency as "ILS" | "USD")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {formatCurrency(trade.commission, trade.currency as "ILS" | "USD")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {trade.market}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-400">
                    {trade.source === "xlsx_import" ? "XLSX" : trade.source}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Showing {(data.page - 1) * data.limit + 1}–
            {Math.min(data.page * data.limit, data.total)} of {data.total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={page >= data.totalPages}
              className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
