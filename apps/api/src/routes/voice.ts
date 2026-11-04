import type { Kysely } from "kysely";
import express, { type Request, type Response } from "express";
import multer, { MulterError } from "multer";
import { z } from "zod";
import {
  logVoiceInteractionSchema,
  speakRequestSchema,
  transcribeModeSchema,
  updateVoicePreferencesSchema,
} from "@fieldfix/contracts";
import {
  bearerToken,
  verifyToken,
} from "../auth/session-access.js";
import { requireUser, resolveUser, type UserRequest } from "../auth/user-access.js";
import type { Database, DiagnosticSession } from "../db/database.js";
import { AuditLogRepository } from "../db/repositories/audit.js";
import { SessionRepository } from "../db/repositories/sessions.js";
import { UsersRepository } from "../db/repositories/users.js";
import { VoicePreferencesRepository } from "../db/repositories/voice.js";
import { sendError } from "../http/errors.js";
import { PostgresRateLimitStore, rateLimit } from "../http/rate-limit.js";
import { ModelError } from "../models/types.js";
import { validateAudioUpload } from "../uploads/validate-file.js";
import { VoiceError, type VoiceService } from "../voice/service.js";
import {
  toDefaultVoicePreferencesResponse,
  toLogVoiceInteractionResponse,
  toSpeakPolicyResponse,
  toTranscribeResponse,
  toVoiceCapabilitiesResponse,
  toVoicePreferencesResponse,
} from "./serializers.js";

export interface VoiceRouterDeps {
  db: Kysely<Database>;
  service: VoiceService;
  /** Voice-only upload cap (VOICE_MAX_AUDIO_MB), independent of evidence uploads. */
  maxAudioBytes: number;
}

const uuidField = z.string().uuid();
const languageBiasField = z.string().trim().min(2).max(20);

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * Session ownership for voice routes, which carry the session id in
 * the body instead of a :id param (requireSessionAccess middleware
 * cannot apply). Accepts the session access token or the owning
 * user's login token; unknown ids 404, bad tokens 403, suspended
 * owners lock their sessions — same semantics as session routes.
 */
async function authorizeVoiceSession(
  db: Kysely<Database>,
  sessionId: string,
  req: Request,
  res: Response,
): Promise<{ session: DiagnosticSession; userId: string | null } | null> {
  const parsedId = uuidField.safeParse(sessionId);
  if (!parsedId.success) {
    sendError(res, 404, "session_not_found", "No such session.");
    return null;
  }
  const session = await new SessionRepository(db).getById(parsedId.data);
  if (!session) {
    sendError(res, 404, "session_not_found", "No such session.");
    return null;
  }
  if (session.user_id) {
    const ownerRow = await new UsersRepository(db).getById(session.user_id);
    if (ownerRow && ownerRow.status !== "active") {
      sendError(res, 403, "account_suspended", "This account is suspended or deactivated.");
      return null;
    }
  }
  const token = bearerToken(req);
  if (!token) {
    sendError(
      res,
      403,
      "forbidden",
      "Session access token required (Authorization: Bearer).",
    );
    return null;
  }
  if (session.user_id) {
    const owner = await resolveUser(db, req);
    if (owner && owner.id === session.user_id && owner.status === "active") {
      return { session, userId: owner.id };
    }
  }
  if (!verifyToken(token, session.access_token_hash)) {
    sendError(res, 403, "forbidden", "Invalid session access token.");
    return null;
  }
  return { session, userId: session.user_id };
}

/** Map provider failures to honest HTTP statuses (never 200, never leaked keys). */
function sendModelError(res: Response, err: ModelError): void {
  switch (err.category) {
    case "config":
      sendError(res, 501, "stt_not_configured", err.message);
      return;
    case "rate_limited": {
      if (err.retryAfterMs !== undefined) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil(err.retryAfterMs / 1000))));
      }
      sendError(res, 429, "rate_limited", err.message);
      return;
    }
    case "payload_too_large":
      sendError(res, 413, "file_too_large", err.message);
      return;
    case "invalid_request":
      sendError(res, 422, "unsupported_audio", err.message);
      return;
    case "timeout":
      sendError(res, 504, "provider_timeout", err.message);
      return;
    default:
      sendError(res, 502, "provider_error", err.message);
  }
}

