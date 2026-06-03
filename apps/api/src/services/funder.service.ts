/**
 * funder.service.ts — Historical daily prices for TASE instruments from funder.co.il.
 *
 * Two undocumented page-embedded endpoints:
 *   - Securities ("seco"):  https://www.funder.co.il/seco/{paperId}/s
 *   - Funds     ("fundo"):  https://www.funder.co.il/fundo/{fundId}
 *
 * Both pages server-side render the full historical series inline as a JavaScript
 * variable literal. There is no JSON API — we fetch the page HTML and extract the
 * literal. The only header required is a non-empty User-Agent (empty UA → 403 WAF).
 *
 * Differences between the two:
 *   security: var tStockData  = [["DD/MM/YYYY", "chg%", "close", "vol", "high",
 *                                 "low", "open", "close"], ...]   // prices in agorot
 *   fund:     var tStockData2 = {"x":[{"c":"YYYY-MM-DD","p":NAV}, ...]}  // NAV in agorot
 *
 * BOTH endpoints quote prices in agorot, not ILS. Earlier comments in the
 * upstream spec (`funder/tase-history.ts`) claimed funds were "already in ILS";
 * empirical cross-check vs. TheMarker showed funder fund NAVs are 100× higher,
 * matching the agorot convention used by all other TASE sources (IBI, Yahoo
 * .TA, TheMarker). We divide by 100 for both kinds.
 *
 * Both endpoints always return the full available history; there is no date-range
 * query parameter. We filter client-side via opts.start / opts.end.
 *
 * Fragile by nature — funder.co.il may change variable names or markup at any time.
 * Symptom: fetchFunderHistorical returns [] and the console shows a FunderParseError.
 * Recovery: re-run `funder/discover-endpoints.ts` (Playwright) to re-derive the
 * variable names, then update the literalRegex entries below.
 *
 * Ported from a verified standalone driver; reverse-engineering notes and the
 * Playwright recovery script live in `funder/` (NOTES.md, discover-endpoints.ts).
 */

// ---- public types -----------------------------------------------------------

export type Instrument = 'security' | 'fund';

export interface PriceBar {
  /** ISO yyyy-mm-dd */
  date: string;
  open?: number;
  high?: number;
  low?: number;
  /** Daily close (securities) or NAV (funds), in ILS. */
  close: number;
  volume?: number;
}

export interface FetchHistoryOptions {
  /** Inclusive lower bound. Bars on this date or later are kept. */
  start?: Date;
  /** Inclusive upper bound. Bars on this date or earlier are kept. */
  end?: Date;
  /** Override the default User-Agent. */
  userAgent?: string;
  /** Max retry attempts for transient failures (5xx, 429, network). Default 3. */
  maxRetries?: number;
  /** Optional AbortSignal. */
  signal?: AbortSignal;
}

// ---- error types ------------------------------------------------------------

export class FunderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FunderError';
  }
}

export class FunderHttpError extends FunderError {
  constructor(
    public readonly status: number,
    public readonly url: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} from ${url}`);
    this.name = 'FunderHttpError';
  }
}

export class FunderRateLimitError extends FunderHttpError {
  constructor(url: string, public readonly retryAfterMs?: number) {
    super(429, url, `Rate limited (429) by ${url}`);
    this.name = 'FunderRateLimitError';
  }
}

export class FunderParseError extends FunderError {
  constructor(message: string) {
    super(message);
    this.name = 'FunderParseError';
  }
}

export class FunderEmptyError extends FunderError {
  constructor(public readonly url: string) {
    super(`No data rows extracted from ${url}`);
    this.name = 'FunderEmptyError';
  }
}

// ---- raw response shapes ----------------------------------------------------

type RawSecurityRow = readonly [
  string, string, string, string, string, string, string, string,
];

interface RawFundPoint {
  /** ISO yyyy-mm-dd */
  c: string;
  /** NAV in ILS */
  p: number;
}

interface RawFundPayload {
  x: RawFundPoint[];
}

// ---- endpoints --------------------------------------------------------------

interface EndpointConfig {
  url: (id: number) => string;
  /** Regex must have a single capture group containing the JS literal. */
  literalRegex: RegExp;
  parse: (literal: string, url: string) => PriceBar[];
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; Takumi/1.0; +https://github.com/NitzanLary)';

const ENDPOINTS: Record<Instrument, EndpointConfig> = {
  security: {
    url: (id) => `https://www.funder.co.il/seco/${id}/s`,
    literalRegex: /var\s+tStockData\s*=\s*(\[\[[^\n]*?\]\])\s*;/,
    parse: parseSecurityLiteral,
  },
  fund: {
    url: (id) => `https://www.funder.co.il/fundo/${id}`,
    literalRegex: /var\s+tStockData2\s*=\s*(\{"x":\[[^\n]*?\]\})\s*;/,
    parse: parseFundLiteral,
  },
};

