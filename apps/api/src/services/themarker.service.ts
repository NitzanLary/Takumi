/**
 * TheMarker Finance scraper — fallback quote source for TASE securities
 * that aren't available on Yahoo Finance (notably Israeli mutual funds /
 * קרנות נאמנות, where the paper number has no `.TA` trading symbol).
 *
 * Fetches https://finance.themarker.com/stock/{paperId}, extracts the
 * server-rendered Apollo cache from <script id="__NEXT_DATA__">, and
 * reads the canonical Asset record at:
 *   props.apolloState['ROOT_QUERY.assets({"ids":"<paperId>"}).0']
 *
 * TheMarker quotes Israeli prices in agorot (1/100 ILS) — same convention
 * as IBI — so we divide by 100 to normalize to ILS, matching our internal
 * trades.price convention.
 */

import type { MarketQuote, Currency } from '@takumi/types';

interface TheMarkerAsset {
  name?: string;
  value?: number;
  numeralChange?: number;
  changePercentage?: number;
  volume?: number | null;
  dailyAvgVolume?: number | null;
  lastTradeTime?: number;
  type?: string;
  assetNumber?: string;
}

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const NEXT_DATA_RE =
  /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;

export async function fetchTheMarkerQuote(
  paperId: string,
  currency: Currency = 'ILS'
): Promise<MarketQuote | null> {
  const url = `https://finance.themarker.com/stock/${encodeURIComponent(paperId)}`;
  let html: string;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`[themarker] HTTP ${res.status} for paperId=${paperId}`);
      return null;
    }
    html = await res.text();
  } catch (err) {
    console.warn(`[themarker] fetch failed for paperId=${paperId}:`, err);
    return null;
  }

  const match = NEXT_DATA_RE.exec(html);
  if (!match) {
    console.warn(`[themarker] No __NEXT_DATA__ block for paperId=${paperId}`);
    return null;
  }

  let apolloState: Record<string, unknown>;
  try {
    const parsed = JSON.parse(match[1]) as {
      props?: { apolloState?: Record<string, unknown> };
    };
    apolloState = parsed.props?.apolloState ?? {};
  } catch (err) {
    console.warn(`[themarker] __NEXT_DATA__ parse error for paperId=${paperId}:`, err);
    return null;
  }

  // Apollo cache key format: ROOT_QUERY.assets({"ids":"<paperId>"}).0
  const key = `ROOT_QUERY.assets({"ids":"${paperId}"}).0`;
  const asset = apolloState[key] as TheMarkerAsset | undefined;

  if (!asset || typeof asset.value !== 'number') {
    // Scan as fallback — key shape might vary if TheMarker changes query args.
    for (const [k, v] of Object.entries(apolloState)) {
      if (
        k.startsWith('ROOT_QUERY.assets(') &&
        k.includes(`"${paperId}"`) &&
        k.endsWith('.0') &&
        v &&
        typeof (v as TheMarkerAsset).value === 'number'
      ) {
        return buildQuote(paperId, v as TheMarkerAsset, currency);
      }
    }
    console.warn(`[themarker] No asset data for paperId=${paperId}`);
    return null;
  }

  return buildQuote(paperId, asset, currency);
}

function buildQuote(
  paperId: string,
  asset: TheMarkerAsset,
  currency: Currency
): MarketQuote {
  // value, numeralChange, dailyHigh, dailyLow are in agorot → divide by 100 for ILS
  const priceIls = (asset.value ?? 0) / 100;
  const changeIls =
    typeof asset.numeralChange === 'number' ? asset.numeralChange / 100 : null;
  return {
    ticker: paperId,
    price: priceIls,
    dayChange: changeIls,
    dayChangePct: asset.changePercentage ?? null,
    high52w: null,
    low52w: null,
    volume: typeof asset.volume === 'number' ? asset.volume : null,
    currency,
    fetchedAt: new Date().toISOString(),
  };
}
