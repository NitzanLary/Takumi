/**
 * Structured application logger (pino).
 *
 * - Production: emits raw JSON lines to stdout (Railway captures these as-is for
 *   aggregation). One object per log entry — easy to query by field.
 * - Development: pretty-printed via the `pino-pretty` transport for readability.
 *
 * Level is taken from `LOG_LEVEL` (default `info`). Use the base `logger`
 * directly in services (no request scope), or the per-request child logger on
 * `req.log` (attached by pino-http) inside route/middleware code.
 */

import { pino } from "pino";
import { config } from "./config.js";

const isProd = config.nodeEnv === "production";

// The MCP stdio server owns stdout — it is the JSON-RPC transport — so logs
// must go to stderr (fd 2) there or they corrupt the protocol stream.
const fd = process.env.LOG_TO_STDERR === "1" ? 2 : 1;

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info",
    // Pretty output in dev; raw JSON in prod.
    transport: isProd
      ? undefined
      : {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
            destination: fd,
          },
        },
    redact: {
      // Never log secrets/credentials.
      paths: ["req.headers.cookie", "req.headers.authorization"],
      remove: true,
    },
  },
  // Only needed on the transport-less (prod) path; the pretty transport routes
  // itself via the `destination` option above.
  isProd ? pino.destination(fd) : undefined
);
