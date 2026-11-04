import type { Response } from "express";
import { apiErrorSchema } from "@fieldfix/contracts";

/** Send a contract-valid error envelope. */
export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  res.status(status).json(
    apiErrorSchema.parse({
      error: { code, message },
    }),
  );
}
