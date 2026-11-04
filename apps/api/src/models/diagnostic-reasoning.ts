import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type {
  DiagnosticAssessment,
  DiagnosticStage,
  DeviceCategory,
  ReasoningContext,
} from "@fieldfix/contracts";
import type { Database, ModelRun } from "../db/database.js";
import { SessionRepository } from "../db/repositories/sessions.js";
import { SettingsRepository } from "../db/repositories/settings.js";
import {
  EvidenceFileRepository,
  ObservationRepository,
} from "../db/repositories/evidence.js";
import { HypothesisRepository } from "../db/repositories/hypotheses.js";
import {
  DiagnosticTestRepository,
  TestResultRepository,
} from "../db/repositories/tests.js";
import { SafetyEventRepository } from "../db/repositories/safety.js";
import { ModelRunRepository } from "../db/repositories/model-runs.js";
import type { StorageAdapter } from "../storage/types.js";
import type { MetaAdapterConfig } from "./meta/config.js";
import { ModelRequestBuilder } from "./meta/request-builder.js";
import { ModelResponseValidator } from "./meta/response-validator.js";
import type { ModelProviderRegistry } from "./registry.js";
import { ModelError } from "./types.js";

export interface DocExcerptInput {
  document_id: string;
  title: string;
  page?: number | null;
  excerpt: string;
}

export interface AssessOptions {
  stage: DiagnosticStage;
  question: string;
  /** Caller-supplied excerpts (retrieval is a later phase). Untrusted. */
  docExcerpts?: DocExcerptInput[];
  /** Override when the session predates desktop support. */
  deviceCategory?: DeviceCategory;
  providerId?: string;
  signal?: AbortSignal;
}

export type ReasoningOutcome =
  | { ok: true; assessment: DiagnosticAssessment; run: ModelRun; warnings: string[] }
  | { ok: false; error: { category: string; message: string }; run: ModelRun | null };

export interface ReasoningServiceDeps {
  db: Kysely<Database>;
  storage: StorageAdapter;
  providers: ModelProviderRegistry;
  defaultProviderId: string;
  meta: MetaAdapterConfig;
}

/**
 * Orchestrates one reasoning call: rebuilds full context from current DB
 * state, calls the model, validates, and persists run metadata. History
 * is append-only — stored hypotheses are never overwritten, and an
 * assessment is returned, not auto-applied.
 */
export class DiagnosticReasoningService {
  private readonly builder: ModelRequestBuilder;
  private readonly validator = new ModelResponseValidator();

  constructor(private readonly deps: ReasoningServiceDeps) {
    this.builder = new ModelRequestBuilder({
      maxImages: deps.meta.maxImagesPerRequest,
      maxImageBytes: deps.meta.maxImageBytes,
      maxExcerptChars: 4000,
      maxTotalTextChars: 60_000,
    });
  }

  async assess(sessionId: string, options: AssessOptions): Promise<ReasoningOutcome> {
    const { db } = this.deps;
    const sessions = new SessionRepository(db);
    const session = await sessions.getById(sessionId);
    if (!session) {
      return {
        ok: false,
        error: { category: "not_found", message: "Unknown session." },
        run: null,
      };
    }
    // Admin kill-switch: refuse before spending a provider call.
    const enabled = await new SettingsRepository(db).get("ai.meta.enabled").catch(() => true);
    if (enabled === false) {
      return {
        ok: false,
        error: {
          category: "config",
          message: "The Meta reasoning provider is disabled by the administrator.",
        },
        run: null,
      };
    }

    let provider;
    try {
      provider = this.deps.providers.get(
        options.providerId ?? this.deps.defaultProviderId,
      );
    } catch (err) {
      return {
        ok: false,
        error: {
          category: "config",
          message: err instanceof Error ? err.message : "Unknown provider.",
        },
        run: null,
      };
    }

    const context = await this.buildContext(sessionId, session.device_type, options);
    const evidence = await this.loadEvidence(sessionId);

    const runs = new ModelRunRepository(db);
    const traceId = randomUUID();
    const run = await runs.create({
      session_id: sessionId,
      provider: provider.id,
      model_id: this.deps.meta.modelId,
      task_type: "diagnosis",
      origin: "live",
      request_id: traceId,
    });

    try {
      const built = this.builder.build(
        { context, evidence },
        {
          effort: this.deps.meta.reasoningEffort,
          maxOutputTokens: this.deps.meta.maxOutputTokens,
        },
      );
      const started = Date.now();
      const result = await provider.complete(built.prompt, {
        signal: options.signal,
      });
      const validated = this.validator.validate(result.text, {
        allowedDocumentIds: new Set(
          built.context.doc_excerpts.map((d) => d.document_id),
        ),
        allowedEvidenceIds: new Set(evidence.map((e) => e.fileId)),
      });
      const finished = await runs.update(run.id, {
        status: "succeeded",
        latency_ms: result.latencyMs || Date.now() - started,
        prompt_tokens: result.usage?.inputTokens ?? null,
        completion_tokens: result.usage?.outputTokens ?? null,
        diagnostic_stage: options.stage,
        input_modality: built.prompt.images.length > 0 ? ["text", "image"] : ["text"],
        validation_status: "passed",
        provider_response_id: result.providerResponseId ?? null,
      });
      return {
        ok: true,
        assessment: validated.assessment,
        run: finished ?? run,
        warnings: validated.warnings,
      };
    } catch (err) {
      const failure = err instanceof ModelError
        ? err
        : new ModelError("unknown", "Unexpected reasoning failure.");
      const finished = await runs
        .update(run.id, {
          status: failure.category === "timeout" ? "timeout" : "failed",
          error_category: failure.category,
          error_message: failure.message.slice(0, 4000),
          diagnostic_stage: options.stage,
          validation_status:
            failure.category === "validation_failed" ||
              failure.category === "malformed_response" ||
              failure.category === "empty_response"
              ? "failed"
              : "not_applicable",
        })
        .catch(() => null);
      return {
        ok: false,
        error: { category: failure.category, message: failure.message },
        run: finished ?? run,
      };
    }
  }

