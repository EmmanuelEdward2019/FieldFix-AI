import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Kysely } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyzeResponseSchema,
  apiErrorSchema,
  recordResultResponseSchema,
  reportResponseSchema,
  sessionDetailResponseSchema,
} from "@fieldfix/contracts";
import { createApp } from "../src/app.js";
import type { AppEnv } from "../src/env.js";
import type { Database } from "../src/db/database.js";
import { DiagnosticEngineService } from "../src/diagnostics/engine.js";
import { SafetyController } from "../src/safety/controller.js";
import { DiagnosticReasoningService } from "../src/models/diagnostic-reasoning.js";
import type { MetaAdapterConfig } from "../src/models/meta/config.js";
import { ModelProviderRegistry } from "../src/models/registry.js";
import {
  ModelError,
  type CallModality,
  type ModelProvider,
  type ProviderPrompt,
  type ProviderTextResult,
} from "../src/models/types.js";
import { LocalStorageAdapter } from "../src/storage/local-adapter.js";
import type { StorageAdapter } from "../src/storage/types.js";
import { setupTestDb, teardownTestDb, truncateAll } from "./db/setup.js";
import { testEmailOutbox } from "../src/email/resend.js";
import { sessionWithRole } from "./helpers/admin-auth.js";

const TEST_ENV: AppEnv = {
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

function assessmentBody(overrides: Record<string, unknown> = {}): string {
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

class FakeProvider implements ModelProvider {
  readonly id = "fake-meta";
  readonly modalities: readonly CallModality[] = ["text", "image"];
  private script: string[] = [];
  private cursor = 0;

  queue(text: string): void {
    this.script.push(text);
  }

  async complete(_prompt: ProviderPrompt): Promise<ProviderTextResult> {
    const text = this.script[this.cursor];
    this.cursor += 1;
    if (text === undefined) {
      throw new ModelError("unavailable", "Fake provider script exhausted.");
    }
    return { text, model: "fake-meta-1", latencyMs: 5, attempts: 1 };
  }
}

const FIRST_ASSESSMENT = assessmentBody({
  hypotheses: [
    {
      title: "Dust-clogged heatsink",
      description: null,
      confidence: "medium",
      confidence_rationale: null,
      assessment_status: "supported",
      supporting_evidence: [
        { statement: "Loud fan reported.", provenance: "user_reported", source_ref: null },
      ],
      contradicting_evidence: [],
      affected_components: ["heatsink"],
    },
  ],
  recommended_tests: [
    {
      name: "Vent inspection",
      objective: "Confirm airflow restriction.",
      instructions: ["Power off.", "Inspect vents."],
      safety_notes: null,
      required_tools: [],
      result_options: ["dusty", "clear"],
    },
  ],
});

const REASSESSMENT = assessmentBody({
  summary: "Vents are clear; weakening the heatsink theory.",
  hypotheses: [
    {
      title: "Dust-clogged heatsink",
      description: null,
      confidence: "low",
      confidence_rationale: null,
      assessment_status: "weakened",
      supporting_evidence: [],
      contradicting_evidence: [
        { statement: "Vents are clear.", provenance: "test_result", source_ref: null },
      ],
      affected_components: [],
    },
  ],
  recommended_tests: [],
  missing_information: ["Idle temperature readings."],
});

describe("diagnostic loop routes", () => {
  let db: Kysely<Database>;
  let storageDir: string;
  let storage: StorageAdapter;
  let provider: FakeProvider;

  function app() {
    const providers = new ModelProviderRegistry();
    providers.register(provider, { isDefault: true });
    const reasoning = new DiagnosticReasoningService({
      db,
      storage,
      providers,
      defaultProviderId: provider.id,
      meta: META,
    });
    const engine = new DiagnosticEngineService({
      db,
      reasoning,
      safety: new SafetyController(db),
    });
    return createApp(TEST_ENV, { db, storage, engine });
  }

  async function createSession(userMode = "everyday"): Promise<{ id: string; token: string }> {
    const res = await request(app()).post("/api/v1/sessions").send({
      device_type: "laptop",
      symptoms: "Laptop overheats and shuts down under load.",
      user_mode: userMode,
    });
    expect(res.status).toBe(201);
    return { id: res.body.session.id as string, token: res.body.accessToken as string };
  }

  beforeAll(async () => {
    db = await setupTestDb();
    storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-diag-http-"));
    storage = new LocalStorageAdapter(storageDir);
  });

  afterAll(async () => {
    await teardownTestDb(db);
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAll(db);
    provider = new FakeProvider();
  });

  it("requires session access on every loop route", async () => {
    const { id } = await createSession();
    const unauthenticated = await request(app()).post(`/api/v1/sessions/${id}/analyze`).send({});
    expect(unauthenticated.status).toBe(403);

    const wrongToken = await request(app())
      .get(`/api/v1/sessions/${id}/hypotheses`)
      .set("Authorization", "Bearer wrong");
    expect(wrongToken.status).toBe(403);

    const unknown = await request(app())
      .get("/api/v1/sessions/12345678-1234-4123-8123-123456789012/report")
      .set("Authorization", "Bearer whatever");
    expect(unknown.status).toBe(404);
  });

  it("returns 500 instead of crashing when analysis fails", async () => {
    const { id, token } = await createSession();
    const spy = vi
      .spyOn(DiagnosticEngineService.prototype, "analyze")
      .mockRejectedValueOnce(new Error("simulated engine failure"));
    try {
      const res = await request(app())
        .post(`/api/v1/sessions/${id}/analyze`)
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("internal_error");
    } finally {
      spy.mockRestore();
    }
  });

  it("analyzes, lists hypotheses and tests, records a result, and reports", async () => {
    const { id, token } = await createSession();
    const auth = { Authorization: `Bearer ${token}` };
    provider.queue(FIRST_ASSESSMENT);
    provider.queue(REASSESSMENT);

    const analyzed = await request(app())
      .post(`/api/v1/sessions/${id}/analyze`)
      .set(auth)
      .send({});
    expect(analyzed.status).toBe(200);
    expect(analyzeResponseSchema.safeParse(analyzed.body).success).toBe(true);
    expect(analyzed.body.hypotheses).toHaveLength(1);
    expect(analyzed.body.tests).toHaveLength(1);
    const testId = analyzed.body.tests[0].id as string;

    const hypotheses = await request(app())
      .get(`/api/v1/sessions/${id}/hypotheses`)
      .set(auth);
    expect(hypotheses.status).toBe(200);
    expect(hypotheses.body.hypotheses[0].supporting_observations).toHaveLength(1);

    const tests = await request(app()).get(`/api/v1/sessions/${id}/tests`).set(auth);
    expect(tests.status).toBe(200);
    expect(tests.body.tests[0].test.status).toBe("awaiting_result");
    expect(tests.body.tests[0].result).toBeNull();

    const recorded = await request(app())
      .post(`/api/v1/sessions/${id}/tests/${testId}/results`)
      .set(auth)
      .send({ selected_option: "option_2", observation: "Vents are spotless." });
    expect(recorded.status).toBe(201);
    expect(recordResultResponseSchema.safeParse(recorded.body).success).toBe(true);
    expect(recorded.body.result.source).toBe("user_reported");
    expect(recorded.body.reassessment_applied).toBe(true);
    expect(recorded.body.hypotheses[0].status).toBe("weakened");

    const report = await request(app()).get(`/api/v1/sessions/${id}/report`).set(auth);
    expect(report.status).toBe(200);
    expect(reportResponseSchema.safeParse(report.body.report).success).toBe(true);
    expect(report.body.report.status).toBe("ready");
    expect(report.body.report.report_data.tests_performed[0].source).toBe("user_reported");
    // Completed report: deterministic assessment, timeline, evidence refs.
    const data = report.body.report.report_data;
    expect(data.assessment).toContain("No fault has been independently verified.");
    expect(data.timeline.map((e: { event_type: string }) => e.event_type)).toContain(
      "analysis_completed",
    );
    expect(data.hypotheses[0].supporting_observations.length).toBeGreaterThan(0);
  });

  it("serves the report as a PDF export", async () => {
    const { id, token } = await createSession();
    const auth = { Authorization: `Bearer ${token}` };
    provider.queue(FIRST_ASSESSMENT);

    await request(app()).post(`/api/v1/sessions/${id}/analyze`).set(auth).send({});

    const pdf = await request(app()).get(`/api/v1/sessions/${id}/report?format=pdf`).set(auth);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/application\/pdf/);
    expect(pdf.headers["content-disposition"]).toContain(
      `fieldfix-report-${id}.pdf`,
    );
    const raw = pdf.body as Buffer;
    expect(Buffer.isBuffer(raw)).toBe(true);
    expect(raw.subarray(0, 4).toString("latin1")).toBe("%PDF");
    // Content stream is kerned hex text; decode like a reader would.
    const parts: string[] = [];
    for (const match of raw.toString("latin1").matchAll(/<([0-9A-Fa-f]+)>/g)) {
      parts.push(Buffer.from(match[1] ?? "", "hex").toString("latin1"));
    }
    expect(parts.join("")).toContain("FieldFix");
  });

  it("emails a report copy to the session owner only", async () => {
    const owner = await sessionWithRole(app(), db, "owner-report@example.com", "technician");
    const created = await request(app())
      .post("/api/v1/sessions")
      .set({ Authorization: `Bearer ${owner.token}` })
      .send({
        device_type: "laptop",
        symptoms: "Laptop overheats and shuts down under load.",
        user_mode: "everyday",
      });
    expect(created.status).toBe(201);
    const id = created.body.session.id as string;
    provider.queue(FIRST_ASSESSMENT);
    await request(app())
      .post(`/api/v1/sessions/${id}/analyze`)
      .set({ Authorization: `Bearer ${created.body.accessToken as string}` })
      .send({})
      .expect(200);

    const sent = await request(app())
      .post(`/api/v1/sessions/${id}/report/email`)
      .set({ Authorization: `Bearer ${owner.token}` });
    expect(sent.status).toBe(200);
    const mail = [...testEmailOutbox]
      .reverse()
      .find(
        (m) => m.to === "owner-report@example.com" && m.subject.includes("diagnostic report"),
      );
    expect(mail?.text).toContain("Dust-clogged heatsink");
    expect(mail?.html).toContain(`/diagnostics/${id}`);
    expect(mail?.html).toContain("info@fieldfix.ai");

    // Guest sessions and strangers are refused; bad ids 404; anonymous 401s.
    const guest = await createSession();
    const guestSend = await request(app())
      .post(`/api/v1/sessions/${guest.id}/report/email`)
      .set({ Authorization: `Bearer ${owner.token}` });
    expect(guestSend.status).toBe(403);
    const stranger = await sessionWithRole(app(), db, "stranger-report@example.com", "technician");
    const foreign = await request(app())
      .post(`/api/v1/sessions/${id}/report/email`)
      .set({ Authorization: `Bearer ${stranger.token}` });
    expect(foreign.status).toBe(403);
    const bad = await request(app())
      .post("/api/v1/sessions/not-a-uuid/report/email")
      .set({ Authorization: `Bearer ${owner.token}` });
    expect(bad.status).toBe(404);
    const anon = await request(app()).post(`/api/v1/sessions/${id}/report/email`);
    expect(anon.status).toBe(401);
  });

  it("exposes the loop state through session detail", async () => {
    const { id, token } = await createSession();
    const auth = { Authorization: `Bearer ${token}` };
    provider.queue(FIRST_ASSESSMENT);

    await request(app()).post(`/api/v1/sessions/${id}/analyze`).set(auth).send({});

    const detail = await request(app()).get(`/api/v1/sessions/${id}`).set(auth);
    expect(detail.status).toBe(200);
    expect(sessionDetailResponseSchema.safeParse(detail.body).success).toBe(true);
    expect(detail.body.hypotheses).toHaveLength(1);
    expect(detail.body.tests).toHaveLength(1);
    expect(detail.body.tests[0].result).toBeNull();
    expect(detail.body.model_runs).toHaveLength(1);
    expect(
      detail.body.events.map((e: { event_type: string }) => e.event_type),
    ).toContain("analysis_completed");
  });

  it("rejects bad results: unknown test, bad option, duplicates", async () => {
    const { id, token } = await createSession();
    const auth = { Authorization: `Bearer ${token}` };
    provider.queue(FIRST_ASSESSMENT);
    provider.queue(REASSESSMENT);
    const analyzed = await request(app())
      .post(`/api/v1/sessions/${id}/analyze`)
      .set(auth)
      .send({});
    const testId = analyzed.body.tests[0].id as string;

    const unknown = await request(app())
      .post(`/api/v1/sessions/${id}/tests/12345678-1234-4123-8123-123456789012/results`)
      .set(auth)
      .send({ selected_option: "option_1" });
    expect(unknown.status).toBe(404);

    const malformed = await request(app())
      .post(`/api/v1/sessions/${id}/tests/not-a-uuid/results`)
      .set(auth)
      .send({ selected_option: "option_1" });
    expect(malformed.status).toBe(404);

    const badOption = await request(app())
      .post(`/api/v1/sessions/${id}/tests/${testId}/results`)
      .set(auth)
      .send({ selected_option: "invented" });
    expect(badOption.status).toBe(400);
    expect(apiErrorSchema.safeParse(badOption.body).success).toBe(true);

    const empty = await request(app())
      .post(`/api/v1/sessions/${id}/tests/${testId}/results`)
      .set(auth)
      .send({});
    expect(empty.status).toBe(400);

    const first = await request(app())
      .post(`/api/v1/sessions/${id}/tests/${testId}/results`)
      .set(auth)
      .send({ selected_option: "option_1" });
    expect(first.status).toBe(201);
    const duplicate = await request(app())
      .post(`/api/v1/sessions/${id}/tests/${testId}/results`)
      .set(auth)
      .send({ selected_option: "option_2" });
    expect(duplicate.status).toBe(409);
  });

  it("verifies hypotheses only for technician sessions", async () => {
    const everyday = await createSession("everyday");
    provider.queue(FIRST_ASSESSMENT);
    const analyzed = await request(app())
      .post(`/api/v1/sessions/${everyday.id}/analyze`)
      .set({ Authorization: `Bearer ${everyday.token}` })
      .send({});
    const hypothesisId = analyzed.body.hypotheses[0].id as string;

    const denied = await request(app())
      .post(`/api/v1/sessions/${everyday.id}/hypotheses/${hypothesisId}/verify`)
      .set({ Authorization: `Bearer ${everyday.token}` })
      .send({ rationale: "Looks right." });
    expect(denied.status).toBe(403);

    const tech = await createSession("technician");
    provider.queue(FIRST_ASSESSMENT);
    const techAnalyzed = await request(app())
      .post(`/api/v1/sessions/${tech.id}/analyze`)
      .set({ Authorization: `Bearer ${tech.token}` })
      .send({});
    const techHypothesisId = techAnalyzed.body.hypotheses[0].id as string;
    const verified = await request(app())
      .post(`/api/v1/sessions/${tech.id}/hypotheses/${techHypothesisId}/verify`)
      .set({ Authorization: `Bearer ${tech.token}` })
      .send({ rationale: "Confirmed with thermal camera." });
    expect(verified.status).toBe(200);
    expect(verified.body.hypothesis.status).toBe("verified");

    const missingRationale = await request(app())
      .post(`/api/v1/sessions/${tech.id}/hypotheses/${techHypothesisId}/verify`)
      .set({ Authorization: `Bearer ${tech.token}` })
      .send({});
    expect(missingRationale.status).toBe(400);
  });

  it("degrades honestly when the model is unavailable", async () => {
    // Wired app without an injected engine and without META_API_KEY.
    const bare = createApp(TEST_ENV, { db, storage });
    const created = await request(bare).post("/api/v1/sessions").send({
      device_type: "smartphone",
      symptoms: "Phone gets hot.",
      user_mode: "everyday",
    });
    const id = created.body.session.id as string;
    const token = created.body.accessToken as string;
    const analyzed = await request(bare)
      .post(`/api/v1/sessions/${id}/analyze`)
      .set({ Authorization: `Bearer ${token}` })
      .send({});
    expect(analyzed.status).toBe(502);
    expect(apiErrorSchema.safeParse(analyzed.body).success).toBe(true);
  });
});
