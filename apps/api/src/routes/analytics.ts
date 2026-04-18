import { Router, type Request, type Response } from 'express';
import {
  getAnalyticsSummary,
  getPnlBreakdown,
  getTotalTradeCount,
} from '../services/analytics.service.js';
import { getRiskMetrics } from '../services/risk.service.js';

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
 * GET /api/analytics/pnl?groupBy=ticker|month|market — P&L breakdown.
 */
router.get('/pnl', async (req: Request, res: Response) => {
  const groupBy = (req.query.groupBy as string) || 'ticker';
  if (!['ticker', 'month', 'market'].includes(groupBy)) {
    res.status(400).json({ error: 'groupBy must be ticker, month, or market' });
    return;
  }
  const data = await getPnlBreakdown(groupBy as 'ticker' | 'month' | 'market');
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
