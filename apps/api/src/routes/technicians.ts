import type { Kysely } from "kysely";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import {
  createContactRequestSchema,
  createHandoffSchema,
  searchTechniciansQuerySchema,
  updateContactRequestStatusSchema,
  upsertOwnTechnicianProfileSchema,
  type ContactRequestStatus,
} from "@fieldfix/contracts";
import { requireUser, type UserRequest } from "../auth/user-access.js";
import type { Database, TechnicianProfile } from "../db/database.js";
import { AuditLogRepository } from "../db/repositories/audit.js";
import { EvidenceFileRepository } from "../db/repositories/evidence.js";
import { NotificationRepository } from "../db/repositories/notifications.js";
import { ReportRepository } from "../db/repositories/reports.js";
import { SessionRepository } from "../db/repositories/sessions.js";
import {
  ContactRequestRepository,
  DiagnosticHandoffRepository,
  TechnicianProfileRepository,
} from "../db/repositories/technicians.js";
import { sendError } from "../http/errors.js";
import { PostgresRateLimitStore, rateLimit } from "../http/rate-limit.js";
import {
  toContactRequestResponse,
  toDiagnosticHandoffResponse,
  toEvidenceFileResponse,
  toReportResponse,
  toSessionResponse,
  toTechnicianCard,
  toTechnicianListItem,
} from "./serializers.js";

export interface TechniciansRouterDeps {
  db: Kysely<Database>;
}

