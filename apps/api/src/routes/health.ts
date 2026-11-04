import { Router, type Request, type Response } from "express";
import { healthResponseSchema } from "@fieldfix/contracts";

export function createHealthRouter(options: { service: string; version: string }): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    const payload = healthResponseSchema.parse({
      status: "ok",
      service: options.service,
      version: options.version,
      uptimeSeconds: Math.round(process.uptime() * 100) / 100,
      timestamp: new Date().toISOString(),
    });
    res.status(200).json(payload);
  });

  return router;
}
