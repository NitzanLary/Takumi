import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./lib/config.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requireAuth } from "./middleware/require-auth.js";
import authRouter from "./routes/auth.js";
import tradesRouter from "./routes/trades.js";
import syncRouter from "./routes/sync.js";
import positionsRouter from "./routes/positions.js";
import analyticsRouter from "./routes/analytics.js";
import marketRouter from "./routes/market.js";
import exchangeRatesRouter from "./routes/exchange-rates.js";
import snapshotsRouter from "./routes/snapshots.js";
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
app.use("/api/snapshots", snapshotsRouter);
app.use("/api/stock", stockRouter);
app.use("/api/chat", chatRouter);

// Error handler
app.use(errorHandler);

// Bind to :: (all IPv6 + IPv4 via dual-stack) — required for Railway private networking
app.listen(config.port, "::", () => {
  console.log(`[takumi-api] listening on :${config.port}`);
});

export default app;
