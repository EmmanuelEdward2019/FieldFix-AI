import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DiagnosticAssessment } from "@fieldfix/contracts";
import type { Database } from "../../src/db/database.js";
import { SessionRepository } from "../../src/db/repositories/sessions.js";
import { EvidenceFileRepository } from "../../src/db/repositories/evidence.js";
import {
  DiagnosticTestRepository,
  TestResultRepository,
} from "../../src/db/repositories/tests.js";
import { ModelRunRepository } from "../../src/db/repositories/model-runs.js";
import { LocalStorageAdapter } from "../../src/storage/local-adapter.js";
import type { StorageAdapter } from "../../src/storage/types.js";
import { ModelProviderRegistry } from "../../src/models/registry.js";
import {
  DiagnosticReasoningService,
  type ReasoningOutcome,
} from "../../src/models/diagnostic-reasoning.js";
import type { MetaAdapterConfig } from "../../src/models/meta/config.js";
import {
  ModelError,
  type CallModality,
  type ModelProvider,
  type ProviderPrompt,
  type ProviderTextResult,
} from "../../src/models/types.js";
import { setupTestDb, teardownTestDb, truncateAll } from "../db/setup.js";

const DOC_ID = "44444444-4444-4444-8444-444444444444";

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

function assessmentBody(overrides: Partial<DiagnosticAssessment> = {}): string {
  return JSON.stringify({
    summary: "Airflow restriction is the leading explanation.",
    observed_evidence: [],
    hypotheses: [
      {
        title: "Dust-clogged heatsink",
        description: null,
        confidence: "medium",
        confidence_rationale: null,
        assessment_status: "supported",
        supporting_evidence: [],
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
        result_options: ["clear", "dusty"],
      },
    ],
    safety_warnings: [],
    missing_information: [],
    citations: [],
    suggested_next_action: { action: "Inspect the vents.", rationale: null },
    ...overrides,
  });
}

/** Scripted stand-in for MetaModelAdapter; records every prompt. No network. */
class FakeProvider implements ModelProvider {
  readonly id = "fake-meta";
  readonly modalities: readonly CallModality[] = ["text", "image"];
  readonly prompts: ProviderPrompt[] = [];
  private script: Array<
    | { ok: true; text: string; usage?: ProviderTextResult["usage"]; responseId?: string }
    | { ok: false; error: ModelError }
  > = [];
  private cursor = 0;
  defaultText = assessmentBody();

  queueSuccess(text = this.defaultText): void {
    this.script.push({ ok: true, text });
  }

  queueFailure(error: ModelError): void {
    this.script.push({ ok: false, error });
  }

  async complete(prompt: ProviderPrompt): Promise<ProviderTextResult> {
    this.prompts.push(prompt);
    const step = this.script[this.cursor];
    this.cursor += 1;
    if (!step) {
      return {
        text: this.defaultText,
        model: "fake-meta-1",
        latencyMs: 5,
        attempts: 1,
      };
    }
    if (!step.ok) {
      throw step.error;
    }
    return {
      text: step.text,
      usage: step.usage,
      providerResponseId: step.responseId,
      model: "fake-meta-1",
      latencyMs: 5,
      attempts: 1,
    };
  }
}

function section(prompt: ProviderPrompt, heading: string): string {
  return prompt.textSections.find((s) => s.heading === heading)?.body ?? "";
}