// ---- low-level fetcher ------------------------------------------------------

export async function fetchHistory(
  id: number,
  kind: Instrument,
  opts: FetchHistoryOptions = {},
): Promise<PriceBar[]> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new FunderError(`Invalid id: ${id}`);
  }
  const cfg = ENDPOINTS[kind];
  if (!cfg) throw new FunderError(`Unknown instrument kind: ${kind}`);

  const url = cfg.url(id);
  const html = await fetchHtml(url, opts);

  const match = html.match(cfg.literalRegex);
  if (!match || !match[1]) {
    throw new FunderParseError(
      `Could not find ${kind === 'security' ? 'tStockData' : 'tStockData2'} literal in ${url}. ` +
      `funder.co.il may have changed the page markup — re-run discover-endpoints.ts.`,
    );
  }

  let bars = cfg.parse(match[1], url);
  if (bars.length === 0) throw new FunderEmptyError(url);

  bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  bars = dedupAdjacentByDate(bars);

  const startIso = opts.start ? toIso(opts.start) : undefined;
  const endIso = opts.end ? toIso(opts.end) : undefined;
  if (startIso || endIso) {
    bars = bars.filter(
      (b) => (!startIso || b.date >= startIso) && (!endIso || b.date <= endIso),
    );
  }

  return bars;
}

async function fetchHtml(url: string, opts: FetchHistoryOptions): Promise<string> {
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const maxRetries = opts.maxRetries ?? 3;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const init: RequestInit = {
        headers: { 'User-Agent': userAgent, Accept: 'text/html' },
      };
      if (opts.signal) init.signal = opts.signal;
      const r = await fetch(url, init);

      if (r.status === 429) {
        const ra = r.headers.get('Retry-After');
        const retryAfterMs = ra ? parseRetryAfter(ra) : undefined;
        if (attempt < maxRetries) {
          await sleep(retryAfterMs ?? backoffMs(attempt));
          continue;
        }
        throw new FunderRateLimitError(url, retryAfterMs);
      }

      if (r.status >= 500 && r.status < 600) {
        if (attempt < maxRetries) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new FunderHttpError(r.status, url);
      }

      if (!r.ok) throw new FunderHttpError(r.status, url);

      return await r.text();
    } catch (err) {
      if (err instanceof FunderError) throw err;
      if (err instanceof Error && err.name === 'AbortError') throw err;
      lastErr = err;
      if (attempt < maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new FunderError('unknown fetch failure');
}

function backoffMs(attempt: number): number {
  return Math.min(8000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100);
}

function parseRetryAfter(value: string): number | undefined {
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs) * 1000;
  const when = Date.parse(value);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- parsers ---------------------------------------------------------------

function parseSecurityLiteral(literal: string, url: string): PriceBar[] {
  let raw: unknown;
  try {
    raw = JSON.parse(literal);
  } catch (e) {
    throw new FunderParseError(
      `tStockData literal in ${url} is not valid JSON: ${(e as Error).message}`,
    );
  }
  if (!Array.isArray(raw)) {
    throw new FunderParseError(`tStockData in ${url} is not an array`);
  }

  const out: PriceBar[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!isSecurityRow(row)) {
      throw new FunderParseError(
        `tStockData[${i}] in ${url} has unexpected shape: ${JSON.stringify(row)}`,
      );
    }
    const [dateRaw, , , volRaw, highRaw, lowRaw, openRaw, closeRaw] = row;
    const date = ddmmyyyyToIso(dateRaw);
    out.push({
      date,
      open: agorotToIls(openRaw),
      high: agorotToIls(highRaw),
      low: agorotToIls(lowRaw),
      close: agorotToIls(closeRaw),
      volume: parseIntStrict(volRaw),
    });
  }
  return out;
}

function isSecurityRow(row: unknown): row is RawSecurityRow {
  return (
    Array.isArray(row) &&
    row.length === 8 &&
    row.every((c) => typeof c === 'string')
  );
}

