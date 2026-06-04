"use client";

import { useEffect } from "react";

/**
 * Global error boundary — the last line of defense. Catches errors thrown in
 * the root layout itself (where the normal `error.tsx` can't reach), so it must
 * render its own <html>/<body>. No app chrome is available here.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error-boundary] global", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "system-ui, sans-serif",
            padding: "1rem",
          }}
        >
          <div style={{ maxWidth: "28rem", textAlign: "center" }}>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#111827" }}>
              Something went wrong
            </h1>
            <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#4b5563" }}>
              Takumi hit an unexpected error. Please reload the page.
            </p>
            <button
              onClick={reset}
              style={{
                marginTop: "1.5rem",
                borderRadius: "0.375rem",
                backgroundColor: "#0d9488",
                color: "white",
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
