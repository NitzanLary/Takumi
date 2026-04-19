/**
 * Exchange Rate Service — fetches ILS/USD rates from the Bank of Israel API.
 *
 * - Free API, no authentication required
 * - Stores daily rates in the exchange_rates table
 * - Supports historical backfill from earliest trade date
 */

import { prisma } from '../lib/db.js';

const BOI_API_BASE = 'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI/EXR/1.0';

/**
 * Get the current (latest) ILS/USD exchange rate.
 *
 * BOI doesn't publish on Fri/Sat/Sun or Israeli holidays, so "today's rate"
 * is often unavailable. We accept any rate from the last 7 days as current,
 * and on a miss we fetch a 10-day window from BOI (persisting everything we
 * get) rather than just today — this also self-heals an empty DB on first use.
 */
export async function getCurrentRate(): Promise<number> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recent = await prisma.exchangeRate.findFirst({
    where: { date: { gte: weekAgo } },
    orderBy: { date: 'desc' },
  });
  if (recent) return Number(recent.rate);

  const today = formatDate(new Date());
  const tenDaysAgo = formatDate(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000));
  const rates = await fetchRatesFromBoi(tenDaysAgo, today);

  if (rates.length > 0) {
    for (const { date, rate } of rates) {
      await prisma.exchangeRate
        .upsert({ where: { date }, create: { date, rate }, update: { rate } })
        .catch(() => {});
    }
    return rates[rates.length - 1].rate;
  }

  // Last resort: any historical rate, even if older than a week
  const anyRate = await prisma.exchangeRate.findFirst({ orderBy: { date: 'desc' } });
  if (anyRate) return Number(anyRate.rate);

  throw new Error('No exchange rate data available');
}

/**
 * Get the exchange rate for a specific date.
 * Falls back to the nearest prior date if exact date not found.
 */
export async function getRate(date: Date): Promise<number> {
  const exact = await prisma.exchangeRate.findUnique({
    where: { date },
  });
  if (exact) return Number(exact.rate);

  // Find nearest prior rate
  const prior = await prisma.exchangeRate.findFirst({
    where: { date: { lte: date } },
    orderBy: { date: 'desc' },
  });
  if (prior) return Number(prior.rate);

  throw new Error(`No exchange rate available for ${date.toISOString().slice(0, 10)} or prior`);
}

/**
 * Backfill exchange rates from the earliest trade date to today.
 */
export async function backfillRates(): Promise<{ inserted: number; from: string; to: string }> {
  // Find the earliest trade date
  const earliest = await prisma.trade.findFirst({
    orderBy: { tradeDate: 'asc' },
    select: { tradeDate: true },
  });

  if (!earliest) {
    return { inserted: 0, from: '', to: '' };
  }

  const from = formatDate(earliest.tradeDate);
  const to = formatDate(new Date());

  const rates = await fetchRatesFromBoi(from, to);

  let inserted = 0;
  for (const { date, rate } of rates) {
    try {
      await prisma.exchangeRate.upsert({
        where: { date },
        create: { date, rate },
        update: { rate },
      });
      inserted++;
    } catch {
      // Skip duplicates or errors
    }
  }

  return { inserted, from, to };
}

/**
 * Fetch rates from the Bank of Israel SDMX API.
 * Returns an array of { date, rate } sorted by date ascending.
 */
async function fetchRatesFromBoi(
  startDate: string,
  endDate: string
): Promise<Array<{ date: Date; rate: number }>> {
  const url = `${BOI_API_BASE}/?startperiod=${startDate}&endperiod=${endDate}&format=sdmx-json`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[exchange-rate] BOI API returned ${response.status}`);
      return [];
    }

    const data = await response.json() as BoiSdmxResponse;
    return parseBoiResponse(data);
  } catch (err) {
    console.error('[exchange-rate] Failed to fetch from BOI:', err);
    return [];
  }
}

interface BoiSdmxResponse {
  data?: {
    dataSets?: Array<{
      series?: Record<string, {
        observations?: Record<string, [number, ...unknown[]]>;
      }>;
    }>;
    structure?: {
      dimensions?: {
        observation?: Array<{
          values?: Array<{ id: string; name?: string }>;
        }>;
      };
    };
  };
}

/**
 * Parse the Bank of Israel SDMX JSON response.
 * The response structure has observations keyed by index,
 * with dates in the dimension values.
 */
function parseBoiResponse(data: BoiSdmxResponse): Array<{ date: Date; rate: number }> {
  const results: Array<{ date: Date; rate: number }> = [];

  try {
    const dataSets = data?.data?.dataSets;
    if (!dataSets || dataSets.length === 0) return results;

    const series = dataSets[0].series;
    if (!series) return results;

    // Get time dimension values
    const timeDimension = data?.data?.structure?.dimensions?.observation;
    const timeValues = timeDimension?.[0]?.values || [];

    // Get the first (and usually only) series
    const seriesKey = Object.keys(series)[0];
    if (!seriesKey) return results;

    const observations = series[seriesKey].observations;
    if (!observations) return results;

    for (const [index, values] of Object.entries(observations)) {
      const timeValue = timeValues[parseInt(index)];
      if (!timeValue || values[0] == null) continue;

      const date = new Date(timeValue.id);
      const rate = values[0];

      if (!isNaN(date.getTime()) && typeof rate === 'number' && rate > 0) {
        results.push({ date, rate });
      }
    }
  } catch (err) {
    console.error('[exchange-rate] Failed to parse BOI response:', err);
  }

  return results.sort((a, b) => a.date.getTime() - b.date.getTime());
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
