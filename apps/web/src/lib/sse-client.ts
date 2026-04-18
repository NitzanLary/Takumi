/**
 * SSE Client — consumes Server-Sent Events from a POST request.
 *
 * Browser's EventSource only supports GET, so we use fetch() with
 * ReadableStream reader and manual SSE line parsing.
 */

import type { AiSseEvent } from '@takumi/types';

// Same-origin — /api/* is rewritten to the API service by next.config.mjs
const API_BASE = '';

export async function fetchSSE(
  path: string,
  body: unknown,
  onEvent: (event: AiSseEvent) => void,
  onError?: (error: Error) => void
): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    const err = new Error(`SSE request failed: ${response.status} ${errorText}`);
    onError?.(err);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onError?.(new Error('No response body'));
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const jsonStr = trimmed.slice(6); // Remove "data: " prefix
        try {
          const event = JSON.parse(jsonStr) as AiSseEvent;
          onEvent(event);
        } catch {
          // Skip malformed JSON
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim().startsWith('data: ')) {
      try {
        const event = JSON.parse(buffer.trim().slice(6)) as AiSseEvent;
        onEvent(event);
      } catch {
        // Skip malformed JSON
      }
    }
  } catch (err) {
    onError?.(err as Error);
  }
}
