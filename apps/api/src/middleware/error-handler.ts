import type { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { config } from "../lib/config.js";

/**
 * Central error handler. Express 5 forwards rejected promises from async route
 * handlers here automatically, so most routes need no try/catch.
 *
 * - `AppError`s map to their declared status/code (4xx messages are surfaced).
 * - Anything else is an unexpected 500 (message hidden in production).
 * Every error is logged with its full stack plus request/user context.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
) {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : "InternalServerError";

  const log = req.log ?? logger;
  log.error(
    {
      err,
      statusCode,
      code,
      requestId: req.id,
      userId: req.user?.id,
      method: req.method,
      path: req.originalUrl,
    },
    err.message
  );

  // 4xx messages are safe to surface; hide unexpected 5xx detail in production.
  const message =
    statusCode < 500
      ? err.message
      : config.nodeEnv === "production"
        ? "Something went wrong"
        : err.message;

  res.status(statusCode).json({
    error: code,
    message,
    statusCode,
    requestId: req.id,
  });
}
