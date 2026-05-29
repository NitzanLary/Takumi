import { Router, type Request, type Response } from 'express';
import type { EquityCurveWindow, PnlWindow } from '@takumi/types';
import {
  getAnalyticsSummary,
  getPnlBreakdown,
  getTotalTradeCount,
} from '../services/analytics.service.js';
import { getRiskMetrics } from '../services/risk.service.js';
import { computeEquityCurve } from '../services/equity-curve.service.js';

const PNL_WINDOWS: readonly PnlWindow[] = ['all', 'ytd', '12m'];
const EQUITY_CURVE_WINDOWS: readonly EquityCurveWindow[] = ['1w', '1m', 'ytd', '1y', 'all'];

const router = Router();

/**
 * GET /api/analytics/summary — portfolio-level analytics including KPIs and behavioral stats.
 */
router.get('/summary', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [summary, totalTradeCount] = await Promise.all([
    getAnalyticsSummary(userId),
    getTotalTradeCount(userId),
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
    req.user!.id,
    groupBy as 'ticker' | 'month' | 'market',
    windowRaw as PnlWindow
  );
  res.json(data);
});

/**
 * GET /api/analytics/risk — portfolio risk metrics.
 */
router.get('/risk', async (req: Request, res: Response) => {
  const metrics = await getRiskMetrics(req.user!.id);
  res.json(metrics);
});

/**
 * GET /api/analytics/equity-curve?window=1w|1m|ytd|1y|all — on-demand
 * historical equity curve with KPI strip. See equity-curve.service.ts.
 */
router.get('/equity-curve', async (req: Request, res: Response) => {
  const raw = (req.query.window as string) || '1m';
  if (!EQUITY_CURVE_WINDOWS.includes(raw as EquityCurveWindow)) {
    res.status(400).json({ error: 'window must be one of 1w, 1m, ytd, 1y, all' });
    return;
  }
  const data = await computeEquityCurve(req.user!.id, raw as EquityCurveWindow);
  res.json(data);
});

export default router;
