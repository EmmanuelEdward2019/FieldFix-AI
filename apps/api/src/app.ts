import cors from "cors";
import express, {
  type Application,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import type { Kysely } from "kysely";
import { apiErrorSchema } from "@fieldfix/contracts";
import type { AppEnv } from "./env.js";
import { createHealthRouter } from "./routes/health.js";
import { createAuthRouter } from "./routes/auth.js";
import { createConsoleRouter, createMetaRouter } from "./routes/console.js";
import { createUsersRouter } from "./routes/users.js";
import { createSessionsRouter } from "./routes/sessions.js";
import { createAdminRouter } from "./routes/admin.js";
import { createKnowledgeRouter } from "./routes/knowledge.js";
import { createDiagnosticsRouter } from "./routes/diagnostics.js";
import { createPartsRouter } from "./routes/parts.js";
import { createSegmentationsRouter } from "./routes/segmentations.js";
import { createShopRouter } from "./routes/shop.js";
import { createSuppliersAdminRouter } from "./routes/suppliers-admin.js";
import { createTechniciansRouter } from "./routes/technicians.js";
import { createVoiceRouter } from "./routes/voice.js";
import type { Database } from "./db/database.js";
import { sendError } from "./http/errors.js";
import { PostgresRateLimitStore, rateLimit } from "./http/rate-limit.js";
import { hardenApp } from "./http/async-net.js";
import { lastResortErrorHandler } from "./http/error-middleware.js";
import type { StorageAdapter } from "./storage/types.js";
import { DiagnosticEngineService } from "./diagnostics/engine.js";
import { DiagnosticReasoningService } from "./models/diagnostic-reasoning.js";
import { MetaModelAdapter } from "./models/meta/client.js";
import { loadMetaConfig } from "./models/meta/config.js";
import { SamSegmentationAdapter } from "./models/meta/sam.js";
import { MetaVoiceTranscribeAdapter } from "./models/meta/voice.js";
import type { TranscriptionProvider } from "./models/types.js";
import {
  BrowserSpeechSynthesisProvider,
  UnconfiguredTranscriptionProvider,
} from "./voice/providers.js";
import { VoiceService } from "./voice/service.js";
import { ModelProviderRegistry } from "./models/registry.js";
import { SafetyController } from "./safety/controller.js";
import { SafetyScreeningService } from "./safety/screening.js";
import { SegmentationService } from "./vision/service.js";
import { IdentificationService } from "./vision/identification.js";

export interface AppDeps {
  db?: Kysely<Database>;
  storage?: StorageAdapter;
  /** Injected in tests; otherwise built from env (Meta provider). */
  engine?: DiagnosticEngineService;
  safety?: SafetyController;
  screening?: SafetyScreeningService;
  segmentation?: SegmentationService;
  identification?: IdentificationService;
  /** Injected in tests; otherwise built from env (Meta voice or stub). */
  transcriptionProvider?: TranscriptionProvider;
}

export function createApp(env: AppEnv, deps: AppDeps = {}): Application {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: "1mb" }));
  // Shared counters when a database is wired; process-local otherwise.
  app.use(
    "/api",
    rateLimit({ store: deps.db ? new PostgresRateLimitStore(deps.db) : undefined }),
  );

  app.use(
    "/health",
    createHealthRouter({ service: "fieldfix-api", version: env.API_VERSION }),
  );

  if (deps.db && deps.storage) {
    const maxUploadBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    const metaConfig = loadMetaConfig(env);
    const metaProvider = new MetaModelAdapter(metaConfig);
    const providers = new ModelProviderRegistry();
    providers.register(metaProvider, { isDefault: true });
    const reasoning = new DiagnosticReasoningService({
      db: deps.db,
      storage: deps.storage,
      providers,
      defaultProviderId: "meta",
      meta: metaConfig,
    });
    const safety = deps.safety ?? new SafetyController(deps.db);
    const screening = deps.screening ?? new SafetyScreeningService({ provider: metaProvider });
    const engine = deps.engine ??
      new DiagnosticEngineService({ db: deps.db, reasoning, safety });
    const segmentation = deps.segmentation ??
      new SegmentationService({
        db: deps.db,
        storage: deps.storage,
        provider: new SamSegmentationAdapter({
          apiKey: metaConfig.apiKey,
          baseUrl: metaConfig.baseUrl,
          modelId: env.SAM_MODEL_ID,
          timeoutMs: metaConfig.timeoutMs,
          maxRetries: metaConfig.maxRetries,
          maxImageBytes: metaConfig.maxImageBytes,
        }),
        modelId: env.SAM_MODEL_ID,
      });
    app.use(
      "/api/v1/sessions",
      createSessionsRouter({
        db: deps.db,
        storage: deps.storage,
        maxUploadBytes,
        safety,
        screening,
      }),
    );
    app.use("/api/v1/sessions", createDiagnosticsRouter({ db: deps.db, engine, env }));
    app.use("/api/v1/sessions", createPartsRouter({ db: deps.db }));
    const identification = deps.identification ??
      new IdentificationService({
        db: deps.db,
        storage: deps.storage,
        vision: metaProvider,
        modelId: metaConfig.modelId,
        segmentation,
      });
    app.use(
      "/api/v1/sessions",
      createSegmentationsRouter({ db: deps.db, service: segmentation, identification }),
    );
    const voiceMaxAudioBytes = env.VOICE_MAX_AUDIO_MB * 1024 * 1024;
    const transcription =
      deps.transcriptionProvider ??
      (metaConfig.apiKey
        ? new MetaVoiceTranscribeAdapter({
            apiKey: metaConfig.apiKey,
            baseUrl: metaConfig.baseUrl,
            modelId: env.VOICE_MODEL_ID,
            timeoutMs: metaConfig.timeoutMs,
            maxRetries: metaConfig.maxRetries,
          })
        : new UnconfiguredTranscriptionProvider());
    const voiceService = new VoiceService({
      db: deps.db,
      stt: transcription,
      tts: new BrowserSpeechSynthesisProvider(),
      voiceModelId: env.VOICE_MODEL_ID,
      maxAudioMb: env.VOICE_MAX_AUDIO_MB,
      maxAudioBytes: voiceMaxAudioBytes,
      safety,
      screening,
    });
    app.use(
      "/api/v1/voice",
      createVoiceRouter({ db: deps.db, service: voiceService, maxAudioBytes: voiceMaxAudioBytes }),
    );
    app.use("/api/v1/auth", createAuthRouter({ db: deps.db, env }));
    app.use("/api/v1/users", createUsersRouter({ db: deps.db }));
    app.use("/api/v1/technicians", createTechniciansRouter({ db: deps.db }));
    app.use("/api/v1/shops", createShopRouter({ db: deps.db }));
    app.use(
      "/api/v1/admin",
      createAdminRouter({
        db: deps.db,
        storage: deps.storage,
        maxUploadBytes,
        ifixitBaseUrl: env.IFIXIT_API_BASE_URL,
      }),
    );
    app.use(
      "/api/v1/admin",
      createConsoleRouter({
        db: deps.db,
        storage: deps.storage,
        env,
        metaProvider,
        metaConfig,
        samModelId: env.SAM_MODEL_ID,
      }),
    );
    app.use("/api/v1/admin", createSuppliersAdminRouter({ db: deps.db }));
    app.use("/api/v1", createMetaRouter({ db: deps.db }));
    app.use("/api/v1/knowledge", createKnowledgeRouter({ db: deps.db }));
  } else {
    // The server stays up without a database; data routes report 503.
    const unavailable = (_req: Request, res: Response) => {
      sendError(
        res,
        503,
        "database_unavailable",
        "The database is not configured (DATABASE_URL).",
      );
    };
    app.use("/api/v1/sessions", unavailable);
    app.use("/api/v1/admin", unavailable);
    app.use("/api/v1/knowledge", unavailable);
    app.use("/api/v1/auth", unavailable);
    app.use("/api/v1/users", unavailable);
    app.use("/api/v1/technicians", unavailable);
    app.use("/api/v1/shops", unavailable);
    app.use("/api/v1/voice", unavailable);
  }

  // Unknown routes -> standard error envelope.
  app.use((_req: Request, res: Response) => {
    res
      .status(404)
      .json(
        apiErrorSchema.parse({
          error: { code: "not_found", message: "No such route." },
        }),
      );
  });

  // Last-resort error handler. Never leaks stack traces to clients.
  // Body-parser failures get honest statuses instead of a 500.
  app.use(lastResortErrorHandler);

  // Centralized async safety net: every async handler and middleware mounted
  // above now forwards rejections to the handler above instead of crashing.
  hardenApp(app);

  return app;
}
