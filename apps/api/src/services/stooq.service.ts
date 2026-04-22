/**
 * Stooq fallback quote source — used when Yahoo Finance is unreachable.
 *
 * Railway's egress sometimes gets rate-limited (HTTP 429) or blocked by
 * Yahoo's crumb endpoint (fc.yahoo.com), which takes the whole yahoo-finance2
 * library offline. Stooq exposes a free, auth-free CSV quote API that works
 * reliably from cloud provider IPs.
 *
 * Endpoint: https://stooq.com/q/l/?s=<symbol>&f=spd2t2ohlcv
 * Flags:    s=symbol p=prev-close d2=date t2=time o=open h=high l=low c=close v=volume
 * CSV shape: SYMBOL,prevClose,date,time,open,high,low,close,volume
 *
 * Coverage: US stocks (.us suffix) and S&P 500 (^spx). Does NOT cover TASE
 * or the TA-125 index — those still rely on Yahoo/TheMarker.
 *
 * Data is end-of-day / delayed real-time (~15 min). Good enough for the
 * positions page; precise intraday prices aren't a product requirement.
 */

import type { MarketQuote, Currency } from '@takumi/types';

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Convert our internal ticker to Stooq's symbol format. Returns null if Stooq can't serve it. */
export function resolveStooqSymbol(ticker: string, market: string): string | null {
  if (market === 'US' || market === 'NYSE' || market === 'NASDAQ') {
    return `${ticker.toLowerCase()}.us`;
  }
  if (ticker === '^GSPC') return '^spx';
  return null;
}

export async function fetchStooqQuote(
  ticker: string,
  stooqSymbol: string,
  currency: Currency
): Promise<MarketQuote | null> {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=spd2t2ohlcv`;
  let csv: string;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/csv' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.warn(`[stooq] HTTP ${res.status} for ${stooqSymbol}`);
      return null;
    }
    csv = await res.text();
  } catch (err) {
    console.warn(`[stooq] fetch failed for ${stooqSymbol}:`, err);
    return null;
  }

  // CSV: SYMBOL,prevClose,date,time,open,high,low,close,volume
  const [line] = csv.trim().split('\n');
  if (!line) return null;
  const cols = line.split(',');
  if (cols.length < 9) {
    console.warn(`[stooq] unexpected CSV shape for ${stooqSymbol}: ${line}`);
    return null;
  }

  const prevCloseStr = cols[1];
  const closeStr = cols[7];
  const volumeStr = cols[8];

  // Stooq uses "N/D" for unknown fields (after-hours, symbol not found, etc.)
  if (prevCloseStr === 'N/D' || closeStr === 'N/D') {
    console.warn(`[stooq] no data for ${stooqSymbol}`);
    return null;
  }

  const price = Number(closeStr);
  const prevClose = Number(prevCloseStr);
  if (!Number.isFinite(price) || price <= 0) {
    console.warn(`[stooq] invalid price for ${stooqSymbol}: ${closeStr}`);
    return null;
  }

  const dayChange = Number.isFinite(prevClose) && prevClose > 0 ? price - prevClose : null;
  const dayChangePct =
    dayChange !== null && prevClose > 0 ? (dayChange / prevClose) * 100 : null;
  const volume = Number(volumeStr);

  return {
    ticker,
    price,
    dayChange,
    dayChangePct,
    high52w: null,
    low52w: null,
    volume: Number.isFinite(volume) ? volume : null,
    currency,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Fetch daily historical closes from Stooq for a US ticker.
 * Endpoint: https://stooq.com/q/d/l/?s=<sym>&i=d&d1=YYYYMMDD&d2=YYYYMMDD (CSV download)
 * CSV header: Date,Open,High,Low,Close,Volume
 * Returns [] on any failure.
 */
export async function fetchStooqHistorical(
  stooqSymbol: string,
  from: Date,
  to: Date
): Promise<Array<{ date: string; close: number }>> {
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&d1=${fmt(from)}&d2=${fmt(to)}&i=d`;
  let csv: string;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/csv' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[stooq] historical HTTP ${res.status} for ${stooqSymbol}`);
      return [];
    }
    csv = await res.text();
  } catch (err) {
    console.warn(`[stooq] historical fetch failed for ${stooqSymbol}:`, err);
    return [];
  }

  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase();
  if (!header.includes('date') || !header.includes('close')) {
    console.warn(`[stooq] unexpected historical CSV header for ${stooqSymbol}: ${header}`);
    return [];
  }

  const points: Array<{ date: string; close: number }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 5) continue;
    const date = cols[0];
    const close = Number(cols[4]);
    if (!date || !Number.isFinite(close) || close <= 0) continue;
    points.push({ date, close });
  }
  return points;
}
