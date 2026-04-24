/**
 * Stock Detail Service — composes existing services to produce the per-stock
 * summary shown on /positions/:ticker. No new SQL, no duplicated logic.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { prisma } from '../lib/db.js';
import type {
  Currency,
  Market,
  Position,
  StockCurrencyImpact,
  StockDividendSummary,
  StockFeesPaid,
  StockOpenLot,
  StockRealizedPnl,
  StockRoundTrip,
  StockSummary,
} from '@takumi/types';
import { getOpenLotsForTicker } from './position.service.js';
import { getMatchedLotsForTicker } from './pnl.service.js';
import { getOpenPositions } from './position.service.js';
import { getLatestPrices } from './market.service.js';
import { getCurrentRate, getRate } from './exchange-rate.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sectorMapPath = path.resolve(__dirname, '../data/sector-map.json');
let sectorMap: Record<string, { sector: string; industry: string }> = {};
try {
  sectorMap = JSON.parse(readFileSync(sectorMapPath, 'utf-8'));
} catch {
  console.warn('[stock-detail] Could not load sector-map.json');
}

function toNum(d: unknown): number {
  return Number(d);
}

/**
 * Pull the embedded ticker out of IBI's securityName string. Handles the two
 * US-style shapes IBI emits: "COMPANY(TICKER)" and "TICKER US". Returns null
 * for anything else (Hebrew TASE names, FX rows, admin codes, etc).
 */
function extractEmbeddedTicker(securityName: string): string | null {
  const paren = securityName.match(/\(([A-Z][A-Z0-9.-]{0,5})\)/);
  if (paren) return paren[1];
  const us = securityName.match(/^([A-Z][A-Z0-9.-]{0,5})\s+US$/);
  if (us) return us[1];
  return null;
}

/**
 * Build the full summary payload for one ticker. Works for open AND closed
 * positions — closed positions return position=null, isClosed=true.
 */
