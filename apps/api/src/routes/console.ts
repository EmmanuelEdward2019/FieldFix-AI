import { randomBytes } from "node:crypto";
import { sql, type Kysely } from "kysely";
import express, { type Request, type Response } from "express";
import {
  createAnnouncementSchema,
  reviewSafetyEventSchema,
  updateDocumentPermissionSchema,
  updateProviderSchema,
  updateSettingsSchema,
  updateTechnicianVerifiedSchema,
  updateUserSchema,
} from "@fieldfix/contracts";
import type { Database } from "../db/database.js";
import {
  type AdminActor,
  type Capability,
  requireCapability,
} from "../auth/admin-access.js";
import { hashUserToken } from "../auth/user-access.js";
import { AdminRepository } from "../db/repositories/admin.js";
import { AuditLogRepository } from "../db/repositories/audit.js";
import { CitationService } from "../knowledge/citations.js";
import { DocumentRepository } from "../db/repositories/documents.js";
import {
  EvidenceFileRepository,
  ObservationRepository,
} from "../db/repositories/evidence.js";
import { EventRepository } from "../db/repositories/events.js";
import { HypothesisRepository } from "../db/repositories/hypotheses.js";
import { ModelRunRepository } from "../db/repositories/model-runs.js";
import { NotificationRepository } from "../db/repositories/notifications.js";
import { ReportRepository } from "../db/repositories/reports.js";
import { SafetyEventRepository } from "../db/repositories/safety.js";
import { SessionRepository } from "../db/repositories/sessions.js";
import { SettingsRepository } from "../db/repositories/settings.js";
import {
  DiagnosticTestRepository,
  TestResultRepository,
} from "../db/repositories/tests.js";
import { TechnicianProfileRepository } from "../db/repositories/technicians.js";
import {
  UserEmailTokensRepository,
  UserSessionsRepository,
  UsersRepository,
} from "../db/repositories/users.js";
import { EmailService } from "../email/resend.js";
import type { AppEnv } from "../env.js";
import { sendError } from "../http/errors.js";
import { renderReportPdf } from "../reports/pdf.js";
import type { MetaAdapterConfig } from "../models/meta/config.js";
import { MetaModelAdapter } from "../models/meta/client.js";
import { ModelError } from "../models/types.js";
import type { StorageAdapter } from "../storage/types.js";
import { StorageNotFoundError } from "../storage/types.js";
import {
  toAdminEvidenceItem,
  toAdminModelRun,
  toAdminReportItem,
  toAdminSafetyEvent,
  toAdminSessionItem,
  toAdminUser,
  toAuditLog,
  toIngestionJobResponse,
  toNotification,
  toReportResponse,
  toSessionDetailResponse,
} from "./serializers.js";

export interface ConsoleRouterDeps {
  db: Kysely<Database>;
  storage: StorageAdapter;
  env: AppEnv;
  metaProvider: MetaModelAdapter;
  metaConfig: MetaAdapterConfig;
  samModelId: string;
}

interface AdminConsoleRequest extends Request {
  admin: AdminActor;
}

function adminOf(req: Request): AdminActor {
  return (req as AdminConsoleRequest).admin;
}

function page(req: Request, def = 25, max = 100): { limit: number; offset: number } {
  const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const rawOffset = Array.isArray(req.query.offset) ? req.query.offset[0] : req.query.offset;
  const limit = Math.min(Math.max(Number.parseInt(String(rawLimit ?? def), 10) || def, 1), max);
  const offset = Math.max(Number.parseInt(String(rawOffset ?? "0"), 10) || 0, 0);
  return { limit, offset };
}

