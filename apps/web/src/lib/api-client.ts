// Same-origin — /api/* is rewritten to the API service by next.config.mjs
const API_BASE = "";

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { message?: string }).message || `API error: ${res.status}`
    );
  }

  return res.json() as Promise<T>;
}

export function apiStreamUrl(path: string): string {
  return `${API_BASE}${path}`;
}