export function createVoiceRouter(deps: VoiceRouterDeps) {
  const { db, service, maxAudioBytes } = deps;
  const router = express.Router();
  // Own budget (never shares the auth/login allowance): transcription
  // is billed per audio hour, so it gets the strict credential-style
  // window even though preferences/capabilities ride along.
  router.use(
    rateLimit({
      maxRequests: 60,
      windowMs: 15 * 60 * 1000,
      scope: "voice",
      store: new PostgresRateLimitStore(db),
    }),
  );
  const preferences = new VoicePreferencesRepository(db);
  const audit = new AuditLogRepository(db);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxAudioBytes, files: 1, fields: 8 },
  });

  router.post("/transcribe", (req: Request, res: Response) => {
    upload.single("audio")(req, res, (err: unknown) => {
      void handleTranscribe(req, res, err).catch(() => {
        if (!res.headersSent) {
          sendError(res, 500, "internal_error", "Unexpected server error.");
        }
      });
    });
  });

  async function handleTranscribe(req: Request, res: Response, err: unknown): Promise<void> {
    if (err instanceof MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        sendError(res, 413, "file_too_large", `Audio exceeds the ${maxAudioBytes} byte limit.`);
        return;
      }
      sendError(res, 400, "invalid_request", `Upload rejected: ${err.message}.`);
      return;
    }
    if (err) {
      throw err;
    }
    const rawSessionId = req.body?.session_id;
    if (typeof rawSessionId !== "string") {
      sendError(res, 400, "invalid_request", "session_id: Required.");
      return;
    }
    const authed = await authorizeVoiceSession(db, rawSessionId, req, res);
    if (!authed) {
      return;
    }
    const rawMode = req.body?.mode;
    let mode: z.infer<typeof transcribeModeSchema> | undefined;
    if (typeof rawMode === "string" && rawMode.length > 0) {
      const parsedMode = transcribeModeSchema.safeParse(rawMode);
      if (!parsedMode.success) {
        sendError(res, 400, "invalid_request", `mode: ${formatIssues(parsedMode.error)}`);
        return;
      }
      mode = parsedMode.data;
    }
    const rawBias = req.body?.languageBias;
    let languageBias: string | undefined;
    if (typeof rawBias === "string" && rawBias.length > 0) {
      const parsedBias = languageBiasField.safeParse(rawBias);
      if (!parsedBias.success) {
        sendError(res, 400, "invalid_request", `languageBias: ${formatIssues(parsedBias.error)}`);
        return;
      }
      languageBias = parsedBias.data;
    }
    const buffer = req.file?.buffer;
    const mediaType = req.file?.mimetype;
    const validation = validateAudioUpload({ buffer, mediaType, maxBytes: maxAudioBytes });
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
    try {
      const outcome = await service.transcribe({
        session: authed.session,
        userId: authed.userId,
        audio: buffer as Buffer,
        mediaType: mediaType as string,
        mode,
        languageBias,
      });
      res.status(201).json(
        toTranscribeResponse({
          transcript: outcome.result.transcript,
          audioDurationMs: outcome.result.audioDurationMs,
          turns: outcome.result.turns,
          provider: outcome.transcription.provider,
          modelId: outcome.transcription.model_id,
          transcriptionId: outcome.transcription.id,
          interactionId: outcome.interaction.id,
          modelRunId: outcome.modelRunId,
          safetyState: outcome.safetyState,
          warnings: outcome.warnings,
          blocked: outcome.blocked,
        }),
      );
    } catch (thrown) {
      if (thrown instanceof VoiceError && thrown.code === "voice_disabled") {
        sendError(res, 503, "voice_disabled", thrown.message);
        return;
      }
      if (thrown instanceof ModelError) {
        sendModelError(res, thrown);
        return;
      }
      throw thrown;
    }
  }

  router.get("/preferences", requireUser(db), async (req: Request, res: Response) => {
    const { user } = req as UserRequest;
    const row = await preferences.getByUserId(user.id);
    res.json(
      row ? toVoicePreferencesResponse(row) : toDefaultVoicePreferencesResponse(user.id),
    );
  });

  router.put("/preferences", requireUser(db), async (req: Request, res: Response) => {
    const { user } = req as UserRequest;
    const parsed = updateVoicePreferencesSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", formatIssues(parsed.error));
      return;
    }
    const row = await preferences.upsert(user.id, {
      spoken_responses: parsed.data.spoken_responses,
      voice_id: parsed.data.voice_id,
      rate: parsed.data.rate,
      language: parsed.data.language,
    });
    await audit.append(
      { actorType: "user", actorId: user.id, actorEmail: user.email },
      req,
      { action: "voice.preferences.update", targetType: "user", targetId: user.id },
    );
    res.json(toVoicePreferencesResponse(row));
  });

  router.post("/interactions/log", async (req: Request, res: Response) => {
    const parsed = logVoiceInteractionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", formatIssues(parsed.error));
      return;
    }
    const authed = await authorizeVoiceSession(db, parsed.data.session_id, req, res);
    if (!authed) {
      return;
    }
    const outcome = await service.logInteraction({
      session: authed.session,
      userId: authed.userId,
      role: parsed.data.role,
      text: parsed.data.text,
    });
    res.status(201).json(
      toLogVoiceInteractionResponse({
        interaction: outcome.interaction,
        safetyState: outcome.safetyState,
        warnings: outcome.warnings,
        blocked: outcome.blocked,
      }),
    );
  });

  router.get("/capabilities", requireUser(db), async (_req: Request, res: Response) => {
    const snapshot = await service.describeCapabilities();
    res.json(toVoiceCapabilitiesResponse(snapshot));
  });

  router.post("/speak", async (req: Request, res: Response) => {
    const parsed = speakRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", formatIssues(parsed.error));
      return;
    }
    let session: DiagnosticSession | undefined;
    let userId: string | null = null;
    if (parsed.data.session_id) {
      const authed = await authorizeVoiceSession(db, parsed.data.session_id, req, res);
      if (!authed) {
        return;
      }
      session = authed.session;
      userId = authed.userId;
    } else {
      const user = await resolveUser(db, req).catch(() => null);
      if (!user) {
        sendError(res, 401, "unauthorized", "Sign in to access this resource.");
        return;
      }
      if (user.status !== "active") {
        sendError(res, 403, "account_suspended", "This account is suspended or deactivated.");
        return;
      }
      userId = user.id;
    }
    const outcome = await service.speak({
      text: parsed.data.text,
      session,
      userId,
      voiceId: parsed.data.voice_id,
      rate: parsed.data.rate,
      language: parsed.data.language,
    });
    res.json(
      toSpeakPolicyResponse({
        text: outcome.policy.text,
        ssml: outcome.policy.ssml,
        language: outcome.policy.language,
        rate: outcome.policy.rate,
        voiceId: outcome.policy.voiceId,
        substituted: outcome.substituted,
        safetyState: outcome.safetyState,
        warnings: outcome.warnings,
      }),
    );
  });

  return router;
}