function str(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    value = value[0];
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

function uuidParam(value: unknown): string | null {
  const s = typeof value === "string" ? value : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}

export function createConsoleRouter(deps: ConsoleRouterDeps) {
  const { db, storage, env } = deps;
  const router = express.Router();
  const guard = (capability: Capability) => requireCapability(db, capability);

  const users = new UsersRepository(db);
  const userSessions = new UserSessionsRepository(db);
  const emailTokens = new UserEmailTokensRepository(db);
  const admin = new AdminRepository(db);
  const audit = new AuditLogRepository(db);
  const settings = new SettingsRepository(db);
  const notifications = new NotificationRepository(db);
  const sessions = new SessionRepository(db);
  const files = new EvidenceFileRepository(db);
  const observations = new ObservationRepository(db);
  const hypotheses = new HypothesisRepository(db);
  const tests = new DiagnosticTestRepository(db);
  const results = new TestResultRepository(db);
  const events = new EventRepository(db);
  const citations = new CitationService(db);
  const technicianProfiles = new TechnicianProfileRepository(db);
  const safetyEvents = new SafetyEventRepository(db);
  const runs = new ModelRunRepository(db);
  const reports = new ReportRepository(db);
  const documents = new DocumentRepository(db);
  const email = new EmailService({
    resendApiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    testMode: env.NODE_ENV === "test",
  });

  const log = (
    req: Request,
    action: string,
    opts: {
      targetType?: string;
      targetId?: string;
      outcome?: "success" | "denied" | "failed";
      metadata?: Record<string, unknown>;
    } = {},
  ) => audit.append(adminOf(req), req, { action, ...opts });

  /** Who is calling, and what may they do (drives console navigation). */
  router.get("/me", guard("overview:view"), (req: Request, res: Response) => {
    const actor = adminOf(req);
    res.json({
      actor_type: actor.actorType,
      actor_id: actor.actorId,
      actor_email: actor.actorEmail,
      role: actor.role,
      capabilities: actor.capabilities,
    });
  });

  /* Users */

  router.get("/users", guard("users:view"), async (req: Request, res: Response) => {
    const sortRaw = str(req.query.sort);
    const sort =
      sortRaw === "email" || sortRaw === "name" || sortRaw === "last_login_at"
        ? sortRaw
        : "created_at";
    const { rows, total } = await admin.listUsers({
      q: str(req.query.q),
      role: str(req.query.role),
      status: str(req.query.status),
      sort,
      dir: str(req.query.dir) === "asc" ? "asc" : "desc",
      ...page(req),
    });
    res.json({
      users: rows.map((r) =>
        toAdminUser(
          {
            id: r.id,
            email: r.email,
            name: r.name,
            password_hash: "",
            email_confirmed_at: r.email_confirmed_at,
            role: r.role,
            status: r.status,
            last_login_at: r.last_login_at,
            created_at: r.created_at,
            updated_at: r.created_at,
          },
          Number(r.session_count),
        ),
      ),
      total,
    });
  });

  router.get("/users/:id", guard("users:view"), async (req: Request, res: Response) => {
    const id = uuidParam(req.params.id);
    if (!id) {
      sendError(res, 404, "not_found", "Unknown user.");
      return;
    }
    const detail = await admin.getUserDetail(id);
    if (!detail) {
      sendError(res, 404, "not_found", "Unknown user.");
      return;
    }
    const sessionCount = await sessions
      .listByUser(id, 1)
      .then(() => detail.sessions.length)
      .catch(() => detail.sessions.length);
    res.json({
      user: toAdminUser(detail.user, sessionCount),
      sessions: detail.sessions.map((s) => ({
        id: s.id,
        device_type: s.device_type,
        manufacturer: s.manufacturer,
        model: s.model,
        status: s.status,
        safety_state: s.safety_state,
        created_at: (s.created_at as unknown as Date).toISOString(),
        updated_at: (s.updated_at as unknown as Date).toISOString(),
      })),
      reports: detail.reports.map((r) => ({
        id: r.id,
        session_id: r.session_id,
        device_type: r.device_type,
        status: r.status,
        created_at: (r.created_at as unknown as Date).toISOString(),
      })),
    });
  });

  router.patch("/users/:id", guard("users:manage"), async (req: Request, res: Response) => {
    const id = uuidParam(req.params.id);
    const parsed = updateUserSchema.safeParse(req.body);
    if (!id || !parsed.success) {
      sendError(res, 400, "invalid_request", "Valid user id and { role?, status? } are required.");
      return;
    }
    const actor = adminOf(req);
    const target = await users.getById(id);
    if (!target) {
      sendError(res, 404, "not_found", "Unknown user.");
      return;
    }
    // Role changes are the most privileged user action: super-admins only,
    // never on yourself, and never removing the last super-admin.
    if (parsed.data.role !== undefined && parsed.data.role !== target.role) {
      if (!actor.capabilities.includes("roles:manage")) {
        await log(req, "user.role.change", {
          targetType: "user",
          targetId: id,
          outcome: "denied",
        });
        sendError(res, 403, "forbidden", "Assigning roles requires Super Admin.");
        return;
      }
      if (actor.actorType === "user" && actor.actorId === id) {
        sendError(res, 422, "invalid_request", "You cannot change your own role.");
        return;
      }
      if (target.role === "super_admin") {
        const remaining = await users.countByRole("super_admin");
        if (remaining <= 1) {
          sendError(res, 422, "invalid_request", "The last Super Admin cannot be demoted.");
          return;
        }
      }
      await users.updateRole(id, parsed.data.role);
      await log(req, "user.role.change", {
        targetType: "user",
        targetId: id,
        metadata: { from: target.role, to: parsed.data.role },
      });
    }
    if (parsed.data.status !== undefined && parsed.data.status !== target.status) {
      if (actor.actorType === "user" && actor.actorId === id) {
        sendError(res, 422, "invalid_request", "You cannot suspend your own account.");
        return;
      }
      await users.updateStatus(id, parsed.data.status);
      if (parsed.data.status !== "active") {
        await userSessions.deleteAllForUser(id);
      }
      await log(req, "user.status.change", {
        targetType: "user",
        targetId: id,
        metadata: { from: target.status, to: parsed.data.status },
      });
    }
    const updated = await users.getById(id);
    if (!updated) {
      sendError(res, 404, "not_found", "Unknown user.");
      return;
    }
    const sessionCount = await admin
      .listSessions({ limit: 1, offset: 0, user: updated.email })
      .then((r) => r.total)
      .catch(() => 0);
    res.json({ user: toAdminUser(updated, sessionCount) });
  });

  router.post(
    "/users/:id/password-reset",
    guard("users:manage"),
    async (req: Request, res: Response) => {
      const id = uuidParam(req.params.id);
      if (!id) {
        sendError(res, 404, "not_found", "Unknown user.");
        return;
      }
      const target = await users.getById(id);
      if (!target) {
        sendError(res, 404, "not_found", "Unknown user.");
        return;
      }
      await emailTokens.revokeOutstanding(id, "password_reset");
      const token = randomBytes(32).toString("hex");
      await emailTokens.create(
        id,
        "password_reset",
        hashUserToken(token),
        new Date(Date.now() + 60 * 60 * 1000),
      );
      const link = `${env.APP_BASE_URL}/reset-password?token=${token}`;
      await email
        .sendPasswordReset(target.email, target.name, link)
        .catch((err: unknown) => {
          console.error(`[email] admin reset send failed for ${target.email}:`, err);
        });
      await log(req, "user.password_reset", { targetType: "user", targetId: id });
      res.json({ ok: true });
    },
  );

  /* Technician directory: the verified badge is admin-managed only. */

  router.patch(
    "/technicians/:userId",
    guard("users:manage"),
    async (req: Request, res: Response) => {
      const id = uuidParam(req.params.userId);
      const parsed = updateTechnicianVerifiedSchema.safeParse(req.body);
      if (!id || !parsed.success) {
        sendError(res, 400, "invalid_request", "Valid technician user id and { verified } are required.");
        return;
      }
      const updated = await technicianProfiles.setVerified(id, parsed.data.verified);
      if (!updated) {
        sendError(res, 404, "not_found", "No technician profile for this user.");
        return;
      }
      await log(req, "technician.verified.change", {
        targetType: "technician_profile",
        targetId: id,
        metadata: { verified: parsed.data.verified },
      });
      res.json({
        technician: {
          user_id: updated.user_id,
          display_name: updated.display_name,
          verified: updated.verified,
        },
      });
    },
  );

  /* Sessions (read-only for admins; findings are never edited here). */

  router.get("/sessions", guard("sessions:view"), async (req: Request, res: Response) => {
    const modelRaw = str(req.query.model);
    const { rows, total } = await admin.listSessions({
      device: str(req.query.device),
      status: str(req.query.status),
      safety: str(req.query.safety),
      user: str(req.query.user),
      from: str(req.query.from),
      to: str(req.query.to),
      model:
        modelRaw === "succeeded" || modelRaw === "failed" || modelRaw === "none"
          ? modelRaw
          : undefined,
      ...page(req),
    });
    res.json({ sessions: rows.map(toAdminSessionItem), total });
  });

  router.get("/sessions/:id", guard("sessions:view"), async (req: Request, res: Response) => {
    const id = uuidParam(req.params.id);
    if (!id) {
      sendError(res, 404, "session_not_found", "No such session.");
      return;
    }
    const session = await sessions.getById(id);
    if (!session) {
      sendError(res, 404, "session_not_found", "No such session.");
      return;
    }
    const [evidence, obs, hyps, ts, rs, evts, cites, safety, modelRuns] = await Promise.all([
      files.listBySession(session.id),
      observations.listBySession(session.id),
      hypotheses.listBySession(session.id),
      tests.listBySession(session.id),
      results.listBySession(session.id),
      events.listBySession(session.id),
      citations.listSessionResolved(session.id),
      safetyEvents.listBySession(session.id),
      runs.listBySession(session.id),
    ]);
    const byTest = new Map(rs.map((r) => [r.test_id, r]));
    await log(req, "session.inspect", { targetType: "session", targetId: id });
    res.json(
      toSessionDetailResponse(session, evidence, obs, {
        hypotheses: hyps,
        tests: ts.map((test) => ({ test, result: byTest.get(test.id) ?? null })),
        events: evts,
        citations: cites,
        safetyEvents: safety,
        modelRuns,
      }),
    );
  });

  /* Reports */

  router.get("/reports", guard("sessions:view"), async (req: Request, res: Response) => {
    const verifiedRaw = str(req.query.verified);
    const { rows, total } = await admin.listReports({
      device: str(req.query.device),
      status: str(req.query.status),
      user: str(req.query.user),
      from: str(req.query.from),
      to: str(req.query.to),
      verified: verifiedRaw === "yes" || verifiedRaw === "no" ? verifiedRaw : undefined,
      ...page(req),
    });
    res.json({ reports: rows.map(toAdminReportItem), total });
  });

  router.get("/reports/:id", guard("sessions:view"), async (req: Request, res: Response) => {
    const id = uuidParam(req.params.id);
    if (!id) {
      sendError(res, 404, "not_found", "Unknown report.");
      return;
    }
    const report = await reports.getById(id);
    if (!report) {
      sendError(res, 404, "not_found", "Unknown report.");
      return;
    }
    await log(req, "report.inspect", { targetType: "report", targetId: id });
    res.json({ report: toReportResponse(report) });
  });

  router.get("/reports/:id/pdf", guard("sessions:view"), async (req: Request, res: Response) => {
    const id = uuidParam(req.params.id);
    if (!id) {
      sendError(res, 404, "not_found", "Unknown report.");
      return;
    }
    const report = await reports.getById(id);
    if (!report) {
      sendError(res, 404, "not_found", "Unknown report.");
      return;
    }
    try {
      const pdf = await renderReportPdf(toReportResponse(report));
      await log(req, "report.pdf", { targetType: "report", targetId: id });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="fieldfix-report-${report.session_id}.pdf"`,
      );
      res.send(pdf);
    } catch {
      sendError(res, 500, "report_failed", "Report PDF could not be rendered.");
    }
  });

  /* Evidence (permission-controlled, audited previews; no bulk export). */

  router.get("/evidence", guard("evidence:view"), async (req: Request, res: Response) => {
    const { rows, total } = await admin.listEvidence({
      device: str(req.query.device),
      media: str(req.query.media),
      processing: str(req.query.processing),
      ...page(req),
    });
    res.json({ evidence: rows.map(toAdminEvidenceItem), total });
  });

  router.get(
    "/evidence/:fileId/download",
    guard("evidence:view"),
    async (req: Request, res: Response) => {
      const fileId = uuidParam(req.params.fileId);
      if (!fileId) {
        sendError(res, 404, "file_not_found", "No such evidence file.");
        return;
      }
      const file = await files.getById(fileId);
      if (!file) {
        sendError(res, 404, "file_not_found", "No such evidence file.");
        return;
      }
      let data: Buffer;
      try {
        data = await storage.get(file.storage_key);
      } catch (err) {
        if (err instanceof StorageNotFoundError) {
          sendError(res, 500, "storage_inconsistent", "Stored bytes are missing for this file.");
          return;
        }
        // Unexpected failures must fail the request, never escape as
        // unhandled rejections that crash the API process.
        sendError(res, 500, "internal_error", "Unexpected server error.");
        return;
      }
      await log(req, "evidence.access", {
        targetType: "evidence",
        targetId: fileId,
        metadata: { session_id: file.session_id },
      });
      res.setHeader("Content-Type", file.media_type);
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Cache-Control", "private, no-store");
      res.send(data);
    },
  );

  /* AI usage + providers */

  router.get("/model-runs", guard("ai:view"), async (req: Request, res: Response) => {
    const { rows, total } = await admin.listModelRuns({
      provider: str(req.query.provider),
      model: str(req.query.model),
      status: str(req.query.status),
      sessionId: str(req.query.session),
      from: str(req.query.from),
      to: str(req.query.to),
      ...page(req),
    });
    res.json({ runs: rows.map(toAdminModelRun), total });
  });

  /** Known providers: reasoning (meta) + segmentation (meta-sam) + voice STT (meta-voice). */
  const providerCatalog = () => [
    { id: "meta", display_name: "Meta Reasoning (Muse Spark)", model_id: deps.metaConfig.modelId },
    { id: "meta-sam", display_name: "Meta Segmentation (SAM)", model_id: deps.samModelId },
    { id: "meta-voice", display_name: "Meta Voice Transcription", model_id: deps.env.VOICE_MODEL_ID },
  ];

  const providerKillSwitch: Record<string, string> = {
    meta: "ai.meta.enabled",
    "meta-sam": "ai.sam.enabled",
    "meta-voice": "ai.voice.enabled",
  };

  router.get("/providers", guard("ai:view"), async (_req: Request, res: Response) => {
    const all = await settings.getAll();
    const providers = [];
    for (const entry of providerCatalog()) {
      const key = providerKillSwitch[entry.id] ?? "ai.meta.enabled";
      const stats = await admin.providerStats(entry.id);
      providers.push({
        id: entry.id,
        display_name: entry.display_name,
        enabled: (all[key] as boolean | undefined) ?? true,
        configured: (deps.metaConfig.apiKey?.length ?? 0) > 0,
        model_id: entry.model_id,
        runs_24h: stats.runs_24h,
        succeeded_24h: stats.succeeded_24h,
        failed_24h: stats.failed_24h,
        avg_latency_ms: stats.avg_latency_ms,
        last_run_at:
          stats.last_run_at == null
            ? null
            : (stats.last_run_at as unknown as Date).toISOString(),
        last_status: stats.last_status,
      });
    }
    res.json({ providers });
  });

  router.post(
    "/providers/:id/test",
    guard("ai:manage"),
    async (req: Request, res: Response) => {
      const id = req.params.id ?? "";
      // Voice has no cheap ping: a live test would bill audio minutes,
      // so the endpoint reports config presence honestly instead of
      // faking connectivity.
      if (id === "meta-voice") {
        const configured = (deps.metaConfig.apiKey?.length ?? 0) > 0;
        await log(req, "provider.test", {
          targetType: "provider",
          targetId: id,
          outcome: configured ? "success" : "failed",
          metadata: { mode: "config-presence" },
        });
        res.json({
          ok: configured,
          latency_ms: null,
          detail: configured
            ? `Voice STT configured (model ${deps.env.VOICE_MODEL_ID}). No live audio call was made.`
            : "Voice STT is not configured (META_API_KEY missing).",
        });
        return;
      }
      if (id !== "meta") {
        sendError(res, 404, "not_found", "Unknown provider.");
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const started = Date.now();
        const result = await deps.metaProvider.ping(controller.signal);
        await log(req, "provider.test", { targetType: "provider", targetId: id });
        res.json({
          ok: true,
          latency_ms: Date.now() - started,
          detail:
            `Connected (model ${result.model}).` +
            (result.truncated
              ? " Ping reply was cut off by its token budget; connectivity is fine."
              : ""),
        });
      } catch (err) {
        const detail =
          err instanceof ModelError
            ? `${err.category}: ${err.message}`
            : "Connection test failed.";
        await log(req, "provider.test", {
          targetType: "provider",
          targetId: id,
          outcome: "failed",
          metadata: { detail: detail.slice(0, 300) },
        });
        res.json({ ok: false, latency_ms: null, detail });
      } finally {
        clearTimeout(timer);
      }
    },
  );

  router.patch("/providers/:id", guard("ai:manage"), async (req: Request, res: Response) => {
    const id = req.params.id ?? "";
    const parsed = updateProviderSchema.safeParse(req.body);
    const key = providerKillSwitch[id];
    if (!parsed.success || !key) {
      sendError(res, 400, "invalid_request", "Known provider id and { enabled } are required.");
      return;
    }
    const actor = adminOf(req);
    await settings.set(key, parsed.data.enabled, actor.actorId ?? actor.actorType);
    await log(req, "provider.toggle", {
      targetType: "provider",
      targetId: id,
      metadata: { enabled: parsed.data.enabled },
    });
    res.json({ id, enabled: parsed.data.enabled });
  });

  /* Documents: permission changes (ingest/upload/list stay in admin.ts). */

  router.patch("/documents/:id", guard("documents:manage"), async (req: Request, res: Response) => {
    const id = uuidParam(req.params.id);
    const parsed = updateDocumentPermissionSchema.safeParse(req.body);
    if (!id || !parsed.success) {
      sendError(res, 400, "invalid_request", "Valid document id and permission_status are required.");
      return;
    }
    const updated = await documents.updateIngestion(id, {
      ingestion_status: (await documents.getById(id))?.ingestion_status ?? "pending",
      permission_status: parsed.data.permission_status,
    });
    if (!updated) {
      sendError(res, 404, "not_found", "Unknown document.");
      return;
    }
    await log(req, "document.permission", {
      targetType: "document",
      targetId: id,
      metadata: { permission_status: parsed.data.permission_status },
    });
    res.json({ ok: true });
  });

  router.get("/ingestion-jobs", guard("documents:view"), async (req: Request, res: Response) => {
    const { rows, total } = await admin.listIngestionJobs({
      status: str(req.query.status),
      ...page(req),
    });
    res.json({
      jobs: rows.map((r) => ({ ...toIngestionJobResponse(r), document_title: r.document_title })),
      total,
    });
  });

  /* Safety incidents */

  router.get("/safety-events", guard("safety:view"), async (req: Request, res: Response) => {
    const reviewedRaw = str(req.query.reviewed);
    const { rows, total } = await admin.listSafetyEvents({
      state: str(req.query.state),
      trigger: str(req.query.trigger),
      reviewed: reviewedRaw === "yes" || reviewedRaw === "no" ? reviewedRaw : undefined,
      from: str(req.query.from),
      to: str(req.query.to),
      ...page(req),
    });
    res.json({ events: rows.map(toAdminSafetyEvent), total });
  });

  router.post(
    "/safety-events/:id/review",
    guard("safety:manage"),
    async (req: Request, res: Response) => {
      const id = uuidParam(req.params.id);
      const parsed = reviewSafetyEventSchema.safeParse(req.body);
      if (!id || !parsed.success) {
        sendError(res, 400, "invalid_request", "Valid event id and a review note are required.");
        return;
      }
      const event = await safetyEvents.getById(id);
      if (!event) {
        sendError(res, 404, "not_found", "Unknown safety event.");
        return;
      }
      const actor = adminOf(req);
      await safetyEvents.upsertReview(
        id,
        actor.actorType === "user" ? actor.actorId : null,
        parsed.data.note,
      );
      await log(req, "safety.review", { targetType: "safety_event", targetId: id });
      res.json({ ok: true });
    },
  );

  /* Quality (measured indicators only — no invented accuracy). */

  router.get("/quality", guard("overview:view"), async (_req: Request, res: Response) => {
    res.json(await admin.quality());
  });

  /* Overview dashboard */

  router.get("/overview", guard("overview:view"), async (req: Request, res: Response) => {
    const daysRaw = Number.parseInt(String(str(req.query.days) ?? "30"), 10);
    const days = [1, 7, 30, 90].includes(daysRaw) ? daysRaw : 30;
    const stats = await admin.overview(days);
    const activity = await admin.activityFeed();
    const timeouts = stats.errorCats
      .filter((c) => c.category.includes("timeout"))
      .reduce((n, c) => n + c.count, 0);
    const rateLimited = stats.errorCats
      .filter((c) => c.category.includes("rate_limit"))
      .reduce((n, c) => n + c.count, 0);
    res.json({
      users: stats.userStats,
      sessions: {
        total: stats.sessionStats.total,
        active: stats.sessionStats.active,
        completed: stats.sessionStats.completed,
        by_device: stats.byDevice,
        by_day: stats.byDay,
        by_status: stats.byStatus,
      },
      reports: { total: stats.reportsTotal },
      safety: {
        total_events: stats.safetyStats.total,
        critical_stops: stats.safetyStats.critical,
        unreviewed: stats.safetyStats.unreviewed,
        recent: stats.recentSafety.map(toAdminSafetyEvent),
      },
      ai: {
        total_runs: stats.aiStats.total,
        succeeded: stats.aiStats.succeeded,
        failed: stats.aiStats.failed,
        avg_latency_ms: stats.aiStats.avg_latency_ms,
        timeouts_24h: timeouts,
        rate_limited_24h: rateLimited,
      },
      documents: stats.docStats,
      activity: activity.map((a) => ({
        ...a,
        created_at: (a.created_at as unknown as Date).toISOString(),
      })),
    });
  });

  /* Notifications (in-app records; no delivery channel is claimed). */

  router.get("/notifications", guard("notifications:view"), async (req: Request, res: Response) => {
    const { rows, total, unread } = await notifications.list({
      ...page(req),
      unreadOnly: str(req.query.unread) === "1",
    });
    res.json({ notifications: rows.map(toNotification), total, unread });
  });

  router.post(
    "/notifications",
    guard("notifications:manage"),
    async (req: Request, res: Response) => {
      const parsed = createAnnouncementSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", "Title and body are required.");
        return;
      }
      const created = await notifications.record({
        kind: "announcement",
        title: parsed.data.title,
        body: parsed.data.body,
        link: parsed.data.link ?? null,
      });
      await log(req, "notification.announce", {
        targetType: "notification",
        targetId: created.id,
      });
      res.status(201).json({ notification: toNotification(created) });
    },
  );

  router.post(
    "/notifications/:id/read",
    guard("notifications:view"),
    async (req: Request, res: Response) => {
      const id = uuidParam(req.params.id);
      if (!id) {
        sendError(res, 404, "not_found", "Unknown notification.");
        return;
      }
      const ok = await notifications.markRead(id);
      if (!ok) {
        sendError(res, 404, "not_found", "Unknown notification.");
        return;
      }
      res.json({ ok: true });
    },
  );

  router.post(
    "/notifications/read-all",
    guard("notifications:view"),
    async (_req: Request, res: Response) => {
      await notifications.markAllRead();
      res.json({ ok: true });
    },
  );

  /* System health (live checks, never hardcoded). */

  router.get("/health", guard("health:view"), async (_req: Request, res: Response) => {
    const checks: {
      service: string;
      status: "ok" | "degraded" | "down";
      latency_ms: number | null;
      detail: string;
      checked_at: string;
    }[] = [];
    const now = new Date().toISOString();
    // Database round-trip.
    try {
      const started = Date.now();
      await db.selectFrom("users").select((eb) => eb.fn.countAll<number>().as("count")).executeTakeFirst();
      checks.push({
        service: "PostgreSQL",
        status: "ok",
        latency_ms: Date.now() - started,
        detail: "Query round-trip succeeded.",
        checked_at: now,
      });
    } catch (err) {
      checks.push({
        service: "PostgreSQL",
        status: "down",
        latency_ms: null,
        detail: err instanceof Error ? err.message.slice(0, 200) : "Query failed.",
        checked_at: now,
      });
    }
    // Object storage round-trip (temp object, removed afterwards).
    try {
      const started = Date.now();
      const key = `health/${Date.now()}.txt`;
      await storage.put(key, Buffer.from("ok"), "text/plain");
      await storage.get(key);
      await storage.delete(key).catch(() => undefined);
      checks.push({
        service: "Object storage",
        status: "ok",
        latency_ms: Date.now() - started,
        detail: "Write/read/delete round-trip succeeded.",
        checked_at: now,
      });
    } catch (err) {
      checks.push({
        service: "Object storage",
        status: "down",
        latency_ms: null,
        detail: err instanceof Error ? err.message.slice(0, 200) : "Storage failed.",
        checked_at: now,
      });
    }
    // Provider reachability derives from the last 24h of real runs.
    for (const entry of [
      { id: "meta", label: "Meta Reasoning API" },
      { id: "meta-sam", label: "Meta Segmentation API" },
    ]) {
      const stats = await admin.providerStats(entry.id);
      const configured = (deps.metaConfig.apiKey?.length ?? 0) > 0;
      checks.push({
        service: entry.label,
        status: !configured
          ? "degraded"
          : stats.failed_24h > 0 && stats.succeeded_24h === 0
            ? "down"
            : "ok",
        latency_ms: stats.avg_latency_ms,
        detail: !configured
          ? "No API key configured."
          : stats.runs_24h === 0
            ? "Configured; no runs in the last 24h."
            : `${stats.succeeded_24h}/${stats.runs_24h} succeeded in the last 24h.`,
        checked_at: now,
      });
    }
    // Knowledge retrieval: count searchable chunks.
    try {
      const row = await db
        .selectFrom("document_chunks")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirst();
      checks.push({
        service: "Knowledge retrieval",
        status: "ok",
        latency_ms: null,
        detail: `${Number(row?.count ?? 0)} chunks searchable.`,
        checked_at: now,
      });
    } catch (err) {
      checks.push({
        service: "Knowledge retrieval",
        status: "down",
        latency_ms: null,
        detail: err instanceof Error ? err.message.slice(0, 200) : "Check failed.",
        checked_at: now,
      });
    }
    // Ingestion: recent failures surface as degraded.
    try {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const failedRow = await db
        .selectFrom("ingestion_jobs")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("status", "=", "failed")
        .where(sql<boolean>`created_at >= ${dayAgo}`)
        .executeTakeFirst();
      const failed = Number(failedRow?.count ?? 0);
      checks.push({
        service: "Document ingestion",
        status: failed > 0 ? "degraded" : "ok",
        latency_ms: null,
        detail: failed > 0 ? `${failed} failed job(s) in the last 24h.` : "No failures in 24h.",
        checked_at: now,
      });
    } catch (err) {
      checks.push({
        service: "Document ingestion",
        status: "down",
        latency_ms: null,
        detail: err instanceof Error ? err.message.slice(0, 200) : "Check failed.",
        checked_at: now,
      });
    }
    res.json({ checks });
  });

  /* Audit logs (append-only; no edit/delete routes exist). */

  router.get("/audit-logs", guard("audit:view"), async (req: Request, res: Response) => {
    const outcomeRaw = str(req.query.outcome);
    const { rows, total } = await audit.list({
      ...page(req, 50),
      action: str(req.query.action),
      actorId: str(req.query.actor),
      outcome:
        outcomeRaw === "success" || outcomeRaw === "denied" || outcomeRaw === "failed"
          ? outcomeRaw
          : undefined,
    });
    res.json({ logs: rows.map(toAuditLog), total });
  });

  /* Platform settings (super-admin writes; secrets never included). */

  const readSettings = async () => {
    const all = await settings.getAll();
    return {
      platform_name: (all.platform_name as string | undefined) ?? "FieldFix AI",
      support_contact: (all.support_contact as string | undefined) ?? "support@fieldfix.ai",
      demo_enabled: (all.demo_enabled as boolean | undefined) ?? true,
      ai_meta_enabled: (all["ai.meta.enabled"] as boolean | undefined) ?? true,
      upload_limit_mb: env.MAX_UPLOAD_MB,
      session_ttl_days: 30,
      login_rate_limit: "60 requests / 15 min per IP",
    };
  };

  router.get("/settings", guard("settings:view"), async (_req: Request, res: Response) => {
    res.json(await readSettings());
  });

  router.patch("/settings", guard("settings:manage"), async (req: Request, res: Response) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "Valid settings fields are required.");
      return;
    }
    const actor = adminOf(req);
    const by = actor.actorId ?? actor.actorType;
    const data = parsed.data;
    if (data.platform_name !== undefined) {
      await settings.set("platform_name", data.platform_name, by);
    }
    if (data.support_contact !== undefined) {
      await settings.set("support_contact", data.support_contact, by);
    }
    if (data.demo_enabled !== undefined) {
      await settings.set("demo_enabled", data.demo_enabled, by);
    }
    if (data.ai_meta_enabled !== undefined) {
      await settings.set("ai.meta.enabled", data.ai_meta_enabled, by);
    }
    await log(req, "settings.update", {
      metadata: { keys: Object.keys(data) },
    });
    res.json(await readSettings());
  });

  return router;
}

/** Public platform metadata (no auth): branding + demo availability. */
export function createMetaRouter(deps: { db: Kysely<Database> }) {
  const router = express.Router();
  router.get("/meta", async (_req: Request, res: Response) => {
    const store = new SettingsRepository(deps.db);
    let all: Record<string, unknown> = {};
    try {
      all = await store.getAll();
    } catch {
      // Fall through to compiled-in defaults.
    }
    res.json({
      platform_name: (all.platform_name as string | undefined) ?? "FieldFix AI",
      support_contact: (all.support_contact as string | undefined) ?? "support@fieldfix.ai",
      demo_enabled: (all.demo_enabled as boolean | undefined) ?? true,
    });
  });
  return router;
}
