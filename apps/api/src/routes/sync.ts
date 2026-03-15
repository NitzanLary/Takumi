import { Router } from "express";
import {
  triggerSync,
  getSyncStatus,
  getSyncLog,
} from "../services/sync.service.js";

const router = Router();

router.post("/trigger", async (_req, res) => {
  const result = await triggerSync();
  if (result.status === "failed") {
    res.status(502).json(result);
  } else {
    res.json(result);
  }
});

router.get("/status", async (_req, res) => {
  const status = await getSyncStatus();
  res.json(status);
});

router.get("/log", async (req, res) => {
  const limit = req.query.limit
    ? parseInt(req.query.limit as string, 10)
    : 20;
  const log = await getSyncLog(limit);
  res.json(log);
});

export default router;
