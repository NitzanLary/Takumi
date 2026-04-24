"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useCurrentUser } from "@/components/UserProvider";
import { InvestorProfileForm } from "./InvestorProfileForm";

const SKIP_PATHS = new Set([
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
]);

// Shown once on the first authenticated page view after signup, until the user
// either completes or explicitly skips the profile. Skipping still records a
// timestamp so we don't keep nagging.
export function OnboardingModal() {
  const { user, refresh } = useCurrentUser();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (SKIP_PATHS.has(pathname)) return;
    // Don't surface over the settings page — they're already editing it there.
    if (pathname === "/settings") return;
    setOpen(user.investorProfileUpdatedAt === null);
  }, [user, pathname]);

  if (!open || !user) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl sm:p-8">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-gray-900">
            Tell me how you invest
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Three quick questions so Takumi can tailor its advice to your style instead
            of defaulting to generic trader talk. You can change this any time in Settings.
          </p>
        </div>
        <InvestorProfileForm
          initial={{
            investorHorizon: user.investorHorizon,
            investorGoal: user.investorGoal,
            investorNotes: user.investorNotes,
          }}
          onSaved={async () => {
            await refresh();
            setOpen(false);
          }}
          onSkip={() => setOpen(false)}
          submitLabel="Save & continue"
        />
      </div>
    </div>
  );
}
