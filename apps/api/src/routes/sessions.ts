import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { Kysely } from "kysely";
import express, { type Request, type Response } from "express";
import multer, { MulterError } from "multer";
import { z } from "zod";
import { createSessionSchema, safetyTransitionSchema } from "@fieldfix/contracts";
import { issueSessionToken, requireSessionAccess, type SessionRequest } from "../auth/session-access.js";
import { resolveUser } from "../auth/user-access.js";
import type { Database } from "../db/database.js";
import { SessionRepository } from "../db/repositories/sessions.js";
import {
  EvidenceFileRepository,
  ObservationRepository,
} from "../db/repositories/evidence.js";
import { HypothesisRepository } from "../db/repositories/hypotheses.js";
import {
  DiagnosticTestRepository,
  TestResultRepository,
} from "../db/repositories/tests.js";
import { EventRepository } from "../db/repositories/events.js";
import { ModelRunRepository } from "../db/repositories/model-runs.js";
import { SafetyEventRepository } from "../db/repositories/safety.js";
import { CitationService } from "../knowledge/citations.js";
import { sendError } from "../http/errors.js";
import { SafetyController, SafetyError } from "../safety/controller.js";
import type { SafetyScreeningService } from "../safety/screening.js";
import { screenUserText as screenUserTextShared } from "../safety/screen-user-text.js";
import { StorageNotFoundError, type StorageAdapter } from "../storage/types.js";
import { validateUpload } from "../uploads/validate-file.js";
import {
  toCreateSessionResponse,
  toEvidenceFileResponse,
  toListEvidenceResponse,
  toSafetyEventResponse,
  toSessionDetailResponse,
  toSessionResponse,
  toUploadEvidenceResponse,
} from "./serializers.js";

export interface SessionsRouterDeps {
  db: Kysely<Database>;
  storage: StorageAdapter;
  maxUploadBytes: number;
  safety: SafetyController;
  /** Advisory model screening; deterministic policy applies regardless. */
  screening?: SafetyScreeningService;
}

const observationField = z.string().min(1).max(8000);

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** Sanitize a client filename for use inside a storage key. */
export function safeStorageName(original: string | undefined): string {
  const base = path.basename(original ?? "").replace(/[^a-zA-Z0-9._-]+/g, "_");
  const trimmed = base.replace(/^_+|_+$/g, "").slice(0, 100);
  return trimmed.length > 0 ? trimmed : "upload";
}

