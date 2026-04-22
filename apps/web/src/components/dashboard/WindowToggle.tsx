"use client";

import type { PnlWindow } from "@takumi/types";

const OPTIONS: { value: PnlWindow; label: string }[] = [
  { value: "all", label: "All-time" },
  { value: "ytd", label: "YTD" },
  { value: "12m", label: "12M" },
];

export function WindowToggle({
  value,
  onChange,
}: {
  value: PnlWindow;
  onChange: (next: PnlWindow) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Realized P&L time window"
      className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm"
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={
              active
                ? "rounded-md bg-white px-3 py-1.5 font-medium text-gray-900 shadow-sm"
                : "rounded-md px-3 py-1.5 text-gray-500 hover:text-gray-700"
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
