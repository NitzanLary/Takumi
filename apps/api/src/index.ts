import express from "express";
import cors from "cors";
import helmet from "helmet";
import { randomUUID } from "crypto";
import { pinoHttp } from "pino-http";
import { config } from "./lib/config.js";
import { logger } from "./lib/logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requireAuth } from "./middleware/require-auth.js";
import authRouter from "./routes/auth.js";
import tradesRouter from "./routes/trades.js";
import syncRouter from "./routes/sync.js";
import positionsRouter from "./routes/positions.js";
import analyticsRouter from "./routes/analytics.js";
import marketRouter from "./routes/market.js";
import exchangeRatesRouter from "./routes/exchange-rates.js";
import stockRouter from "./routes/stock.js";
import chatRouter from "./routes/chat.js";
import { registerTools } from "./ai/chat-handler.js";
import { allToolSchemas, executeTool } from "./ai/tools/index.js";

const app = express();

// Register AI tools
registerTools(allToolSchemas, executeTool);

app.use(helmet());
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json());

// Per-request structured logging. Attaches a child logger to `req.log` and a
// request id to `req.id`. Runs before requireAuth, but customProps/serializers
// are evaluated at response time, so `req.user` is populated by then.
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers["x-request-id"];
      const id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
      res.setHeader("x-request-id", id);
      return id;
    },
    customProps: (req) => ({ userId: req.user?.id }),
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  })
);

// Public — health check (Railway uptime), and the auth router itself.
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
app.use("/api/auth", authRouter);

// All routes below require an authenticated session.
app.use("/api", requireAuth);

app.use("/api/trades", tradesRouter);
app.use("/api/sync", syncRouter);
app.use("/api/positions", positionsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/market", marketRouter);
app.use("/api/exchange-rates", exchangeRatesRouter);
app.use("/api/stock", stockRouter);
app.use("/api/chat", chatRouter);

// Error handler
app.use(errorHandler);

// Bind to :: (all IPv6 + IPv4 via dual-stack) — required for Railway private networking
app.listen(config.port, "::", () => {
  logger.info({ port: config.port }, "takumi-api listening");
});

export default app;
