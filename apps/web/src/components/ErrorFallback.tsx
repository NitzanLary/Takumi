"use client";

import Link from "next/link";

/**
 * Shared presentational fallback for App Router `error.tsx` boundaries.
 * Renders a friendly message with a "Try again" action (calls `reset()`,
 * which re-renders the failed segment) and a link back to the dashboard.
 */
export function ErrorFallback({
  reset,
  title = "Something went wrong",
  description = "This section ran into an unexpected error. You can try again, or head back to your dashboard.",
  showHomeLink = true,
}: {
  reset: () => void;
  title?: string;
  description?: string;
  showHomeLink?: boolean;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        <p className="mt-2 text-sm text-gray-600">{description}</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            Try again
          </button>
          {showHomeLink && (
            <Link
              href="/dashboard"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Go to dashboard
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
