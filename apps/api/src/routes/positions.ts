import { Router, type Request, type Response } from 'express';
import { getOpenPositions } from '../services/position.service.js';
import { maybeCaptureDaily } from '../services/snapshot.service.js';

const router = Router();

/**
 * GET /api/positions — returns all open positions derived from FIFO lot matching.
 * Also triggers auto-capture of daily snapshot if past market close.
 */
router.get('/', async (_req: Request, res: Response) => {
  const positions = await getOpenPositions();
  // Fire-and-forget daily snapshot capture
  maybeCaptureDaily().catch(() => {});
  res.json(positions);
});

export default router;