const uuidParam = z.string().uuid();

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function firstString(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Great-circle distance; the search origin is never persisted. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/**
 * Status lifecycle. Forward-only: terminal states (declined /
 * completed / cancelled) accept no further transitions, and a state
 * can never move back to submitted.
 */
const ALLOWED_TRANSITIONS: Record<ContactRequestStatus, ContactRequestStatus[]> = {
  submitted: ["awaiting_response", "accepted", "declined", "customer_contacted", "cancelled"],
  awaiting_response: ["accepted", "declined", "customer_contacted", "cancelled"],
  accepted: ["customer_contacted", "in_progress", "completed", "cancelled"],
  customer_contacted: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  declined: [],
  completed: [],
  cancelled: [],
};

/** Technician side drives progress; the requester side may only cancel. */
const TECHNICIAN_STATUSES: ContactRequestStatus[] = [
  "awaiting_response",
  "accepted",
  "declined",
  "customer_contacted",
  "in_progress",
  "completed",
];

export function createTechniciansRouter(deps: TechniciansRouterDeps) {
  const { db } = deps;
  const router = express.Router();
  const profiles = new TechnicianProfileRepository(db);
  const requests = new ContactRequestRepository(db);
  const handoffs = new DiagnosticHandoffRepository(db);
  const sessions = new SessionRepository(db);
  const files = new EvidenceFileRepository(db);
  const reports = new ReportRepository(db);
  const notifications = new NotificationRepository(db);
  const audit = new AuditLogRepository(db);

  // Own budget, never shared with auth/login: contact writes are
  // spam-sensitive but must not lock anyone out of signing in.
  const contactLimiter = rateLimit({
    maxRequests: 60,
    windowMs: 15 * 60 * 1000,
    scope: "contact",
    store: new PostgresRateLimitStore(db),
  });

  /* Public directory (no login; no contact PII in list results). */

  router.get("/", async (req: Request, res: Response) => {
    const parsed = searchTechniciansQuerySchema.safeParse({
      city: firstString(req.query.city),
      region: firstString(req.query.region),
      specialty: firstString(req.query.specialty),
      device_type: firstString(req.query.device_type),
      lat: firstString(req.query.lat),
      lng: firstString(req.query.lng),
      radius_km: firstString(req.query.radius_km),
      limit: firstString(req.query.limit),
    });
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", formatIssues(parsed.error));
      return;
    }
    const q = parsed.data;
    const geo = q.lat != null && q.lng != null;
    // Radius filtering happens in JS (haversine), so fetch past the
    // page limit first — otherwise nearby techs past the SQL cutoff
    // would be wrongly dropped before distance is computed.
    const rows = await profiles.search({
      city: q.city,
      region: q.region,
      specialty: q.specialty,
      deviceType: q.device_type,
      limit: geo ? 1000 : q.limit,
    });
    let items: { row: TechnicianProfile; distance: number | null }[] = rows.map(
      (row) => ({ row, distance: null }),
    );
    if (geo) {
      items = items
        .filter((item) => item.row.latitude != null && item.row.longitude != null)
        .map((item) => ({
          row: item.row,
          distance:
            Math.round(
              haversineKm(q.lat as number, q.lng as number, item.row.latitude as number, item.row.longitude as number) * 100,
            ) / 100,
        }))
        .filter((item) => (item.distance as number) <= q.radius_km)
        .sort((a, b) => (a.distance as number) - (b.distance as number))
        .slice(0, q.limit);
    }
    res.json({
      technicians: items.map((item) => toTechnicianListItem(item.row, item.distance)),
    });
  });

  /* Inbox (login; owner-only rows). Defined before /:userId. */

  router.get("/requests", requireUser(db), async (req: Request, res: Response) => {
    const { user } = req as UserRequest;
    const role = firstString(req.query.role);
    if (role !== undefined && role !== "sent" && role !== "received") {
      sendError(res, 400, "invalid_request", "role must be 'sent' or 'received'.");
      return;
    }
    const rows =
      role === "sent" ? await requests.listSent(user.id) : await requests.listReceived(user.id);
    res.json({ requests: rows.map(toContactRequestResponse) });
  });

  /* Own profile (login; full card incl contacts). Defined before /:userId. */

  router.get("/me", requireUser(db), async (req: Request, res: Response) => {
    const { user } = req as UserRequest;
    const row = await profiles.getByUserId(user.id);
    if (!row) {
      sendError(res, 404, "profile_not_found", "You have no technician profile yet.");
      return;
    }
    res.json({ technician: toTechnicianCard(row) });
  });

  router.put("/me", requireUser(db), async (req: Request, res: Response) => {
    const parsed = upsertOwnTechnicianProfileSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", formatIssues(parsed.error));
      return;
    }
    const { user } = req as UserRequest;
    const existing = await profiles.getByUserId(user.id);
    const d = parsed.data;
    const row = await profiles.upsert({
      user_id: user.id,
      display_name: d.display_name,
      city: d.city,
      region: d.region,
      postal_code: d.postal_code ?? null,
      latitude: d.latitude ?? null,
      longitude: d.longitude ?? null,
      specialties: d.specialties,
      device_types: d.device_types,
      phone: d.phone ?? null,
      contact_email: d.contact_email ?? null,
      whatsapp: d.whatsapp ?? null,
      about: d.about ?? null,
      accepting_requests: d.accepting_requests,
    });
    await audit.append(
      { actorType: "user", actorId: user.id, actorEmail: user.email },
      req,
      {
        action: "technician.profile.upsert",
        targetType: "technician_profile",
        targetId: user.id,
      },
    );
    res.status(existing ? 200 : 201).json({ technician: toTechnicianCard(row) });
  });

  router.get("/:userId", async (req: Request, res: Response) => {
    const parsedId = uuidParam.safeParse(req.params.userId);
    if (!parsedId.success) {
      sendError(res, 404, "technician_not_found", "No such technician.");
      return;
    }
    const row = await profiles.getByUserId(parsedId.data);
    if (!row) {
      sendError(res, 404, "technician_not_found", "No such technician.");
      return;
    }
    res.json({ technician: toTechnicianCard(row) });
  });

  /* Contact (login; own rate-limit scope). */

  router.post(
    "/:userId/contact",
    requireUser(db),
    contactLimiter,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.userId);
      const parsed = createContactRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      if (!parsedId.success) {
        sendError(res, 404, "technician_not_found", "No such technician.");
        return;
      }
      const { user } = req as UserRequest;
      const profile = await profiles.getByUserId(parsedId.data);
      if (!profile) {
        sendError(res, 404, "technician_not_found", "No such technician.");
        return;
      }
      if (profile.user_id === user.id) {
        sendError(res, 422, "cannot_contact_self", "You cannot contact your own listing.");
        return;
      }
      if (!profile.accepting_requests) {
        sendError(
          res,
          422,
          "not_accepting",
          "This technician is not accepting requests right now.",
        );
        return;
      }
      if (parsed.data.session_id) {
        const session = await sessions.getById(parsed.data.session_id);
        if (!session) {
          sendError(res, 404, "session_not_found", "No such session.");
          return;
        }
        if (session.user_id !== user.id) {
          sendError(res, 403, "forbidden", "You can only link your own sessions.");
          return;
        }
      }
      const created = await requests.create(profile.user_id, user.id, parsed.data);
      await notifications
        .record({
          kind: "contact_request",
          title: `New contact request from ${user.name}`,
          body: parsed.data.message.slice(0, 200),
          link: "/technicians",
          userId: profile.user_id,
        })
        .catch(() => undefined);
      await audit.append(
        { actorType: "user", actorId: user.id, actorEmail: user.email },
        req,
        {
          action: "technician.contact.create",
          targetType: "contact_request",
          targetId: created.id,
        },
      );
      res.status(201).json({ request: toContactRequestResponse(created) });
    },
  );

  /* Status transitions (side + lifecycle enforced). */

  router.patch("/requests/:reqId", requireUser(db), async (req: Request, res: Response) => {
    const parsedId = uuidParam.safeParse(req.params.reqId);
    const parsed = updateContactRequestStatusSchema.safeParse(req.body ?? {});
    if (!parsedId.success) {
      sendError(res, 404, "request_not_found", "No such contact request.");
      return;
    }
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", formatIssues(parsed.error));
      return;
    }
    const { user } = req as UserRequest;
    const row = await requests.getById(parsedId.data);
    if (!row) {
      sendError(res, 404, "request_not_found", "No such contact request.");
      return;
    }
    const isTechnician = row.technician_user_id === user.id;
    const isRequester = row.requester_user_id === user.id;
    if (!isTechnician && !isRequester) {
      sendError(res, 403, "forbidden", "This request is not yours.");
      return;
    }
    const next = parsed.data.status;
    if (next !== row.status) {
      const sideOk = isTechnician
        ? TECHNICIAN_STATUSES.includes(next)
        : next === "cancelled";
      if (!sideOk) {
        sendError(
          res,
          403,
          "forbidden",
          isRequester
            ? "Requesters may only cancel their own requests."
            : "This transition is not available to you.",
        );
        return;
      }
      if (!ALLOWED_TRANSITIONS[row.status].includes(next)) {
        sendError(
          res,
          422,
          "invalid_transition",
          `Cannot move a ${row.status} request to ${next}.`,
        );
        return;
      }
    }
    const updated =
      next === row.status ? row : await requests.updateStatus(row.id, next);
    if (!updated) {
      sendError(res, 404, "request_not_found", "No such contact request.");
      return;
    }
    if (next !== row.status) {
      await audit.append(
        { actorType: "user", actorId: user.id, actorEmail: user.email },
        req,
        {
          action: "technician.request.status",
          targetType: "contact_request",
          targetId: row.id,
          metadata: { from: row.status, to: next },
        },
      );
    }
    res.json({ request: toContactRequestResponse(updated) });
  });

  /* Consented handoffs (requester writes, technician reads). */

  router.post(
    "/requests/:reqId/handoff",
    requireUser(db),
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.reqId);
      const parsed = createHandoffSchema.safeParse(req.body ?? {});
      if (!parsedId.success) {
        sendError(res, 404, "request_not_found", "No such contact request.");
        return;
      }
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { user } = req as UserRequest;
      const row = await requests.getById(parsedId.data);
      if (!row) {
        sendError(res, 404, "request_not_found", "No such contact request.");
        return;
      }
      if (row.requester_user_id !== user.id) {
        sendError(res, 403, "forbidden", "Only the requester can share diagnostics.");
        return;
      }
      const session = await sessions.getById(parsed.data.session_id);
      if (!session) {
        sendError(res, 404, "session_not_found", "No such session.");
        return;
      }
      if (session.user_id !== user.id) {
        sendError(res, 403, "forbidden", "You can only share your own sessions.");
        return;
      }
      // Evidence-id allowlist: every id must be a file on THIS session.
      const sessionFileIds = new Set(
        (await files.listBySession(session.id)).map((f) => f.id),
      );
      const outside = parsed.data.shared_evidence_ids.filter((id) => !sessionFileIds.has(id));
      if (outside.length > 0) {
        sendError(
          res,
          422,
          "evidence_not_in_session",
          "Some shared evidence is not part of this session.",
        );
        return;
      }
      const created = await handoffs.create(row.id, user.id, parsed.data);
      await audit.append(
        { actorType: "user", actorId: user.id, actorEmail: user.email },
        req,
        {
          action: "technician.handoff.create",
          targetType: "contact_request",
          targetId: row.id,
          metadata: {
            session_id: session.id,
            evidence_count: parsed.data.shared_evidence_ids.length,
            shared_report: parsed.data.shared_report,
          },
        },
      );
      res.status(201).json({ handoff: toDiagnosticHandoffResponse(created) });
    },
  );

  router.get("/requests/:reqId/handoff", requireUser(db), async (req: Request, res: Response) => {
    const parsedId = uuidParam.safeParse(req.params.reqId);
    if (!parsedId.success) {
      sendError(res, 404, "request_not_found", "No such contact request.");
      return;
    }
    const { user } = req as UserRequest;
    const row = await requests.getById(parsedId.data);
    if (!row) {
      sendError(res, 404, "request_not_found", "No such contact request.");
      return;
    }
    if (row.technician_user_id !== user.id) {
      sendError(res, 403, "forbidden", "Only the contacted technician can read this handoff.");
      return;
    }
    const handoff = await handoffs.getLatestByRequestId(row.id);
    if (!handoff) {
      sendError(res, 404, "handoff_not_found", "Nothing has been shared on this request yet.");
      return;
    }
    const session = await sessions.getById(handoff.session_id);
    if (!session) {
      sendError(res, 404, "session_not_found", "The shared session no longer exists.");
      return;
    }
    // Consent scoping: only allowlisted files, latest report only when shared.
    const allowed = new Set(handoff.shared_evidence_ids ?? []);
    const evidence = (await files.listBySession(session.id)).filter((f) => allowed.has(f.id));
    const report = handoff.shared_report
      ? await reports.getLatest(session.id)
      : undefined;
    res.json({
      handoff: toDiagnosticHandoffResponse(handoff),
      session: toSessionResponse(session),
      evidence: evidence.map(toEvidenceFileResponse),
      report: report ? toReportResponse(report) : null,
    });
  });

  return router;
}