  private async buildContext(
    sessionId: string,
    deviceType: string,
    options: AssessOptions,
  ): Promise<ReasoningContext> {
    const { db } = this.deps;
    const sessions = new SessionRepository(db);
    const observations = new ObservationRepository(db);
    const hypotheses = new HypothesisRepository(db);
    const tests = new DiagnosticTestRepository(db);
    const results = new TestResultRepository(db);
    const safety = new SafetyEventRepository(db);

    const [session, obs, hyps, testRows, resultRows, safetyEvents] =
      await Promise.all([
        sessions.getById(sessionId),
        observations.listBySession(sessionId),
        hypotheses.listBySession(sessionId),
        tests.listBySession(sessionId),
        results.listBySession(sessionId),
        safety.listBySession(sessionId),
      ]);
    if (!session) {
      throw new ModelError("not_found", "Unknown session.");
    }
    const resultsByTest = new Map(resultRows.map((r) => [r.test_id, r]));
    const latestSafety = safetyEvents[safetyEvents.length - 1];

    return {
      device_category:
        options.deviceCategory ?? mapDeviceCategory(deviceType),
      device_type: deviceType,
      manufacturer: session.manufacturer,
      model: session.model,
      operating_system: session.operating_system,
      symptoms: session.symptoms,
      observations: obs.map((o) => ({ source: o.source, body: o.body })),
      test_history: testRows.map((t) => {
        const r = resultsByTest.get(t.id);
        return {
          name: t.name,
          result: r?.selected_option ?? null,
          observation: r?.observation ?? null,
        };
      }),
      current_hypotheses: hyps.map((h) => ({
        title: h.title,
        status: h.status,
        confidence: h.confidence_label,
      })),
      doc_excerpts: (options.docExcerpts ?? []).map((d) => ({
        document_id: d.document_id,
        title: d.title,
        page: d.page ?? null,
        excerpt: d.excerpt,
      })),
      safety: {
        state: session.safety_state,
        restrictions: latestSafety ? [latestSafety.safe_next_steps] : [],
      },
      stage: options.stage,
      question: options.question,
    };
  }

  private async loadEvidence(
    sessionId: string,
  ): Promise<Array<{ fileId: string; mediaType: string; bytes: Buffer }>> {
    const files = new EvidenceFileRepository(this.deps.db);
    const rows = await files.listBySession(sessionId);
    const loaded: Array<{ fileId: string; mediaType: string; bytes: Buffer }> = [];
    for (const row of rows) {
      try {
        const bytes = await this.deps.storage.get(row.storage_key);
        loaded.push({ fileId: row.id, mediaType: row.media_type, bytes });
      } catch {
        // Missing bytes must not poison the call; the builder caps and
        // the run record still reflects what was actually sent.
        continue;
      }
    }
    return loaded;
  }
}

function mapDeviceCategory(deviceType: string): DeviceCategory {
  if (deviceType === "smartphone") {
    return "smartphone";
  }
  if (deviceType === "desktop") {
    return "desktop";
  }
  return "laptop";
}
