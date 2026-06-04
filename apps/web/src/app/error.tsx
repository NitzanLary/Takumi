"use client";

import { useEffect } from "react";
import { ErrorFallback } from "@/components/ErrorFallback";

/**
 * Root segment error boundary — catches render errors in any page not covered
 * by a more specific `error.tsx`. Renders inside the root layout, so the
 * sidebar/topbar chrome stays intact.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error-boundary] root", error);
  }, [error]);

  return <ErrorFallback reset={reset} />;
}
