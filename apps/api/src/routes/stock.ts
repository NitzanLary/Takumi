import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/db.js';
import {
  getStockSummary,
  getEnrichedOpenLots,
  getRoundTripsForTicker,
} from '../services/stock-detail.service.js';
import { getHistoricalPrices } from '../services/market.service.js';
import type { StockChartResponse } from '@takumi/types';

const router = Router();

/**
 * GET /api/stock/:ticker/summary — header + overview aggregate for the detail page.
 */
router.get('/:ticker/summary', async (req: Request, res: Response) => {
  const ticker = String(req.params.ticker);
  const summary = await getStockSummary(ticker);
  if (!summary) {
    res.status(404).json({ error: `No trades found for ticker ${ticker}` });
    return;
  }
  res.json(summary);
});

/**
 * GET /api/stock/:ticker/open-lots — unsold FIFO buy lots, enriched with live price.
 */
router.get('/:ticker/open-lots', async (req: Request, res: Response) => {
  const lots = await getEnrichedOpenLots(String(req.params.ticker));
  res.json(lots);
});

/**
 * GET /api/stock/:ticker/round-trips — completed buy→sell cycles.
 */
router.get('/:ticker/round-trips', async (req: Request, res: Response) => {
  const trips = await getRoundTripsForTicker(String(req.params.ticker));
  res.json(trips);
});

/**
 * GET /api/stock/:ticker/chart?from=YYYY-MM-DD&to=YYYY-MM-DD — daily close series.
 * Range defaults to first-buy-date → today when params are omitted.
 */
router.get('/:ticker/chart', async (req: Request, res: Response) => {
  const ticker = String(req.params.ticker);

  // Resolve market/currency from an existing trade row.
  const tradeRow = await prisma.trade.findFirst({
    where: { ticker },
    orderBy: { tradeDate: 'asc' },
  });
  if (!tradeRow) {
    res.status(404).json({ error: `No trades found for ticker ${ticker}` });
    return;
  }

  const firstBuy = await prisma.trade.findFirst({
    where: { ticker, direction: 'BUY' },
    orderBy: { tradeDate: 'asc' },
  });
  if (!firstBuy) {
    const resp: StockChartResponse = {
      available: false,
      reason: 'no_buys',
      message: 'No buy trades on record for this ticker yet.',
    };
    res.json(resp);
    return;
  }

  const fromParam = req.query.from as string | undefined;
  const toParam = req.query.to as string | undefined;
  const from = fromParam ? new Date(fromParam) : firstBuy.tradeDate;
  const to = toParam ? new Date(toParam) : new Date();

  const result = await getHistoricalPrices(ticker, tradeRow.market, from, to);
  if (!result.available) {
    const message =
      result.reason === 'unmapped_tase'
        ? 'Historical price chart not available for this security.'
        : 'Unable to fetch historical prices right now. Try again later.';
    const resp: StockChartResponse = {
      available: false,
      reason: result.reason,
      message,
    };
    res.json(resp);
    return;
  }

  const resp: StockChartResponse = {
    available: true,
    currency: tradeRow.currency as 'ILS' | 'USD',
    priceSource: result.source,
    points: result.points,
  };
  res.json(resp);
});

export default router;
