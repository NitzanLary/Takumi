import { Router, type Request, type Response } from 'express';
import { getOpenPositions } from '../services/position.service.js';
import { maybeCaptureDaily } from '../services/snapshot.service.js';

const router = Router();

/**
 * GET /api/positions — returns all open positions derived from FIFO lot matching.
 * Also triggers auto-capture of daily snapshot if past market close.
 */
router.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const positions = await getOpenPositions(userId);
  // Fire-and-forget daily snapshot capture
  maybeCaptureDaily(userId).catch(() => {});
  res.json(positions);
});

export default router;
