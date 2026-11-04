import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Kysely } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { apiErrorSchema } from "@fieldfix/contracts";
import { createApp } from "../../src/app.js";
import type { AppEnv } from "../../src/env.js";
import type { Database } from "../../src/db/database.js";
import { DiagnosticEngineService } from "../../src/diagnostics/engine.js";
import { DiagnosticReasoningService } from "../../src/models/diagnostic-reasoning.js";
import type { MetaAdapterConfig } from "../../src/models/meta/config.js";
import { ModelProviderRegistry } from "../../src/models/registry.js";
import {
  ModelError,
  type CallModality,
  type ModelProvider,
  type ProviderPrompt,
  type ProviderTextResult,
} from "../../src/models/types.js";
import { SafetyController } from "../../src/safety/controller.js";
import { SafetyScreeningService } from "../../src/safety/screening.js";
import { LocalStorageAdapter } from "../../src/storage/local-adapter.js";
import type { StorageAdapter } from "../../src/storage/types.js";
import { setupTestDb, teardownTestDb, truncateAll } from "../db/setup.js";

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

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);

function assessmentBody(): string {
  return JSON.stringify({
    summary: "Assessment.",
    observed_evidence: [],
    hypotheses: [
      {
        title: "Dead adapter",
        description: null,
        confidence: "medium",
        confidence_rationale: null,
        assessment_status: "supported",
        supporting_evidence: [],
        contradicting_evidence: [],
        affected_components: [],
      },
    ],
    recommended_tests: [
      {
        name: "Adapter check",
        objective: "Check the adapter LED.",
        instructions: ["Look at the LED."],
        safety_notes: null,
        required_tools: [],
        result_options: ["on", "off"],
      },
    ],
    safety_warnings: [],
    missing_information: [],
    citations: [],
    suggested_next_action: { action: "Next.", rationale: null },
  });
}

class FakeReasoningProvider implements ModelProvider {
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
      throw new ModelError("unavailable", "Script exhausted.");
    }
    return { text, model: "fake-meta-1", latencyMs: 5, attempts: 1 };
  }
}

class FakeScreeningProvider implements ModelProvider {
  readonly id = "fake-screen";
  readonly modalities: readonly CallModality[] = ["text"];
  prompts: ProviderPrompt[] = [];
  calls = 0;

  constructor(
    private readonly behavior:
      | { kind: "flag"; categories?: string[]; rationale?: string }
      | { kind: "clear" }
      | { kind: "fail" },
  ) {}

  async complete(prompt: ProviderPrompt): Promise<ProviderTextResult> {
    this.calls += 1;
    this.prompts.push(prompt);
    if (this.behavior.kind === "fail") {
      throw new ModelError("unavailable", "Screening provider down.");
    }
    const suspected = this.behavior.kind === "flag";
    return {
      text: JSON.stringify({
        hazard_suspected: suspected,
        categories: suspected ? (this.behavior.categories ?? ["heat"]) : [],
        rationale: suspected ? (this.behavior.rationale ?? "Warm device.") : "",
      }),
      model: "fake-screen-1",
      latencyMs: 2,
      attempts: 1,
    };
  }
}

