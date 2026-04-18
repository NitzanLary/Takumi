import { Router, type Request, type Response } from 'express';
import {
  getCurrentRate,
  getRate,
  backfillRates,
} from '../services/exchange-rate.service.js';

const router = Router();

/**
 * GET /api/exchange-rates — get current rate, or rate for a specific date.
 * Query: ?date=YYYY-MM-DD (optional)
 */
router.get('/', async (req: Request, res: Response) => {
  const dateParam = req.query.date as string | undefined;

  if (dateParam) {
    const date = new Date(dateParam);
    if (isNaN(date.getTime())) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      return;
    }
    const rate = await getRate(date);
    res.json({ date: dateParam, rate });
  } else {
    const rate = await getCurrentRate();
    res.json({ date: new Date().toISOString().slice(0, 10), rate });
  }
});

/**
 * POST /api/exchange-rates/backfill — backfill from earliest trade date to today.
 */
router.post('/backfill', async (_req: Request, res: Response) => {
  const result = await backfillRates();
  res.json(result);
});

export default router;
