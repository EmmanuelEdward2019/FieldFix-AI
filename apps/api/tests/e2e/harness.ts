import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Application } from "express";
import type { Kysely } from "kysely";
import request from "supertest";
import { expect } from "vitest";
import { createApp } from "../../src/app.js";
import type { AppEnv } from "../../src/env.js";
import type { Database } from "../../src/db/database.js";
import { DiagnosticEngineService } from "../../src/diagnostics/engine.js";
import { SafetyController } from "../../src/safety/controller.js";
import { DiagnosticReasoningService } from "../../src/models/diagnostic-reasoning.js";
import { ModelProviderRegistry } from "../../src/models/registry.js";
import type { MetaAdapterConfig } from "../../src/models/meta/config.js";
import {
  ModelError,
  type CallModality,
  type ModelProvider,
  type ProviderPrompt,
  type ProviderTextResult,
  type SegmentCallInput,
  type SegmentationProvider,
  type SegmentationResult,
} from "../../src/models/types.js";
import { SegmentationService } from "../../src/vision/service.js";
import { LocalStorageAdapter } from "../../src/storage/local-adapter.js";
import type { StorageAdapter } from "../../src/storage/types.js";
import { setupTestDb, teardownTestDb, truncateAll } from "../db/setup.js";
import { sessionWithRole } from "../helpers/admin-auth.js";
import { makePng } from "../vision/png-fixture.js";

export const E2E_ENV: AppEnv = {
  NODE_ENV: "test",
  PORT: 3001,
  CORS_ORIGIN: "http://localhost:3000",
  API_VERSION: "0.1.0-test",
  STORAGE_DRIVER: "local",
  MAX_UPLOAD_MB: 10,
  IFIXIT_API_BASE_URL: "https://www.ifixit.com/api/2.0",
  META_MODEL_ID: "muse-spark-1.3",
  SAM_MODEL_ID: "sam-3.1",
  META_API_BASE_URL: "https://api.meta.ai/v1",
  META_REQUEST_TIMEOUT_MS: 60000,
  META_MAX_RETRIES: 3,
  META_REASONING_EFFORT: "medium",
  META_MAX_OUTPUT_TOKENS: 4000,
  META_MAX_IMAGES_PER_REQUEST: 8,
  META_MAX_IMAGE_BYTES: 10 * 1024 * 1024,
  VOICE_MODEL_ID: "muse-voice-transcribe-1.0",
  VOICE_MAX_AUDIO_MB: 32,
  EMAIL_FROM: "FieldFix AI <tests@example.com>",
  APP_BASE_URL: "http://localhost:3000",
};

const META: MetaAdapterConfig = {
  apiKey: "test-key",
  baseUrl: "https://api.meta.ai/v1",
  modelId: "muse-spark-1.3",
  timeoutMs: 5000,
  maxRetries: 0,
  reasoningEffort: "medium",
  maxOutputTokens: 4000,
  maxImagesPerRequest: 8,
  maxImageBytes: 1024 * 1024,
};

/** Scripted stand-in for the Meta reasoning provider (mocked AI). */
export class ScriptedModelProvider implements ModelProvider {
  readonly id = "fake-meta";
  readonly modalities: readonly CallModality[] = ["text", "image"];
  readonly prompts: ProviderPrompt[] = [];
  private script: Array<string | ModelError> = [];
  private cursor = 0;

  queue(entry: string | ModelError): void {
    this.script.push(entry);
  }

  async complete(prompt: ProviderPrompt): Promise<ProviderTextResult> {
    this.prompts.push(prompt);
    const entry = this.script[this.cursor];
    this.cursor += 1;
    if (entry === undefined) {
      throw new ModelError("unavailable", "Fake provider script exhausted.");
    }
    if (entry instanceof ModelError) {
      throw entry;
    }
    return { text: entry, model: "fake-meta-1", latencyMs: 5, attempts: 1 };
  }
}

/** Scripted stand-in for the SAM segmentation provider (mocked AI). */
export class ScriptedSegmentationProvider implements SegmentationProvider {
  readonly id = "fake-sam";
  objects: SegmentationResult["objects"] = [];
  failure: ModelError | null = null;

