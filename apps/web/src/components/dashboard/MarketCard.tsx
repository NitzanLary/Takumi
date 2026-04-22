"use client";

import { MoneyLine } from "./MoneyLine";

type Currency = "ILS" | "USD";
export type MarketRegion = "TASE" | "US";

interface MarketTotals {
  marketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
}

const REGION_META: Record<
  MarketRegion,
  { title: string; subtitle: string; currency: Currency }
> = {
  TASE: { title: "TASE", subtitle: "Tel Aviv Stock Exchange", currency: "ILS" },
  US: { title: "US", subtitle: "NYSE / NASDAQ", currency: "USD" },
};

export function MarketCard({
  region,
  positionCount,
  totals,
  fxRate,
  loading,
}: {
  region: MarketRegion;
  positionCount: number;
  totals: MarketTotals | null;
  /** ILS per 1 USD. `null` => no FX rate available. */
  fxRate: number | null;
  loading: boolean;
}) {
  const { title, subtitle, currency } = REGION_META[region];
  const other: Currency = currency === "ILS" ? "USD" : "ILS";

  const convert = (v: number): number | null => {
    if (!fxRate || fxRate <= 0) return null;
    if (currency === "ILS" && other === "USD") return v / fxRate;
    if (currency === "USD" && other === "ILS") return v * fxRate;
    return null;
  };

  const t = totals ?? {
    marketValue: 0,
    unrealizedPnl: 0,
    realizedPnl: 0,
    totalPnl: 0,
  };

  const costBasis = t.marketValue - t.unrealizedPnl;
  const unrealizedPct =
    costBasis > 0 ? (t.unrealizedPnl / costBasis) * 100 : null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-1 flex items-baseline justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
        <span className="text-xs text-gray-400">
          {positionCount} position{positionCount === 1 ? "" : "s"}
        </span>
      </div>
      <p className="mb-4 text-xs text-gray-400">Native currency: {currency}</p>

      <div className="divide-y divide-gray-100">
        <MoneyLine
          label="Market Value"
          primaryAmount={t.marketValue}
          primaryCurrency={currency}
          secondaryAmount={convert(t.marketValue)}
          secondaryCurrency={other}
          loading={loading}
        />
        <MoneyLine
          label="Unrealized P&L"
          primaryAmount={t.unrealizedPnl}
          primaryCurrency={currency}
          secondaryAmount={convert(t.unrealizedPnl)}
          secondaryCurrency={other}
          signed
          percentage={unrealizedPct}
          loading={loading}
        />
        <MoneyLine
          label="Realized P&L"
          primaryAmount={t.realizedPnl}
          primaryCurrency={currency}
          secondaryAmount={convert(t.realizedPnl)}
          secondaryCurrency={other}
          signed
          loading={loading}
        />
      </div>

      <div className="mt-3 border-t-2 border-gray-900/10 pt-2">
        <MoneyLine
          label="Total P&L"
          primaryAmount={t.totalPnl}
          primaryCurrency={currency}
          secondaryAmount={convert(t.totalPnl)}
          secondaryCurrency={other}
          signed
          emphasis="total"
          loading={loading}
        />
      </div>
    </section>
  );
}