export async function getStockSummary(
  userId: string,
  ticker: string
): Promise<StockSummary | null> {
  const trades = await prisma.trade.findMany({
    where: { userId, ticker },
    orderBy: { tradeDate: 'asc' },
  });
  if (trades.length === 0) return null;

  const first = trades[0];
  const market = first.market as Market;
  const currency = first.currency as Currency;
  const buys = trades.filter((t) => t.direction === 'BUY');
  const sells = trades.filter((t) => t.direction === 'SELL');
  const firstBuyDate = buys.length > 0 ? buys[0].tradeDate : null;
  const lastTxDate = trades[trades.length - 1].tradeDate;

  const holdingDays = firstBuyDate
    ? Math.round((Date.now() - firstBuyDate.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Find current open position (if any) by filtering the full positions list.
  // getOpenPositions() runs FIFO matching once (cached 1min) and enriches with
  // live prices + ILS weights consistent with the rest of the app.
  const positions = await getOpenPositions(userId);
  const openPosition = positions.find((p) => p.ticker === ticker) ?? null;

  const position: Position | null = openPosition
    ? {
        ticker: openPosition.ticker,
        securityName: openPosition.securityName,
        market: openPosition.market as Market,
        currency: openPosition.currency as Currency,
        quantity: openPosition.quantity,
        avgCostBasis: openPosition.avgCostBasis,
        currentPrice: openPosition.currentPrice,
        marketValue: openPosition.marketValue,
        marketValueIls: openPosition.marketValueIls,
        totalCostIls: openPosition.totalCostIls,
        unrealizedPnlIls: openPosition.unrealizedPnlIls,
        unrealizedPnl: openPosition.unrealizedPnl,
        unrealizedPnlPct: openPosition.unrealizedPnlPct,
        priceSource: openPosition.priceSource,
        dayChange: openPosition.dayChange,
        dayChangePct: openPosition.dayChangePct,
        weight: openPosition.weight,
      }
    : null;

  // Realized P&L for this ticker
  const matchedLots = await getMatchedLotsForTicker(userId, ticker);
  const realizedByCurrency = new Map<Currency, StockRealizedPnl>();
  for (const lot of matchedLots) {
    const cur = lot.currency as Currency;
    const entry = realizedByCurrency.get(cur) ?? {
      currency: cur,
      realizedPnl: 0,
      tradeCount: 0,
      winCount: 0,
      lossCount: 0,
    };
    entry.realizedPnl += lot.realizedPnl;
    entry.tradeCount += 1;
    if (lot.realizedPnl > 0) entry.winCount += 1;
    else entry.lossCount += 1;
    realizedByCurrency.set(cur, entry);
  }

  // Commission / fees
  const feesByCurrency = new Map<Currency, StockFeesPaid>();
  for (const t of [...buys, ...sells]) {
    const cur = t.currency as Currency;
    const entry = feesByCurrency.get(cur) ?? {
      currency: cur,
      amount: 0,
      buyCount: 0,
      sellCount: 0,
    };
    entry.amount += toNum(t.commission);
    if (t.direction === 'BUY') entry.buyCount += 1;
    else entry.sellCount += 1;
    feesByCurrency.set(cur, entry);
  }

  // Dividends + related tax withholding (matched on ticker + tradeDate — the
  // IBI XLSX importer emits them as sibling rows).
  const dividendRows = trades.filter((t) => t.direction === 'DIVIDEND');
  const taxRows = trades.filter((t) => t.direction === 'TAX');
  const divByCurrency = new Map<Currency, StockDividendSummary>();
  // IBI dividend/tax rows carry the cash amount in `proceedsFx` (USD) — `price`
  // is the USD/ILS FX rate that day, not a per-share price, so `price * quantity`
  // would yield an ILS figure stored against a USD key.
  const cashAmount = (t: { proceedsFx: unknown; price: unknown; quantity: unknown }) =>
    t.proceedsFx != null ? toNum(t.proceedsFx) : toNum(t.price) * toNum(t.quantity);
  for (const d of dividendRows) {
    const cur = d.currency as Currency;
    const entry = divByCurrency.get(cur) ?? {
      currency: cur,
      gross: 0,
      taxWithheld: 0,
      net: 0,
      paymentCount: 0,
    };
    entry.gross += Math.abs(cashAmount(d));
    entry.paymentCount += 1;
    divByCurrency.set(cur, entry);
  }
  for (const tax of taxRows) {
    const cur = tax.currency as Currency;
    const entry = divByCurrency.get(cur);
    if (!entry) continue;
    entry.taxWithheld += Math.abs(cashAmount(tax));
  }
  for (const e of divByCurrency.values()) {
    e.net = e.gross - e.taxWithheld;
  }

  // Currency impact (US only). For each still-open lot, split unrealized P&L
  // into "price move" (had FX stayed constant) and "FX move" (had price stayed
  // constant) — both expressed in ILS. Residual interaction term is small and
  // folded into price-move.
  let currencyImpact: StockCurrencyImpact | null = null;
  if (openPosition && currency === 'USD') {
    const openLots = await getOpenLotsForTicker(userId, ticker);
    let rateNow = 1;
    try {
      rateNow = await getCurrentRate();
    } catch {
      // leave rateNow at 1
    }
    let priceMoveIls = 0;
    let fxMoveIls = 0;
    for (const lot of openLots) {
      let rateAtBuy: number;
      try {
        rateAtBuy = await getRate(lot.date);
      } catch {
        rateAtBuy = rateNow;
      }
      const priceMove = lot.quantity * (openPosition.currentPrice - lot.price) * rateAtBuy;
      const fxMove = lot.quantity * lot.price * (rateNow - rateAtBuy);
      // Fold the small interaction term into priceMove so the decomposition sums cleanly.
      const interaction = lot.quantity * (openPosition.currentPrice - lot.price) * (rateNow - rateAtBuy);
      priceMoveIls += priceMove + interaction;
      fxMoveIls += fxMove;
    }
    currencyImpact = {
      priceMoveIls,
      fxMoveIls,
      totalUnrealizedPnlIls: priceMoveIls + fxMoveIls,
      rateNow,
    };
  }

  const sectorEntry = sectorMap[ticker] ?? null;

  // Resolve display name: prefer the Yahoo-derived name cached in the
  // `securities` table (kept current automatically on every quote hit). Fall
  // back to whatever securityName the most recent BUY/SELL carried — that's
  // what the user saw at trade time.
  const security = await prisma.security.findUnique({
    where: { ticker },
    select: { name: true },
  });
  const coreTrades = [...buys, ...sells].sort(
    (a, b) => b.tradeDate.getTime() - a.tradeDate.getTime(),
  );
  const latestCoreName = coreTrades[0]?.securityName ?? first.securityName;
  const currentName = security?.name ?? latestCoreName;

  // Prior names: legacy securityName values that embed a ticker DIFFERENT
  // from the current one — i.e. true broker renames, not just IBI-vs-Yahoo
  // formatting mismatches. "ASTS US" vs Yahoo's "AST SpaceMobile, Inc." is
  // the same ticker and should be silent; "FIVG US" on a SIXG page (or
  // "FACEBOOK(FB)" on a META page) is a real rename and worth surfacing.
  const priorNamesSet = new Set<string>();
  for (const t of coreTrades) {
    if (!t.securityName || t.securityName === currentName) continue;
    const embedded = extractEmbeddedTicker(t.securityName);
    // No embedded ticker (Hebrew TASE names, etc) — skip, we can't tell
    // whether it's a rename or a format difference.
    if (!embedded) continue;
    if (embedded !== ticker) priorNamesSet.add(t.securityName);
  }
  const priorNames = Array.from(priorNamesSet);

  return {
    ticker,
    securityName: currentName,
    priorNames,
    market,
    currency,
    sector: sectorEntry?.sector ?? null,
    industry: sectorEntry?.industry ?? null,
    firstBuyDate: firstBuyDate ? firstBuyDate.toISOString() : null,
    lastTransactionDate: lastTxDate.toISOString(),
    holdingDays,
    isClosed: openPosition === null,
    position,
    realizedPnl: Array.from(realizedByCurrency.values()),
    totalFeesPaid: Array.from(feesByCurrency.values()),
    totalDividends: Array.from(divByCurrency.values()),
    currencyImpact,
  };
}

/**
 * FIFO open lots for a ticker, enriched with current price for per-lot
 * unrealized P&L. Used by the Overview tab's "Open lots" table.
 */
export async function getEnrichedOpenLots(
  userId: string,
  ticker: string
): Promise<StockOpenLot[]> {
  const lots = await getOpenLotsForTicker(userId, ticker);
  if (lots.length === 0) return [];

  const first = lots[0];
  const prices = await getLatestPrices([
    { ticker, market: first.market, currency: first.currency },
  ]);
  const quote = prices.get(ticker);
  const currentPrice = quote?.price ?? first.price;

  return lots.map((lot) => {
    const marketValue = lot.quantity * currentPrice;
    const cost = lot.quantity * lot.price;
    const pnl = marketValue - cost;
    return {
      buyDate: lot.date.toISOString(),
      quantity: lot.quantity,
      buyPrice: lot.price,
      commission: lot.commission,
      currentPrice,
      marketValue,
      unrealizedPnl: pnl,
      unrealizedPnlPct: cost > 0 ? (pnl / cost) * 100 : 0,
      currency: lot.currency as Currency,
    };
  });
}

/**
 * Completed round-trips (matched FIFO lots) for a ticker, mapped into the
 * shared API shape. Sorted newest-first by sell date.
 */
export async function getRoundTripsForTicker(
  userId: string,
  ticker: string
): Promise<StockRoundTrip[]> {
  const lots = await getMatchedLotsForTicker(userId, ticker);
  return lots
    .map((lot) => {
      const grossReturn =
        lot.buyPrice > 0 ? ((lot.sellPrice - lot.buyPrice) / lot.buyPrice) * 100 : 0;
      return {
        buyDate: lot.buyDate.toISOString(),
        sellDate: lot.sellDate.toISOString(),
        quantity: lot.quantity,
        buyPrice: lot.buyPrice,
        sellPrice: lot.sellPrice,
        commission: lot.commission,
        realizedPnl: lot.realizedPnl,
        returnPct: grossReturn,
        holdingDays: lot.holdingDays,
        currency: lot.currency as Currency,
      };
    })
    .sort((a, b) => new Date(b.sellDate).getTime() - new Date(a.sellDate).getTime());
}
