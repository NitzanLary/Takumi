import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./lib/config.js";
import { errorHandler } from "./middleware/error-handler.js";
import tradesRouter from "./routes/trades.js";
import syncRouter from "./routes/sync.js";
import positionsRouter from "./routes/positions.js";
import analyticsRouter from "./routes/analytics.js";
import marketRouter from "./routes/market.js";
import exchangeRatesRouter from "./routes/exchange-rates.js";
import snapshotsRouter from "./routes/snapshots.js";
import chatRouter from "./routes/chat.js";
import { registerTools } from "./ai/chat-handler.js";
import { allToolSchemas, executeTool } from "./ai/tools/index.js";

const app = express();

// Register AI tools
registerTools(allToolSchemas, executeTool);

app.use(helmet());
app.use(cors({ origin: `http://localhost:${process.env.WEB_PORT || 3000}` }));
app.use(express.json());

// Routes
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/trades", tradesRouter);
app.use("/api/sync", syncRouter);
app.use("/api/positions", positionsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/market", marketRouter);
app.use("/api/exchange-rates", exchangeRatesRouter);
app.use("/api/snapshots", snapshotsRouter);
app.use("/api/chat", chatRouter);

// Error handler
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`[takumi-api] listening on http://localhost:${config.port}`);
});

export default app;
