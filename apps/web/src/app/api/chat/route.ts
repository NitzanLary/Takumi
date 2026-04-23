// Streams SSE through a Next.js Route Handler so chunks flush per-event.
// The default `next.config.mjs` rewrite buffers SSE behind some proxies
// (notably Railway's edge); Web Streams in a Route Handler do not.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_URL = process.env.API_URL || "http://localhost:3001";

export async function POST(req: Request) {
  const upstream = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: req.headers.get("cookie") ?? "",
    },
    body: await req.text(),
    signal: req.signal,
    // @ts-expect-error — Node fetch needs `duplex: "half"` to forward a streaming body,
    // but we're sending a buffered string so it's not strictly required. Kept for safety.
    duplex: "half",
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "Upstream error");
    return new Response(text, { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
