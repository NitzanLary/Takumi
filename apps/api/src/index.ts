import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./lib/config.js";
import { errorHandler } from "./middleware/error-handler.js";
import tradesRouter from "./routes/trades.js";
import syncRouter from "./routes/sync.js";
import { startScheduledSync } from "./services/scheduler.service.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: `http://localhost:${process.env.WEB_PORT || 3000}` }));
app.use(express.json());

// Routes
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/trades", tradesRouter);
app.use("/api/sync", syncRouter);

// Error handler
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`[takumi-api] listening on http://localhost:${config.port}`);
  startScheduledSync();
});

export default app;
