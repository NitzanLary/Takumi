import { Router } from "express";
import { getTrades } from "../services/trade.service.js";
import type { TradeFilters } from "@takumi/types";

const router = Router();

router.get("/", async (req, res) => {
  const filters: TradeFilters = {
    ticker: req.query.ticker as string | undefined,
    market: req.query.market as TradeFilters["market"],
    direction: req.query.direction as TradeFilters["direction"],
    dateFrom: req.query.dateFrom as string | undefined,
    dateTo: req.query.dateTo as string | undefined,
    source: req.query.source as TradeFilters["source"],
    page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
    includeNonTrades: req.query.includeNonTrades === "true",
  };

  const result = await getTrades(req.user!.id, filters);
  res.json(result);
});

export default router;