describe("safety loop (HTTP, mocked models)", () => {
  let db: Kysely<Database>;
  let storageDir: string;
  let storage: StorageAdapter;
  let reasoningProvider: FakeReasoningProvider;
  let screeningProvider: FakeScreeningProvider;

  function app() {
    const providers = new ModelProviderRegistry();
    providers.register(reasoningProvider, { isDefault: true });
    const reasoning = new DiagnosticReasoningService({
      db,
      storage,
      providers,
      defaultProviderId: reasoningProvider.id,
      meta: META,
    });
    const safety = new SafetyController(db);
    const engine = new DiagnosticEngineService({ db, reasoning, safety });
    const screening = new SafetyScreeningService({ provider: screeningProvider });
    return createApp(TEST_ENV, { db, storage, engine, safety, screening });
  }

  async function createSession(
    symptoms: string,
    userMode = "everyday",
  ): Promise<{ id: string; token: string; state: string }> {
    const res = await request(app()).post("/api/v1/sessions").send({
      device_type: "smartphone",
      symptoms,
      user_mode: userMode,
    });
    expect(res.status).toBe(201);
    return {
      id: res.body.session.id as string,
      token: res.body.accessToken as string,
      state: res.body.session.safety_state as string,
    };
  }

  beforeAll(async () => {
    db = await setupTestDb();
    storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-safety-"));
    storage = new LocalStorageAdapter(storageDir);
  });

  afterAll(async () => {
    await teardownTestDb(db);
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAll(db);
    reasoningProvider = new FakeReasoningProvider();
    screeningProvider = new FakeScreeningProvider({ kind: "clear" });
  });

  it("stops a swollen-battery session at creation with safe steps", async () => {
    const session = await createSession(
      "The battery is swollen and the screen is lifting away from the frame.",
    );
    expect(session.state).toBe("critical_stop");

    const events = await request(app())
      .get(`/api/v1/sessions/${session.id}/safety/events`)
      .set({ Authorization: `Bearer ${session.token}` });
    expect(events.status).toBe(200);
    expect(events.body.events).toHaveLength(1);
    expect(events.body.events[0]).toMatchObject({
      previous_state: "normal",
      new_state: "critical_stop",
      trigger_type: "user_report",
    });
    expect(events.body.events[0].blocked_action).toContain("analyze");
    expect(events.body.events[0].safe_next_steps).toContain("Do not press, puncture");
  });

  it("blocks analyze/record/verify in critical_stop but allows uploads and reports", async () => {
    const session = await createSession("Smoke is coming from the charging port.");
    expect(session.state).toBe("critical_stop");
    const auth = { Authorization: `Bearer ${session.token}` };

    const analyzed = await request(app())
      .post(`/api/v1/sessions/${session.id}/analyze`)
      .set(auth)
      .send({});
    expect(analyzed.status).toBe(422);
    expect(analyzed.body.error.code).toBe("safety_block");

    // Evidence intake stays open so the hazard can be documented.
    const uploaded = await request(app())
      .post(`/api/v1/sessions/${session.id}/evidence`)
      .set(auth)
      .attach("file", PNG, { filename: "smoke.png", contentType: "image/png" })
      .field("observation", "Photo of the port.");
    expect(uploaded.status).toBe(201);

    const report = await request(app()).get(`/api/v1/sessions/${session.id}/report`).set(auth);
    expect(report.status).toBe(200);
    expect(report.body.report.report_data.safety_summary).toHaveLength(1);
  });

  it("escalates on a hazardous upload note and records the evidence link", async () => {
    const session = await createSession("Phone will not turn on.");
    expect(session.state).toBe("normal");
    const auth = { Authorization: `Bearer ${session.token}` };

    const uploaded = await request(app())
      .post(`/api/v1/sessions/${session.id}/evidence`)
      .set(auth)
      .attach("file", PNG, { filename: "batt.png", contentType: "image/png" })
      .field("observation", "The back cover is bulging outward.");
    expect(uploaded.status).toBe(201);

    const detail = await request(app()).get(`/api/v1/sessions/${session.id}`).set(auth);
    expect(detail.body.session.safety_state).toBe("critical_stop");

    const events = await request(app())
      .get(`/api/v1/sessions/${session.id}/safety/events`)
      .set(auth);
    expect(events.body.events[0].evidence_file_id).toBe(uploaded.body.file.id);
  });

  it("escalates on a hazardous test-result note after recording the result", async () => {
    const session = await createSession("Laptop will not power on.");
    const auth = { Authorization: `Bearer ${session.token}` };
    reasoningProvider.queue(assessmentBody());
    reasoningProvider.queue(assessmentBody());

    const analyzed = await request(app())
      .post(`/api/v1/sessions/${session.id}/analyze`)
      .set(auth)
      .send({});
    expect(analyzed.status).toBe(200);
    const testId = analyzed.body.tests[0].id as string;

    const recorded = await request(app())
      .post(`/api/v1/sessions/${session.id}/tests/${testId}/results`)
      .set(auth)
      .send({ selected_option: "option_1", observation: "It started smoking during the check." });
    expect(recorded.status).toBe(201);
    expect(recorded.body.reassessment_applied).toBe(false);

    const detail = await request(app()).get(`/api/v1/sessions/${session.id}`).set(auth);
    expect(detail.body.session.safety_state).toBe("critical_stop");
  });

  it("resumes only via technician review, then the loop works again", async () => {
    const session = await createSession("Sparks when plugging in the charger.", "technician");
    expect(session.state).toBe("critical_stop");
    const auth = { Authorization: `Bearer ${session.token}` };

    const everyday = await createSession("Sparks too.", "everyday");
    const denied = await request(app())
      .post(`/api/v1/sessions/${everyday.id}/safety/transition`)
      .set({ Authorization: `Bearer ${everyday.token}` })
      .send({ to_state: "review_required", rationale: "Let me through." });
    expect(denied.status).toBe(403);

    const skipped = await request(app())
      .post(`/api/v1/sessions/${session.id}/safety/transition`)
      .set(auth)
      .send({ to_state: "normal", rationale: "Skipping review." });
    expect(skipped.status).toBe(422);

    const review = await request(app())
      .post(`/api/v1/sessions/${session.id}/safety/transition`)
      .set(auth)
      .send({ to_state: "review_required", rationale: "Inspecting the charger in person." });
    expect(review.status).toBe(200);
    expect(review.body.session.safety_state).toBe("review_required");

    // Still gated while under review.
    reasoningProvider.queue(assessmentBody());
    const gated = await request(app())
      .post(`/api/v1/sessions/${session.id}/analyze`)
      .set(auth)
      .send({});
    expect(gated.status).toBe(422);

    const cleared = await request(app())
      .post(`/api/v1/sessions/${session.id}/safety/transition`)
      .set(auth)
      .send({ to_state: "normal", rationale: "Faulty third-party charger; device is fine." });
    expect(cleared.status).toBe(200);

    const analyzed = await request(app())
      .post(`/api/v1/sessions/${session.id}/analyze`)
      .set(auth)
      .send({});
    expect(analyzed.status).toBe(200);
  });

  it("ignores a reassuring model when deterministic rules fire", async () => {
    // Screening says "clear", but the deterministic policy decides.
    const session = await createSession("The battery is swollen.");
    expect(session.state).toBe("critical_stop");
    expect(screeningProvider.calls).toBe(0);
  });

  it("gates on a model-only flag and recovers when the model fails", async () => {
    screeningProvider = new FakeScreeningProvider({ kind: "flag" });
    const flagged = await createSession("The device behaves strangely sometimes.");
    expect(flagged.state).toBe("review_required");

    const gated = await request(app())
      .post(`/api/v1/sessions/${flagged.id}/analyze`)
      .set({ Authorization: `Bearer ${flagged.token}` })
      .send({});
    expect(gated.status).toBe(422);

    screeningProvider = new FakeScreeningProvider({ kind: "fail" });
    const benign = await createSession("Wifi is slow.");
    expect(benign.state).toBe("normal");

    const hazard = await createSession("I see smoke.");
    expect(hazard.state).toBe("critical_stop");
  });

  it("validates transition input", async () => {
    const session = await createSession("Sparks.", "technician");
    const auth = { Authorization: `Bearer ${session.token}` };
    const empty = await request(app())
      .post(`/api/v1/sessions/${session.id}/safety/transition`)
      .set(auth)
      .send({ to_state: "review_required" });
    expect(empty.status).toBe(400);
    expect(apiErrorSchema.safeParse(empty.body).success).toBe(true);

    const badState = await request(app())
      .post(`/api/v1/sessions/${session.id}/safety/transition`)
      .set(auth)
      .send({ to_state: "meltdown", rationale: "x" });
    expect(badState.status).toBe(400);
  });
});
