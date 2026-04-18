import { Router } from "express";
import multer from "multer";
import {
  getSyncStatus,
  getSyncLog,
} from "../services/sync.service.js";
import { importXlsx } from "../services/xlsx-import.service.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

router.post("/import", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ status: "failed", error: "No file uploaded" });
    return;
  }

  if (!req.file.originalname.endsWith(".xlsx")) {
    res.status(400).json({ status: "failed", error: "Only .xlsx files are supported" });
    return;
  }

  const result = await importXlsx(req.file.buffer, req.file.originalname);
  const statusCode = result.status === "failed" ? 422 : 200;
  res.status(statusCode).json(result);
});

export default router;
