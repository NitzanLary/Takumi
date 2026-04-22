import { Router, type Request, type Response } from 'express';
import type { PnlWindow } from '@takumi/types';
import {
  getAnalyticsSummary,
  getPnlBreakdown,
  getTotalTradeCount,
} from '../services/analytics.service.js';
import { getRiskMetrics } from '../services/risk.service.js';

const PNL_WINDOWS: readonly PnlWindow[] = ['all', 'ytd', '12m'];

const router = Router();

/**
 * GET /api/analytics/summary — portfolio-level analytics including KPIs and behavioral stats.
 */
router.get('/summary', async (_req: Request, res: Response) => {
  const [summary, totalTradeCount] = await Promise.all([
    getAnalyticsSummary(),
    getTotalTradeCount(),
  ]);
  res.json({ ...summary, totalTradeCount });
});

/**
 * GET /api/analytics/pnl?groupBy=ticker|month|market[&window=all|ytd|12m] — P&L breakdown.
 * `window` currently only applies when groupBy=market.
 */
router.get('/pnl', async (req: Request, res: Response) => {
  const groupBy = (req.query.groupBy as string) || 'ticker';
  if (!['ticker', 'month', 'market'].includes(groupBy)) {
    res.status(400).json({ error: 'groupBy must be ticker, month, or market' });
    return;
  }
  const windowRaw = (req.query.window as string) || 'all';
  if (!PNL_WINDOWS.includes(windowRaw as PnlWindow)) {
    res.status(400).json({ error: 'window must be all, ytd, or 12m' });
    return;
  }
  const data = await getPnlBreakdown(
    groupBy as 'ticker' | 'month' | 'market',
    windowRaw as PnlWindow
  );
  res.json(data);
});

/**
 * GET /api/analytics/risk — portfolio risk metrics.
 */
router.get('/risk', async (_req: Request, res: Response) => {
  const metrics = await getRiskMetrics();
  res.json(metrics);
});

export default router;
