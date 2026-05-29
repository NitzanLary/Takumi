import { Router, type Request, type Response } from 'express';
import { getOpenPositions } from '../services/position.service.js';

const router = Router();

/**
 * GET /api/positions — returns all open positions derived from FIFO lot matching.
 */
router.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const positions = await getOpenPositions(userId);
  res.json(positions);
});

export default router;
