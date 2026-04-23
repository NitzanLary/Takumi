"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { AuthCard } from "@/components/auth/AuthCard";

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"pending" | "success" | "error">("pending");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState("error");
      setError("No verification token provided.");
      return;
    }
    (async () => {
      try {
        await apiFetch("/api/auth/verify-email", {
          method: "POST",
          body: JSON.stringify({ token }),
        });
        setState("success");
      } catch (err) {
        setState("error");
        setError((err as Error).message || "Verification failed");
      }
    })();
  }, [token]);

  if (state === "pending") {
    return <AuthCard title="Verifying…"><p className="text-sm text-gray-600">Please wait.</p></AuthCard>;
  }

  if (state === "success") {
    return (
      <AuthCard title="Email verified" subtitle="Your account is ready.">
        <Link
          href="/login"
          className="block w-full rounded-md bg-teal-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-teal-700"
        >
          Sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Verification failed" subtitle={error ?? undefined}>
      <p className="text-sm text-gray-600">
        The link may have expired or already been used.
      </p>
      <div className="mt-4 space-y-2">
        <Link href="/login" className="block text-sm text-teal-700 hover:underline">
          Back to sign in
        </Link>
      </div>
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}
