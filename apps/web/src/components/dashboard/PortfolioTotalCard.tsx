"use client";

import { MoneyLine } from "./MoneyLine";

interface PortfolioTotals {
  marketValueIls: number;
  unrealizedPnlIls: number;
  realizedPnlIls: number;
  totalPnlIls: number;
}

export function PortfolioTotalCard({
  totals,
  fxRate,
  loading,
}: {
  totals: PortfolioTotals | null;
  /** ILS per 1 USD. `null` => no FX rate available. */
  fxRate: number | null;
  loading: boolean;
}) {
  const toUsd = (ils: number): number | null =>
    fxRate && fxRate > 0 ? ils / fxRate : null;

  const t = totals ?? {
    marketValueIls: 0,
    unrealizedPnlIls: 0,
    realizedPnlIls: 0,
    totalPnlIls: 0,
  };

  const costBasisIls = t.marketValueIls - t.unrealizedPnlIls;
  const unrealizedPct =
    costBasisIls > 0 ? (t.unrealizedPnlIls / costBasisIls) * 100 : null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="text-base font-semibold uppercase tracking-wide text-gray-500">
          Portfolio Total
        </h3>
        <span className="text-xs text-gray-400">ILS home currency</span>
      </div>
      <p className="mb-4 text-xs text-gray-400">
        Market Value is current price × quantity and already reflects Unrealized P&L. Total P&L = Unrealized + Realized.
      </p>

      <div className="divide-y divide-gray-100">
        <MoneyLine
          label="Market Value"
          primaryAmount={t.marketValueIls}
          primaryCurrency="ILS"
          secondaryAmount={toUsd(t.marketValueIls)}
          secondaryCurrency="USD"
          loading={loading}
        />
        <MoneyLine
          label="Unrealized P&L"
          primaryAmount={t.unrealizedPnlIls}
          primaryCurrency="ILS"
          secondaryAmount={toUsd(t.unrealizedPnlIls)}
          secondaryCurrency="USD"
          signed
          percentage={unrealizedPct}
          loading={loading}
        />
        <MoneyLine
          label="Realized P&L"
          primaryAmount={t.realizedPnlIls}
          primaryCurrency="ILS"
          secondaryAmount={toUsd(t.realizedPnlIls)}
          secondaryCurrency="USD"
          signed
          loading={loading}
        />
      </div>

      <div className="mt-3 border-t-2 border-gray-900/10 pt-2">
        <MoneyLine
          label="Total P&L"
          primaryAmount={t.totalPnlIls}
          primaryCurrency="ILS"
          secondaryAmount={toUsd(t.totalPnlIls)}
          secondaryCurrency="USD"
          signed
          emphasis="total"
          loading={loading}
        />
      </div>
    </section>
  );
}
