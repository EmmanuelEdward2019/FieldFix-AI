import type { NextFunction, Request, Response } from "express";
import { apiErrorSchema } from "@fieldfix/contracts";

interface BodyParserError extends SyntaxError {
  status?: unknown;
  type?: unknown;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    err instanceof SyntaxError &&
    typeof (err as { status?: unknown }).status === "number" &&
    typeof (err as { type?: unknown }).type === "string"
  );
}

/**
 * Last-resort error handler. Never leaks stack traces to clients.
 * Body-parser failures get honest statuses instead of a 500.
 *
 * Every unexpected error is logged server-side (a 500 with no trace is
 * unobservable in production), and responses that already started streaming
 * are delegated to Express instead of crashing on a second write.
 */
export function lastResortErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isBodyParserError(err)) {
    const status = err.type === "entity.too.large" ? 413 : 400;
    const code = err.type === "entity.too.large" ? "payload_too_large" : "invalid_request";
    const message =
      err.type === "entity.too.large"
        ? "Request body exceeds the 1mb JSON limit."
        : "Request body is not valid JSON.";
    res.status(status).json(
      apiErrorSchema.parse({
        error: { code, message },
      }),
    );
    return;
  }
  if (res.headersSent) {
    console.error(err);
    next(err);
    return;
  }
  console.error(err);
  res.status(500).json(
    apiErrorSchema.parse({
      error: { code: "internal_error", message: "Unexpected server error." },
    }),
  );
}
