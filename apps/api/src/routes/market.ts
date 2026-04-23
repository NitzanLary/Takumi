import { Router, type Request, type Response } from 'express';
import {
  getLatestPrices,
  refreshAllPrices,
  getBenchmarks,
  getUnmappedTickers,
  saveTaseMapping,
} from '../services/market.service.js';
import { getOpenPositions } from '../services/position.service.js';

const router = Router();

/**
 * GET /api/market/prices?tickers=AAPL,MSFT — get cached/fresh prices for tickers.
 */
router.get('/prices', async (req: Request, res: Response) => {
  const tickersParam = req.query.tickers as string;
  if (!tickersParam) {
    res.status(400).json({ error: 'tickers query parameter required' });
    return;
  }

  const tickers = tickersParam.split(',').map((t) => ({
    ticker: t.trim(),
    market: 'US', // default; for specific market info, use /positions
    currency: 'USD',
  }));

  const prices = await getLatestPrices(tickers);
  res.json(Object.fromEntries(prices));
});

/**
 * POST /api/market/refresh — force refresh all open position tickers + benchmarks.
 */
router.post('/refresh', async (req: Request, res: Response) => {
  const positions = await getOpenPositions(req.user!.id);
  const tickers = positions.map((p) => ({
    ticker: p.ticker,
    market: p.market,
    currency: p.currency,
  }));

  const prices = await refreshAllPrices(tickers);
  res.json({
    refreshed: prices.size,
    prices: Object.fromEntries(prices),
  });
});

/**
 * GET /api/market/benchmarks — get TA-125 and S&P 500 quotes.
 */
router.get('/benchmarks', async (_req: Request, res: Response) => {
  const benchmarks = await getBenchmarks();
  res.json(benchmarks);
});

/**
 * GET /api/market/unmapped — get TASE tickers missing Yahoo Finance mapping.
 */
router.get('/unmapped', async (_req: Request, res: Response) => {
  const unmapped = await getUnmappedTickers();
  res.json(unmapped);
});

/**
 * POST /api/market/map — save a TASE ticker → Yahoo symbol mapping.
 * Body: { ticker: string, yahooSymbol: string }
 */
router.post('/map', async (req: Request, res: Response) => {
  const { ticker, yahooSymbol } = req.body;
  if (!ticker || !yahooSymbol) {
    res.status(400).json({ error: 'ticker and yahooSymbol are required' });
    return;
  }

  await saveTaseMapping(ticker, yahooSymbol);
  res.json({ success: true, ticker, yahooSymbol });
});

export default router;
