"use client";

const QUICK_ACTIONS = [
  "Summarize my portfolio",
  "What's my worst habit?",
  "Show open positions",
  "How much did I make this year?",
  "Any dividend income?",
];

interface QuickActionsProps {
  onSelect: (text: string) => void;
  disabled?: boolean;
}

export function QuickActions({ onSelect, disabled }: QuickActionsProps) {
  return (
    <div className="flex flex-wrap gap-2 px-4 py-3">
      {QUICK_ACTIONS.map((action) => (
        <button
          key={action}
          onClick={() => onSelect(action)}
          disabled={disabled}
          className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
        >
          {action}
        </button>
      ))}
    </div>
  );
}