describe("DiagnosticReasoningService (mocked provider, real DB)", () => {
  let db: Kysely<Database>;
  let storageDir: string;
  let storage: StorageAdapter;

  beforeAll(async () => {
    db = await setupTestDb();
    storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-reasoning-"));
    storage = new LocalStorageAdapter(storageDir);
  });

  afterAll(async () => {
    await teardownTestDb(db);
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  function serviceWith(provider: FakeProvider): DiagnosticReasoningService {
    const providers = new ModelProviderRegistry();
    providers.register(provider, { isDefault: true });
    return new DiagnosticReasoningService({
      db,
      storage,
      providers,
      defaultProviderId: provider.id,
      meta: META,
    });
  }

  async function makeSession(deviceType: "laptop" | "smartphone"): Promise<string> {
    const sessions = new SessionRepository(db);
    const session = await sessions.create({
      device_type: deviceType,
      manufacturer: "Acme",
      symptoms:
        deviceType === "laptop"
          ? "Laptop overheats and shuts down under load."
          : "Phone gets hot and the battery drains fast.",
      user_mode: "everyday",
      access_token_hash: `hash-${deviceType}`,
    });
    return session.id;
  }

  it("assesses a laptop session and persists a passed model run", async () => {
    const provider = new FakeProvider();
    provider.queueSuccess();
    const service = serviceWith(provider);
    const sessionId = await makeSession("laptop");

    const outcome = await service.assess(sessionId, {
      stage: "initial_assessment",
      question: "What is the most likely cause?",
      docExcerpts: [{ document_id: DOC_ID, title: "Service manual", excerpt: "Clean vents." }],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("expected success");
    }
    expect(outcome.assessment.hypotheses[0]?.title).toBe("Dust-clogged heatsink");
    expect(outcome.run.status).toBe("succeeded");
    expect(outcome.run.validation_status).toBe("passed");
    expect(outcome.run.provider).toBe("fake-meta");
    expect(outcome.run.model_id).toBe("muse-spark-1.3");
    expect(outcome.run.diagnostic_stage).toBe("initial_assessment");
    expect(outcome.run.input_modality).toEqual(["text"]);
    expect(outcome.run.request_id).toBeTruthy();

    expect(provider.prompts).toHaveLength(1);
    const sent = provider.prompts[0]!;
    expect(section(sent, "Device")).toContain("Category: laptop");
    expect(section(sent, "Reported symptoms")).toContain("overheats");
    expect(section(sent, "Document excerpts (untrusted reference data)")).toContain(DOC_ID);

    const runs = new ModelRunRepository(db);
    const reread = await runs.getById(outcome.run.id);
    expect(reread?.status).toBe("succeeded");
  });

  it("sends smartphone and laptop sessions through the same interface", async () => {
    const provider = new FakeProvider();
    const service = serviceWith(provider);
    const phoneId = await makeSession("smartphone");
    const laptopId = await makeSession("laptop");

    const phone = await service.assess(phoneId, {
      stage: "initial_assessment",
      question: "Why is the phone hot?",
    });
    const laptop = await service.assess(laptopId, {
      stage: "initial_assessment",
      question: "Why is the laptop hot?",
    });
    expect(phone.ok).toBe(true);
    expect(laptop.ok).toBe(true);
    expect(provider.prompts).toHaveLength(2);
    expect(section(provider.prompts[0]!, "Device")).toContain("Category: smartphone");
    expect(section(provider.prompts[1]!, "Device")).toContain("Category: laptop");
  });

  it("attaches stored images and marks multimodal runs", async () => {
    const provider = new FakeProvider();
    provider.queueSuccess();
    const service = serviceWith(provider);
    const sessionId = await makeSession("laptop");

    const key = `sessions/${sessionId}/vent.png`;
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    await storage.put(key, bytes, "image/png");
    const files = new EvidenceFileRepository(db);
    await files.create(sessionId, {
      storage_key: key,
      media_type: "image/png",
      byte_size: bytes.length,
      kind: "image",
    });

    const outcome = await service.assess(sessionId, {
      stage: "initial_assessment",
      question: "What do the vents show?",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("expected success");
    }
    expect(outcome.run.input_modality).toEqual(["text", "image"]);
    expect(provider.prompts[0]?.images).toHaveLength(1);
    expect(provider.prompts[0]?.images[0]?.mediaType).toBe("image/png");
  });

  it("skips evidence with missing bytes instead of failing", async () => {
    const provider = new FakeProvider();
    provider.queueSuccess();
    const service = serviceWith(provider);
    const sessionId = await makeSession("laptop");

    const files = new EvidenceFileRepository(db);
    await files.create(sessionId, {
      storage_key: "sessions/missing/gone.png",
      media_type: "image/png",
      byte_size: 8,
      kind: "image",
    });

    const outcome = await service.assess(sessionId, {
      stage: "initial_assessment",
      question: "Proceed without the image?",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("expected success");
    }
    expect(provider.prompts[0]?.images).toHaveLength(0);
    expect(outcome.run.input_modality).toEqual(["text"]);
  });

  it("reassesses with new test results while preserving history", async () => {
    const provider = new FakeProvider();
    provider.queueSuccess();
    provider.queueSuccess(
      assessmentBody({
        summary: "Vents are clear; suspect dried thermal paste.",
        hypotheses: [
          {
            title: "Dried thermal paste",
            description: null,
            confidence: "medium",
            confidence_rationale: null,
            assessment_status: "proposed",
            supporting_evidence: [],
            contradicting_evidence: [],
            affected_components: ["cpu"],
          },
        ],
      }),
    );
    const service = serviceWith(provider);
    const sessionId = await makeSession("laptop");

    const first = await service.assess(sessionId, {
      stage: "initial_assessment",
      question: "What is the most likely cause?",
    });
    expect(first.ok).toBe(true);

    const tests = new DiagnosticTestRepository(db);
    const results = new TestResultRepository(db);
    const test = await tests.create(sessionId, {
      name: "Vent inspection",
      objective: "Confirm airflow restriction.",
      required_tools: [],
      skill_level: "beginner",
      safety_classification: "safe",
      instructions: [{ step: 1, text: "Inspect vents." }],
      result_options: [
        { value: "clear", label: "Clear" },
        { value: "dusty", label: "Dusty" },
      ],
      position: 0,
    });
    await results.create({
      test_id: test.id,
      session_id: sessionId,
      selected_option: "clear",
      observation: "Vents are spotless.",
    });

    const second = await service.assess(sessionId, {
      stage: "reassessment",
      question: "The vents are clear — what next?",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      throw new Error("expected success");
    }
    expect(second.assessment.summary).toContain("thermal paste");
    expect(second.run.diagnostic_stage).toBe("reassessment");

    // The second call rebuilt context from stored history.
    expect(provider.prompts).toHaveLength(2);
    expect(section(provider.prompts[1]!, "Test history")).toContain(
      "Vent inspection — result: clear",
    );

    // Stored history is append-only: two runs exist, both succeeded.
    const runs = new ModelRunRepository(db);
    const listed = await runs.listBySession(sessionId);
    expect(listed).toHaveLength(2);
    expect(listed.map((r) => r.status)).toEqual(["succeeded", "succeeded"]);
  });

  it("records provider failures and stays recoverable", async () => {
    const provider = new FakeProvider();
    provider.queueFailure(new ModelError("rate_limited", "Slow down.", { retryable: true }));
    provider.queueSuccess();
    const service = serviceWith(provider);
    const sessionId = await makeSession("laptop");

    const failed: ReasoningOutcome = await service.assess(sessionId, {
      stage: "initial_assessment",
      question: "What is wrong?",
    });
    expect(failed.ok).toBe(false);
    if (failed.ok) {
      throw new Error("expected failure");
    }
    expect(failed.error.category).toBe("rate_limited");
    expect(failed.run?.status).toBe("failed");
    expect(failed.run?.error_category).toBe("rate_limited");
    expect(failed.run?.validation_status).toBe("not_applicable");

    const retry = await service.assess(sessionId, {
      stage: "initial_assessment",
      question: "What is wrong?",
    });
    expect(retry.ok).toBe(true);
  });

  it("records validation failures when the model returns bad JSON", async () => {
    const provider = new FakeProvider();
    provider.queueSuccess("this is not json");
    const service = serviceWith(provider);
    const sessionId = await makeSession("laptop");

    const outcome = await service.assess(sessionId, {
      stage: "initial_assessment",
      question: "What is wrong?",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      throw new Error("expected failure");
    }
    expect(outcome.error.category).toBe("malformed_response");
    expect(outcome.run?.validation_status).toBe("failed");
  });

  it("returns safe errors for unknown sessions and providers", async () => {
    const provider = new FakeProvider();
    const service = serviceWith(provider);

    const missing = await service.assess("55555555-5555-4555-8555-555555555555", {
      stage: "initial_assessment",
      question: "Anything?",
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) {
      throw new Error("expected failure");
    }
    expect(missing.error.category).toBe("not_found");
    expect(missing.run).toBeNull();
    expect(provider.prompts).toHaveLength(0);

    const sessionId = await makeSession("laptop");
    const badProvider = await service.assess(sessionId, {
      stage: "initial_assessment",
      question: "Anything?",
      providerId: "does-not-exist",
    });
    expect(badProvider.ok).toBe(false);
    if (badProvider.ok) {
      throw new Error("expected failure");
    }
    expect(badProvider.error.category).toBe("config");
  });
});
