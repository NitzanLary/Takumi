"use client";

import { useState } from "react";
import { useCurrentUser } from "@/components/UserProvider";
import {
  GOAL_OPTIONS,
  HORIZON_OPTIONS,
  InvestorProfileForm,
} from "@/components/profile/InvestorProfileForm";

export default function SettingsPage() {
  const { user, loading, refresh } = useCurrentUser();
  const [editing, setEditing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  if (loading || !user) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <p className="text-gray-500">Loading…</p>
        </div>
      </div>
    );
  }

  const horizonLabel = user.investorHorizon
    ? HORIZON_OPTIONS.find((o) => o.value === user.investorHorizon)?.label
    : null;
  const goalLabel = user.investorGoal
    ? GOAL_OPTIONS.find((o) => o.value === user.investorGoal)?.label
    : null;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Settings</h2>

      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Investor profile</h3>
            <p className="mt-1 text-sm text-gray-600">
              Shared with Takumi on every chat so advice is tailored to how you invest.
            </p>
          </div>
          {!editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setJustSaved(false);
              }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {user.investorProfileUpdatedAt ? "Edit" : "Set up"}
            </button>
          )}
        </div>

        {editing ? (
          <InvestorProfileForm
            initial={{
              investorHorizon: user.investorHorizon,
              investorGoal: user.investorGoal,
              investorNotes: user.investorNotes,
            }}
            onSaved={async () => {
              await refresh();
              setEditing(false);
              setJustSaved(true);
            }}
            submitLabel="Save changes"
          />
        ) : (
          <dl className="space-y-3 text-sm">
            <div className="flex gap-3">
              <dt className="w-40 shrink-0 text-gray-500">Time horizon</dt>
              <dd className="text-gray-900">{horizonLabel ?? <span className="text-gray-400">Not set</span>}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-40 shrink-0 text-gray-500">Primary goal</dt>
              <dd className="text-gray-900">{goalLabel ?? <span className="text-gray-400">Not set</span>}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-40 shrink-0 text-gray-500">Notes</dt>
              <dd className="whitespace-pre-wrap text-gray-900">
                {user.investorNotes?.trim() || <span className="text-gray-400">None</span>}
              </dd>
            </div>
            {justSaved && (
              <p className="pt-2 text-xs text-teal-700">Saved.</p>
            )}
          </dl>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="text-lg font-semibold text-gray-900">Account</h3>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex gap-3">
            <dt className="w-40 shrink-0 text-gray-500">Email</dt>
            <dd className="text-gray-900">{user.email}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-40 shrink-0 text-gray-500">Display name</dt>
            <dd className="text-gray-900">
              {user.displayName || <span className="text-gray-400">Not set</span>}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
