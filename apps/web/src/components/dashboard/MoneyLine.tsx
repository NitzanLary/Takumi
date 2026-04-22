"use client";

import { formatCurrency } from "@/lib/formatters";

type Currency = "ILS" | "USD";

interface MoneyLineProps {
  label: string;
  primaryAmount: number;
  primaryCurrency: Currency;
  /** Converted equivalent. `null` = conversion unavailable (no FX rate). `undefined` = don't show. */
  secondaryAmount?: number | null;
  secondaryCurrency?: Currency;
  /** Apply green/red signed coloring to amounts. */
  signed?: boolean;
  /** Visual weight. 'regular' for data rows, 'total' for the bottom total row. */
  emphasis?: "regular" | "total";
  /** Optional percentage annotation (e.g., unrealized return %). `null` = n/a. `undefined` = don't show. */
  percentage?: number | null;
  loading?: boolean;
}

export function MoneyLine({
  label,
  primaryAmount,
  primaryCurrency,
  secondaryAmount,
  secondaryCurrency,
  signed = false,
  emphasis = "regular",
  percentage,
  loading = false,
}: MoneyLineProps) {
  const color = signed
    ? primaryAmount > 0
      ? "text-green-600"
      : primaryAmount < 0
      ? "text-red-600"
      : "text-gray-900"
    : "text-gray-900";

  const primaryText = signed && primaryAmount > 0
    ? `+${formatCurrency(primaryAmount, primaryCurrency)}`
    : formatCurrency(primaryAmount, primaryCurrency);

  const percentEl = (() => {
    if (percentage === undefined) return null;
    if (percentage === null || !Number.isFinite(percentage)) {
      return <span className="ml-2 text-sm font-normal text-gray-400">—</span>;
    }
    const sign = percentage > 0 ? "+" : "";
    return (
      <span className={`ml-2 text-sm font-normal ${color}`}>
        {sign}
        {percentage.toFixed(2)}%
      </span>
    );
  })();

  const primarySize =
    emphasis === "total" ? "text-xl font-bold" : "text-lg font-semibold";
  const secondarySize = "text-xs";

  const secondaryEl = (() => {
    if (secondaryAmount === undefined || secondaryCurrency === undefined) {
      return null;
    }
    if (secondaryAmount === null) {
      return (
        <p className={`${secondarySize} text-gray-400`}>
          — {secondaryCurrency} (no FX rate)
        </p>
      );
    }
    const text =
      signed && secondaryAmount > 0
        ? `+${formatCurrency(secondaryAmount, secondaryCurrency)}`
        : formatCurrency(secondaryAmount, secondaryCurrency);
    const secondaryColor = signed
      ? secondaryAmount > 0
        ? "text-green-600/70"
        : secondaryAmount < 0
        ? "text-red-600/70"
        : "text-gray-400"
      : "text-gray-400";
    return <p className={`${secondarySize} ${secondaryColor}`}>≈ {text}</p>;
  })();

  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <p className="text-sm text-gray-600 pt-0.5">{label}</p>
      <div className="text-right">
        {loading ? (
          <span className="inline-block h-5 w-24 animate-pulse rounded bg-gray-100" />
        ) : (
          <>
            <p className={`${primarySize} ${color} leading-tight`}>
              {primaryText}
              {percentEl}
            </p>
            {secondaryEl}
          </>
        )}
      </div>
    </div>
  );
}
