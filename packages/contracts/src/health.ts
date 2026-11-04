import { z } from "zod";

/** Liveness status. `ok` is the only value a healthy service reports. */
export const healthStatusSchema = z.enum(["ok"]);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

/** GET /health response. Served by apps/api, consumed by apps/web. */
export const healthResponseSchema = z.object({
  status: healthStatusSchema,
  service: z.string().min(1),
  version: z.string().min(1),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.string().datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Standard error envelope for API 4xx/5xx responses. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
