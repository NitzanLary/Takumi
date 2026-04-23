"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { StockSummary } from "@takumi/types";
import { apiFetch } from "@/lib/api-client";
import { StockHeader } from "@/components/stock/StockHeader";
import { OverviewTab } from "@/components/stock/OverviewTab";
import { TradesTab } from "@/components/stock/TradesTab";
import { RoundTripsTab } from "@/components/stock/RoundTripsTab";
import { DividendsFeesTab } from "@/components/stock/DividendsFeesTab";
import { StockChart } from "@/components/stock/StockChart";

type Tab = "overview" | "trades" | "round-trips" | "dividends-fees";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "trades", label: "Trades" },
  { id: "round-trips", label: "Round-trips" },
  { id: "dividends-fees", label: "Dividends & Fees" },
];

export default function StockDetailPage() {
  const params = useParams<{ ticker: string }>();
  const ticker = decodeURIComponent(params.ticker);
  const [tab, setTab] = useState<Tab>("overview");

  const { data: summary, isLoading, error } = useQuery<StockSummary>({
    queryKey: ["stock-summary", ticker],
    queryFn: () =>
      apiFetch<StockSummary>(
        `/api/stock/${encodeURIComponent(ticker)}/summary`
      ),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400">
        Loading stock details…
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        <p className="font-medium">Could not load details for {ticker}.</p>
        <p className="mt-1 text-red-600">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StockHeader summary={summary} />

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex flex-wrap gap-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap border-b-2 px-1 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div>
        {tab === "overview" && <OverviewTab summary={summary} />}
        {tab === "trades" && <TradesTab ticker={ticker} priorNames={summary.priorNames} />}
        {tab === "round-trips" && <RoundTripsTab ticker={ticker} />}
        {tab === "dividends-fees" && <DividendsFeesTab ticker={ticker} />}
      </div>

      <StockChart summary={summary} />
    </div>
  );
}
