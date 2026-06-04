"use client";

import { useEffect } from "react";
import { ErrorFallback } from "@/components/ErrorFallback";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error-boundary] analytics", error);
  }, [error]);

  return <ErrorFallback reset={reset} title="Couldn't load analytics" />;
}