function parseFundLiteral(literal: string, url: string): PriceBar[] {
  let raw: unknown;
  try {
    raw = JSON.parse(literal);
  } catch (e) {
    throw new FunderParseError(
      `tStockData2 literal in ${url} is not valid JSON: ${(e as Error).message}`,
    );
  }
  if (!isFundPayload(raw)) {
    throw new FunderParseError(
      `tStockData2 in ${url} has unexpected shape (expected {x:[{c,p},...]})`,
    );
  }

  return raw.x.map((point, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(point.c)) {
      throw new FunderParseError(
        `tStockData2.x[${i}] in ${url}: bad date "${point.c}" (expected YYYY-MM-DD)`,
      );
    }
    if (!Number.isFinite(point.p)) {
      throw new FunderParseError(
        `tStockData2.x[${i}] in ${url}: bad NAV ${point.p}`,
      );
    }
    // Funder fund NAVs are quoted in agorot (same as securities). Divide by
    // 100 to normalize to ILS. See file-level note above.
    return { date: point.c, close: point.p / 100 };
  });
}

function isFundPayload(value: unknown): value is RawFundPayload {
  if (typeof value !== 'object' || value === null) return false;
  const x = (value as { x?: unknown }).x;
  if (!Array.isArray(x)) return false;
  if (x.length === 0) return true;
  const first = x[0] as { c?: unknown; p?: unknown };
  return typeof first.c === 'string' && typeof first.p === 'number';
}

// ---- helpers ---------------------------------------------------------------

function ddmmyyyyToIso(s: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) throw new FunderParseError(`bad DD/MM/YYYY date: "${s}"`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function agorotToIls(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw new FunderParseError(`bad numeric agorot value: "${s}"`);
  }
  return n / 100;
}

function parseIntStrict(s: string): number {
  const n = Number(s);
  if (!Number.isInteger(n)) {
    throw new FunderParseError(`bad integer: "${s}"`);
  }
  return n;
}

function dedupAdjacentByDate(bars: PriceBar[]): PriceBar[] {
  if (bars.length < 2) return bars;
  const out: PriceBar[] = [];
  for (const b of bars) {
    const prev = out[out.length - 1];
    if (prev && prev.date === b.date) {
      out[out.length - 1] = b;
    } else {
      out.push(b);
    }
  }
  return out;
}

function toIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---- public wrappers used by market.service ---------------------------------

export type FunderKind = 'seco' | 'fundo';

/**
 * First-call heuristic for `funder_kind`. 7-digit IBI paper numbers starting
 * with `5` are TASE mutual funds (verified examples: 5123161, 5113063, 5124573).
 * Everything else is treated as a security. The market service persists the
 * discovered kind to `securities.funder_kind` after the first successful fetch,
 * so this heuristic only matters for brand-new tickers.
 */
export function guessFunderKind(paperId: string): FunderKind {
  return /^5\d{6}$/.test(paperId) ? 'fundo' : 'seco';
}

const KIND_TO_INSTRUMENT: Record<FunderKind, Instrument> = {
  seco: 'security',
  fundo: 'fund',
};

/**
 * Thin wrapper matching the `fetchStooqHistorical` contract used by
 * market.service: returns the merged close-only series for [from, to],
 * or `[]` on any failure (never throws). OHLCV from the security endpoint
 * is dropped on write — `price_history` is close-only for v1 (CLAUDE.md
 * notes OHLCV is deferred to Phase 5 for technical indicators).
 */
export async function fetchFunderHistorical(
  paperId: string,
  kind: FunderKind,
  from: Date,
  to: Date,
): Promise<Array<{ date: string; close: number }>> {
  const id = Number(paperId);
  if (!Number.isInteger(id) || id <= 0) {
    console.warn(`[funder] Invalid paperId for historical fetch: ${paperId}`);
    return [];
  }
  try {
    const bars = await fetchHistory(id, KIND_TO_INSTRUMENT[kind], {
      start: from,
      end: to,
    });
    return bars.map((b) => ({ date: b.date, close: b.close }));
  } catch (err) {
    if (err instanceof FunderError) {
      console.warn(
        `[funder] ${err.name} for ${kind} ${paperId}: ${err.message}`,
      );
    } else {
      console.warn(`[funder] Historical fetch failed for ${kind} ${paperId}:`, err);
    }
    return [];
  }
}