export function createSessionsRouter(deps: SessionsRouterDeps) {
  const { db, storage, maxUploadBytes, safety, screening } = deps;
  const router = express.Router();
  const sessions = new SessionRepository(db);
  const files = new EvidenceFileRepository(db);
  const observations = new ObservationRepository(db);
  const safetyEvents = new SafetyEventRepository(db);
  const hypotheses = new HypothesisRepository(db);
  const tests = new DiagnosticTestRepository(db);
  const results = new TestResultRepository(db);
  const events = new EventRepository(db);
  const runs = new ModelRunRepository(db);
  const citations = new CitationService(db);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadBytes, files: 1, fields: 8 },
  });

  /**
   * Deterministic screen first; advisory model screen only when the
   * deterministic policy is silent. Returns the current session row.
   */
  async function screenUserText(
    sessionId: string,
    text: string,
    options: { deviceType?: string; evidenceFileId?: string | null } = {},
  ) {
    const outcome = await screenUserTextShared(safety, screening, sessionId, text, options);
    return outcome.session;
  }

  router.post("/", async (req: Request, res: Response) => {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", formatIssues(parsed.error));
      return;
    }
    const { token, hash } = issueSessionToken();
    // Signed-in creators own the session; anonymous (demo) creation
    // stays token-only.
    const owner = await resolveUser(db, req).catch(() => null);
    const created = await sessions.create({
      ...parsed.data,
      access_token_hash: hash,
      user_id: owner?.id ?? null,
    });
    await events.append(created.id, {
      event_type: "session_created",
      payload: {
        device_type: parsed.data.device_type,
        user_mode: parsed.data.user_mode,
      },
    });
    // Hazardous sessions are still created (the user needs the warning
    // and the report) but start stopped, never diagnosing.
    const intake = [
      parsed.data.symptoms,
      parsed.data.recent_events ?? "",
      parsed.data.problem_started_note ?? "",
    ]
      .filter((part) => part.trim().length > 0)
      .join("\n");
    const session = await screenUserText(created.id, intake, {
      deviceType: parsed.data.device_type,
    });
    res.status(201).json(toCreateSessionResponse(session, token));
  });

  router.get("/:id", requireSessionAccess(db), async (req: Request, res: Response) => {
    const { session } = req as SessionRequest;
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

  router.get("/:id/evidence", requireSessionAccess(db), async (req: Request, res: Response) => {
    const { session } = req as SessionRequest;
    res.json(toListEvidenceResponse(await files.listBySession(session.id)));
  });

  router.post("/:id/evidence", requireSessionAccess(db), (req: Request, res: Response) => {
    upload.single("file")(req, res, (err: unknown) => {
      void handleUpload(req, res, err).catch(() => {
        if (!res.headersSent) {
          sendError(res, 500, "internal_error", "Unexpected server error.");
        }
      });
    });
  });

  async function handleUpload(req: Request, res: Response, err: unknown): Promise<void> {
    if (err instanceof MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        sendError(res, 413, "file_too_large", `File exceeds the ${maxUploadBytes} byte limit.`);
        return;
      }
      sendError(res, 400, "invalid_request", `Upload rejected: ${err.message}.`);
      return;
    }
    if (err) {
      throw err;
    }
    const { session } = req as SessionRequest;
    const buffer = req.file?.buffer;
    const mediaType = req.file?.mimetype;
    const validation = validateUpload({ buffer, mediaType, maxBytes: maxUploadBytes });
    if (!validation.ok) {
      const status =
        validation.code === "file_too_large"
          ? 413
          : validation.code === "unsupported_media_type" ||
              validation.code === "file_content_mismatch"
            ? 415
            : 400;
      sendError(res, status, validation.code, validation.message);
      return;
    }
    const data = buffer as Buffer;
    const observationRaw = req.body?.observation;
    let observationBody: string | null = null;
    if (typeof observationRaw === "string" && observationRaw.trim().length > 0) {
      const parsedObs = observationField.safeParse(observationRaw.trim());
      if (!parsedObs.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsedObs.error));
        return;
      }
      observationBody = parsedObs.data;
    }

    const fileId = randomUUID();
    const checksum = createHash("sha256").update(data).digest("hex");
    const key = `evidence/${session.id}/${fileId}/${safeStorageName(req.file?.originalname)}`;
    try {
      await storage.put(key, data, mediaType as string);
    } catch {
      sendError(res, 500, "storage_error", "Could not store the uploaded file.");
      return;
    }

    let file;
    try {
      file = await files.create(session.id, {
        storage_key: key,
        media_type: mediaType as string,
        byte_size: data.length,
        original_filename: req.file?.originalname?.slice(0, 255) ?? null,
        kind: validation.kind,
        checksum_sha256: checksum,
      });
      await files.setProcessing(file.id, "ready");
      file = (await files.getById(file.id)) ?? file;
    } catch (dbErr) {
      await storage.delete(key).catch(() => undefined);
      throw dbErr;
    }

    let observation = null;
    if (observationBody) {
      observation = await observations.create(session.id, {
        evidence_file_id: file.id,
        source: "user",
        body: observationBody,
      });
      // Evidence intake stays open during a stop (documenting the
      // hazard matters), but a hazardous note escalates immediately.
      await screenUserText(session.id, observationBody, {
        deviceType: session.device_type,
        evidenceFileId: file.id,
      });
    }
    await events.append(session.id, {
      event_type: "evidence_uploaded",
      payload: {
        file_id: file.id,
        kind: validation.kind,
        media_type: mediaType,
        byte_size: data.length,
      },
    });
    res.status(201).json(toUploadEvidenceResponse(file, observation));
  }

  router.get(
    "/:id/evidence/:fileId/download",
    requireSessionAccess(db),
    async (req: Request, res: Response) => {
      const { session } = req as SessionRequest;
      const parsedFileId = z.string().uuid().safeParse(req.params.fileId);
      if (!parsedFileId.success) {
        sendError(res, 404, "file_not_found", "No such evidence file.");
        return;
      }
      const file = await files.getById(parsedFileId.data);
      if (!file || file.session_id !== session.id) {
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
      const record = toEvidenceFileResponse(file);
      res.setHeader("Content-Type", record.media_type);
      res.setHeader("Content-Length", String(data.length));
      res.setHeader("Cache-Control", "private, max-age=3600");
      const name = record.original_filename ?? "evidence";
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${name.replace(/["\\]/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      );
      res.send(data);
    },
  );

  router.post(
    "/:id/safety/transition",
    requireSessionAccess(db),
    async (req: Request, res: Response) => {
      const parsed = safetyTransitionSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { session } = req as SessionRequest;
      try {
        const { session: updated, safetyEvent } = await safety.requestTransition(
          session.id,
          parsed.data.to_state,
          parsed.data.rationale,
          session.user_mode,
        );
        res.json({
          session: toSessionResponse(updated),
          safety_event: toSafetyEventResponse(safetyEvent),
        });
      } catch (err) {
        if (err instanceof SafetyError) {
          const status = err.code === "not_technician"
            ? 403
            : err.code === "session_not_found"
              ? 404
              : 422;
          sendError(res, status, err.code, err.message);
          return;
        }
        // Unexpected failures must fail the request, never escape as
        // unhandled rejections that crash the API process.
        sendError(res, 500, "internal_error", "Unexpected server error.");
      }
    },
  );

  router.get(
    "/:id/safety/events",
    requireSessionAccess(db),
    async (req: Request, res: Response) => {
      const { session } = req as SessionRequest;
      res.json({
        events: (await safetyEvents.listBySession(session.id)).map(toSafetyEventResponse),
      });
    },
  );

  return router;
}
