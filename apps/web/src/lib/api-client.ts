// Same-origin — /api/* is rewritten to the API service by next.config.mjs
const API_BASE = "";

const AUTH_PATHS = new Set(["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email"]);

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (res.status === 401 && typeof window !== "undefined" && !AUTH_PATHS.has(window.location.pathname)) {
    // Session expired or missing — bounce to login with return path.
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
    // Keep the caller hanging; navigation will replace the page.
    return new Promise<T>(() => {});
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      (body as { error?: string; message?: string }).error ||
      (body as { message?: string }).message ||
      `API error: ${res.status}`;
    throw new ApiError(message, res.status, body);
  }

  return res.json() as Promise<T>;
}

export function apiStreamUrl(path: string): string {
  return `${API_BASE}${path}`;
}
