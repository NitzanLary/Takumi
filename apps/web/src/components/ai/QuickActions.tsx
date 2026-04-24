"use client";

interface QuickAction {
  label: string;
  prompt: string;
  icon: React.ReactNode;
  accent: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: "Portfolio snapshot",
    prompt: "Give me a crisp snapshot of my portfolio right now.",
    accent: "from-blue-500/15 to-indigo-500/15 text-blue-700 ring-blue-100",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path d="M3 17V5a2 2 0 0 1 2-2h2v14H5a2 2 0 0 1-2-2Zm6 2V3h2v16H9Zm4 0V9h2v10h-2Z" />
      </svg>
    ),
  },
  {
    label: "YTD performance",
    prompt: "How have I performed year-to-date vs the S&P 500 and TA-125?",
    accent: "from-emerald-500/15 to-teal-500/15 text-emerald-700 ring-emerald-100",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path d="M3.5 14.5 8 10l3 3 5.5-5.5M13 7h4v4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: "Behavioral blind spots",
    prompt: "What's my worst trading habit based on my history?",
    accent: "from-amber-500/15 to-orange-500/15 text-amber-700 ring-amber-100",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <circle cx="10" cy="10" r="7" />
        <path d="M10 6v4l2.5 1.5" />
      </svg>
    ),
  },
  {
    label: "Risk & concentration",
    prompt: "How concentrated is my portfolio? Any risk flags I should know about?",
    accent: "from-rose-500/15 to-pink-500/15 text-rose-700 ring-rose-100",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <path d="M10 2.5 2.5 16h15L10 2.5Z" />
        <path d="M10 8v3.5" />
        <path d="M10 13.5v.5" />
      </svg>
    ),
  },
  {
    label: "Dividend income",
    prompt: "Summarize my dividend income by ticker and year.",
    accent: "from-violet-500/15 to-purple-500/15 text-violet-700 ring-violet-100",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <circle cx="10" cy="10" r="7" />
        <path d="M10 6v8M7.5 8h3.5a1.5 1.5 0 0 1 0 3H9a1.5 1.5 0 0 0 0 3h3.5" />
      </svg>
    ),
  },
  {
    label: "What should I ask?",
    prompt: "Based on my portfolio, what's one non-obvious question I should be asking?",
    accent: "from-sky-500/15 to-cyan-500/15 text-sky-700 ring-sky-100",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path d="M12 2.25a.75.75 0 0 1 .707.495l1.01 2.78a3 3 0 0 0 1.79 1.79l2.78 1.01a.75.75 0 0 1 0 1.41l-2.78 1.01a3 3 0 0 0-1.79 1.79l-1.01 2.78a.75.75 0 0 1-1.414 0l-1.01-2.78a3 3 0 0 0-1.79-1.79l-2.78-1.01a.75.75 0 0 1 0-1.414l2.78-1.01a3 3 0 0 0 1.79-1.79l1.01-2.78A.75.75 0 0 1 12 2.25Z" />
      </svg>
    ),
  },
];

interface QuickActionsProps {
  onSelect: (text: string) => void;
  disabled?: boolean;
}

export function QuickActions({ onSelect, disabled }: QuickActionsProps) {
  return (
    <div className="px-4 pb-5">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        Try asking
      </p>
      <div className="grid grid-cols-2 gap-2">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            onClick={() => onSelect(action.prompt)}
            disabled={disabled}
            className="group relative flex items-start gap-2 overflow-hidden rounded-xl border border-slate-200 bg-white p-3 text-left text-xs text-slate-700 shadow-sm ring-1 ring-transparent transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
          >
            <span
              aria-hidden="true"
              className={`absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity group-hover:opacity-100 ${action.accent}`}
            />
            <span
              className={`relative flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-gradient-to-br ${action.accent} ring-1`}
            >
              {action.icon}
            </span>
            <span className="relative font-medium leading-tight text-slate-800">
              {action.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
