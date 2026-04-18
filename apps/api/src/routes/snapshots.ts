import { Router, type Request, type Response } from 'express';
import {
  captureSnapshot,
  getSnapshots,
} from '../services/snapshot.service.js';

const router = Router();

/**
 * GET /api/snapshots — get portfolio snapshots for equity curve.
 * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD (both optional)
 */
router.get('/', async (req: Request, res: Response) => {
  const fromParam = req.query.from as string | undefined;
  const toParam = req.query.to as string | undefined;

  const from = fromParam ? new Date(fromParam) : undefined;
  const to = toParam ? new Date(toParam) : undefined;

  const snapshots = await getSnapshots(from, to);
  res.json(snapshots);
});

/**
 * POST /api/snapshots/capture — manually trigger today's snapshot.
 */
router.post('/capture', async (_req: Request, res: Response) => {
  const snapshot = await captureSnapshot();
  res.json(snapshot);
});

export default router;