  async segment(_input: SegmentCallInput): Promise<SegmentationResult> {
    if (this.failure) {
      throw this.failure;
    }
    return {
      model: "fake-sam-1",
      objects: this.objects,
      warnings: [],
      latencyMs: 5,
      attempts: 1,
    };
  }
}

export function assessmentBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    summary: "Assessment.",
    observed_evidence: [],
    hypotheses: [],
    recommended_tests: [],
    safety_warnings: [],
    missing_information: [],
    citations: [],
    suggested_next_action: { action: "Next.", rationale: null },
    ...overrides,
  });
}

export interface E2EContext {
  db: Kysely<Database>;
  storage: StorageAdapter;
  storageDir: string;
  model: ScriptedModelProvider;
  segmenter: ScriptedSegmentationProvider;
  app: () => Application;
  adminToken: string;
}

export async function setupE2E(): Promise<E2EContext> {
  const db = await setupTestDb();
  const storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-e2e-"));
  const storage = new LocalStorageAdapter(storageDir);
  const model = new ScriptedModelProvider();
  const segmenter = new ScriptedSegmentationProvider();
  const app = (): Application => {
    const providers = new ModelProviderRegistry();
    providers.register(model, { isDefault: true });
    const reasoning = new DiagnosticReasoningService({
      db,
      storage,
      providers,
      defaultProviderId: model.id,
      meta: META,
    });
    const engine = new DiagnosticEngineService({
      db,
      reasoning,
      safety: new SafetyController(db),
    });
    const segmentation = new SegmentationService({
      db,
      storage,
      provider: segmenter,
      modelId: "sam-3.1",
    });
    return createApp(E2E_ENV, { db, storage, engine, segmentation });
  };
  const ctx: E2EContext = { db, storage, storageDir, model, segmenter, app, adminToken: "" };
  await resetE2E(ctx);
  return ctx;
}

export async function teardownE2E(ctx: E2EContext): Promise<void> {
  await teardownTestDb(ctx.db);
  await rm(ctx.storageDir, { recursive: true, force: true });
}

export async function resetE2E(ctx: E2EContext): Promise<void> {
  await truncateAll(ctx.db);
  const admin = await sessionWithRole(ctx.app(), ctx.db, "e2e-admin@example.com", "admin");
  ctx.adminToken = admin.token;
}

export async function e2eCreateSession(
  ctx: E2EContext,
  body: Record<string, unknown>,
): Promise<{ id: string; token: string; session: Record<string, unknown> }> {
  const res = await request(ctx.app()).post("/api/v1/sessions").send(body);
  expect(res.status).toBe(201);
  return {
    id: res.body.session.id as string,
    token: res.body.accessToken as string,
    session: res.body.session as Record<string, unknown>,
  };
}

export async function e2eUploadPng(
  ctx: E2EContext,
  sessionId: string,
  token: string,
  filename: string,
  width = 100,
  height = 80,
  observation?: string,
): Promise<string> {
  const req = request(ctx.app())
    .post(`/api/v1/sessions/${sessionId}/evidence`)
    .set({ Authorization: `Bearer ${token}` })
    .attach("file", makePng(width, height), { filename, contentType: "image/png" });
  if (observation) {
    req.field("observation", observation);
  }
  const res = await req;
  expect(res.status).toBe(201);
  return res.body.file.id as string;
}

/** Ingest a small Markdown manual through the admin route. */
export async function e2eIngestMarkdown(
  ctx: E2EContext,
  title: string,
  body: string,
  manufacturer = "Acme",
): Promise<{ documentId: string; chunks: number }> {
  const metadata = JSON.stringify({
    title,
    manufacturer,
    document_type: "service_manual",
    permission_status: "approved",
  });
  const res = await request(ctx.app())
    .post("/api/v1/admin/documents")
    .set({ Authorization: `Bearer ${ctx.adminToken}` })
    .attach("file", Buffer.from(body, "utf8"), {
      filename: "manual.md",
      contentType: "text/markdown",
    })
    .field("metadata", metadata);
  expect(res.status).toBe(201);
  return {
    documentId: res.body.document.id as string,
    chunks: (res.body.job.chunks_created as number) ?? 0,
  };
}
