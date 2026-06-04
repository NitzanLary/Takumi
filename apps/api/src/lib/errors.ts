/**
 * AppError — a typed application error carrying an HTTP status and a stable
 * machine-readable code. Throw it from routes/services to produce a precise
 * non-500 response via the central error handler, e.g.:
 *
 *   throw new AppError(400, "BadRequest", "groupBy must be ticker, month, or market");
 *
 * Anything that isn't an AppError is treated as an unexpected 500.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
