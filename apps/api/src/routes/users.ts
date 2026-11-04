import type { Kysely } from "kysely";
import express, { type Request, type Response } from "express";
import type { Database } from "../db/database.js";
import { EventRepository } from "../db/repositories/events.js";
import { NotificationRepository } from "../db/repositories/notifications.js";
import { ReportRepository } from "../db/repositories/reports.js";
import { SessionRepository } from "../db/repositories/sessions.js";
import { requireUser, type UserRequest } from "../auth/user-access.js";
import { sendError } from "../http/errors.js";
import {
  toActivityItem,
  toMySessionItem,
  toNotification,
  toOwnedReportResponse,
} from "./serializers.js";

export interface UsersRouterDeps {
  db: Kysely<Database>;
}

/** Account-scoped reads: only resources the signed-in user owns. */
export function createUsersRouter(deps: UsersRouterDeps) {
  const { db } = deps;
  const router = express.Router();
  const sessions = new SessionRepository(db);
  const reports = new ReportRepository(db);
  const events = new EventRepository(db);
  const notifications = new NotificationRepository(db);

  router.get("/me/sessions", requireUser(db), async (req: Request, res: Response) => {
    const { user } = req as UserRequest;
    const rows = await sessions.listByUserWithCounts(user.id);
    res.json({ sessions: rows.map(toMySessionItem) });
  });

  router.get("/me/reports", requireUser(db), async (req: Request, res: Response) => {
    const { user } = req as UserRequest;
    const rows = await reports.listByUser(user.id);
    res.json({ reports: rows.map(toOwnedReportResponse) });
  });

  router.get("/me/activity", requireUser(db), async (req: Request, res: Response) => {
    const { user } = req as UserRequest;
    const rows = await events.listForUser(user.id, 20);
    res.json({ activity: rows.map(toActivityItem) });
  });

  router.get("/me/notifications", requireUser(db), async (req: Request, res: Response) => {
    const { user } = req as UserRequest;
    const unreadOnly = req.query.unread === "1";
    const { rows, total, unread } = await notifications.listForUser(user.id, {
      limit: 50,
      offset: 0,
      unreadOnly,
    });
    res.json({ notifications: rows.map(toNotification), total, unread });
  });

  router.patch(
    "/me/notifications/:id/read",
    requireUser(db),
    async (req: Request, res: Response) => {
      const { user } = req as UserRequest;
      const ok = await notifications.markReadForUser(user.id, req.params.id);
      if (!ok) {
        sendError(res, 404, "not_found", "Unknown notification.");
        return;
      }
      res.json({ ok: true });
    },
  );

  router.post("/me/notifications/read-all", requireUser(db), async (req, res) => {
    const { user } = req as UserRequest;
    await notifications.markAllReadForUser(user.id);
    res.json({ ok: true });
  });

  return router;
}
