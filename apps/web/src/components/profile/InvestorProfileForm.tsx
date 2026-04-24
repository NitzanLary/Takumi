"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { CurrentUser, InvestorHorizon, InvestorGoal } from "@/components/UserProvider";

export const HORIZON_OPTIONS: { value: InvestorHorizon; label: string; hint: string }[] = [
  { value: "intraday", label: "Intraday / day trading", hint: "In and out the same day" },
  { value: "swing", label: "Days to weeks", hint: "Swing trades" },
  { value: "position", label: "Months to a year", hint: "Position trades" },
  { value: "long_term", label: "1+ years", hint: "Long-term investor" },
  { value: "mixed", label: "Mixed", hint: "Varies by position" },
];

export const GOAL_OPTIONS: { value: InvestorGoal; label: string; hint: string }[] = [
  { value: "aggressive_growth", label: "Grow capital aggressively", hint: "High-risk, high-reward" },
  { value: "steady_growth", label: "Steady long-term growth", hint: "Compounding over years" },
  { value: "income", label: "Generate income", hint: "Dividends, distributions" },
  { value: "preservation", label: "Preserve capital", hint: "Low-risk, capital protection" },
  { value: "learning", label: "Learn / experiment", hint: "Trying things out" },
];

interface Props {
  initial: Pick<CurrentUser, "investorHorizon" | "investorGoal" | "investorNotes">;
  onSaved: (user: CurrentUser) => void;
  onSkip?: () => void;
  submitLabel?: string;
  skipLabel?: string;
  compact?: boolean;
}

export function InvestorProfileForm({
  initial,
  onSaved,
  onSkip,
  submitLabel = "Save",
  skipLabel = "Skip for now",
  compact = false,
}: Props) {
  const [horizon, setHorizon] = useState<InvestorHorizon | "">(initial.investorHorizon ?? "");
  const [goal, setGoal] = useState<InvestorGoal | "">(initial.investorGoal ?? "");
  const [notes, setNotes] = useState(initial.investorNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(payload: {
    horizon: InvestorHorizon | null;
    goal: InvestorGoal | null;
    notes: string | null;
  }) {
    setError(null);
    setSaving(true);
    try {
      const res = await apiFetch<{ user: CurrentUser }>("/api/auth/profile", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      onSaved(res.user);
    } catch (err) {
      setError((err as Error).message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await save({
      horizon: horizon || null,
      goal: goal || null,
      notes: notes.trim() || null,
    });
  }

  async function onSkipClick() {
    // Skipping still records that we asked — empty profile with timestamp.
    await save({ horizon: null, goal: null, notes: null });
    onSkip?.();
  }

  const sectionClass = compact ? "space-y-2" : "space-y-3";
  const labelClass = "block text-sm font-medium text-gray-800";
  const hintClass = "text-xs text-gray-500";

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className={sectionClass}>
        <div>
          <label className={labelClass}>How long do you typically hold a position?</label>
          <p className={hintClass}>Helps the AI frame answers to match your pace.</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {HORIZON_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition ${
                horizon === opt.value
                  ? "border-teal-500 bg-teal-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="horizon"
                value={opt.value}
                checked={horizon === opt.value}
                onChange={() => setHorizon(opt.value)}
                className="mt-1 text-teal-600 focus:ring-teal-500"
              />
              <span>
                <span className="block font-medium text-gray-900">{opt.label}</span>
                <span className="block text-xs text-gray-500">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className={sectionClass}>
        <div>
          <label className={labelClass}>What are you mainly trying to do with this portfolio?</label>
          <p className={hintClass}>Shapes what metrics the AI emphasises.</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {GOAL_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition ${
                goal === opt.value
                  ? "border-teal-500 bg-teal-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="goal"
                value={opt.value}
                checked={goal === opt.value}
                onChange={() => setGoal(opt.value)}
                className="mt-1 text-teal-600 focus:ring-teal-500"
              />
              <span>
                <span className="block font-medium text-gray-900">{opt.label}</span>
                <span className="block text-xs text-gray-500">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className={sectionClass}>
        <label htmlFor="investor-notes" className={labelClass}>
          Anything else I should know? <span className="text-gray-400">(optional)</span>
        </label>
        <p className={hintClass}>Strategy, sectors you avoid, risk limits, rules you follow.</p>
        <textarea
          id="investor-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          rows={3}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
          placeholder="e.g. Value-focused, avoid highly leveraged stocks, never hold through earnings."
        />
        <div className="text-right text-xs text-gray-400">{notes.length}/500</div>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex items-center justify-end gap-3">
        {onSkip && (
          <button
            type="button"
            onClick={onSkipClick}
            disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50"
          >
            {skipLabel}
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
