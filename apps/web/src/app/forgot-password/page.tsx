"use client";

import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { AuthCard, inputClass, primaryButtonClass } from "@/components/auth/AuthCard";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
    } catch {
      // Intentionally swallow — we always show the same confirmation to avoid
      // revealing which emails exist in the system.
    } finally {
      setLoading(false);
      setDone(true);
    }
  }

  if (done) {
    return (
      <AuthCard title="Check your email" subtitle="If an account exists, a reset link is on its way.">
        <p className="text-sm text-gray-600">The link expires in 1 hour.</p>
        <p className="mt-4 text-sm text-gray-600">
          <Link href="/login" className="text-teal-700 hover:underline">
            Back to sign in
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password" subtitle="Enter your email and we'll send a reset link.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <button type="submit" disabled={loading} className={primaryButtonClass}>
          {loading ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-gray-600">
        <Link href="/login" className="text-teal-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
