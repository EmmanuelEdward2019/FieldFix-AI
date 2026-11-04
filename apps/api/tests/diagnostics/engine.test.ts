import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/db/database.js";
import { SessionRepository } from "../../src/db/repositories/sessions.js";
import { HypothesisRepository } from "../../src/db/repositories/hypotheses.js";
import { ObservationRepository } from "../../src/db/repositories/evidence.js";
import { EventRepository } from "../../src/db/repositories/events.js";
import { CitationRepository } from "../../src/db/repositories/citations.js";
import {
  ChunkRepository,
  DocumentRepository,
} from "../../src/db/repositories/documents.js";
import { DiagnosticEngineService } from "../../src/diagnostics/engine.js";
import { SafetyController } from "../../src/safety/controller.js";
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
import { LocalStorageAdapter } from "../../src/storage/local-adapter.js";
import type { StorageAdapter } from "../../src/storage/types.js";
import { setupTestDb, teardownTestDb, truncateAll } from "../db/setup.js";

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
    summary: "Airflow restriction is the leading explanation.",
    observed_evidence: [],
    hypotheses: [],
    recommended_tests: [],
    safety_warnings: [],
    missing_information: [],
    citations: [],
    suggested_next_action: { action: "Inspect the vents.", rationale: null },
    ...overrides,
  });
}

function hypothesis(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    title: "Dust-clogged heatsink",
    description: null,
    confidence: "medium",
    confidence_rationale: null,
    assessment_status: "supported",
    supporting_evidence: [],
    contradicting_evidence: [],
    affected_components: [],
    ...overrides,
  };
}

function recommendedTest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "Vent inspection",
    objective: "Confirm airflow restriction.",
    instructions: ["Power off.", "Inspect vents."],
    safety_notes: null,
    required_tools: [],
    result_options: ["dusty", "clear"],
    ...overrides,
  };
}

/** Scripted stand-in for MetaModelAdapter. No network. */
class FakeProvider implements ModelProvider {
  readonly id = "fake-meta";
  readonly modalities: readonly CallModality[] = ["text", "image"];
  private script: Array<{ ok: true; text: string } | { ok: false; error: ModelError }> = [];
  private cursor = 0;

  queueSuccess(text: string): void {
    this.script.push({ ok: true, text });
  }

  queueFailure(error: ModelError): void {
    this.script.push({ ok: false, error });
  }

  async complete(prompt: ProviderPrompt): Promise<ProviderTextResult> {
    void prompt;
    const step = this.script[this.cursor];
    this.cursor += 1;
    if (!step) {
      throw new ModelError("unavailable", "Fake provider script exhausted.");
    }
    if (!step.ok) {
      throw step.error;
    }
    return { text: step.text, model: "fake-meta-1", latencyMs: 5, attempts: 1 };
  }
}

describe("DiagnosticEngineService", () => {
  let db: Kysely<Database>;
  let storageDir: string;
  let storage: StorageAdapter;
  let provider: FakeProvider;
  let engine: DiagnosticEngineService;

  beforeAll(async () => {
    db = await setupTestDb();
    storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-engine-"));
    storage = new LocalStorageAdapter(storageDir);
  });

  afterAll(async () => {
    await teardownTestDb(db);
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAll(db);
    provider = new FakeProvider();
    const providers = new ModelProviderRegistry();
    providers.register(provider, { isDefault: true });
    const reasoning = new DiagnosticReasoningService({
      db,
      storage,
      providers,
      defaultProviderId: provider.id,
      meta: META,
    });
    engine = new DiagnosticEngineService({
      db,
      reasoning,
      safety: new SafetyController(db),
    });
  });

  async function makeSession(userMode: "everyday" | "technician" = "everyday"): Promise<string> {
    const session = await new SessionRepository(db).create({
      device_type: "laptop",
      manufacturer: "Acme",
      symptoms: "Laptop overheats and shuts down under load.",
      user_mode: userMode,
      access_token_hash: `hash-${userMode}-${Math.random()}`,
    });
    return session.id;
  }

  it("runs the full loop: analyze, propose, record, reassess, report", async () => {
    const sessionId = await makeSession();
    provider.queueSuccess(
      assessmentBody({
        hypotheses: [
          hypothesis({
            supporting_evidence: [
              { statement: "User reports a loud fan.", provenance: "user_reported", source_ref: null },
            ],
            contradicting_evidence: [
              { statement: "No temperature readings yet.", provenance: "inferred", source_ref: null },
            ],
          }),
        ],
        recommended_tests: [recommendedTest()],
      }),
    );

    const analyzed = await engine.analyze(sessionId, {});
    expect(analyzed.ok).toBe(true);
    if (!analyzed.ok) {
      throw new Error("expected analysis to succeed");
    }
    expect(analyzed.hypotheses).toHaveLength(1);
    const created = analyzed.hypotheses[0]!;
    expect(created.status).toBe("supported");
    expect(created.supporting_observations).toHaveLength(1);
    expect(created.contradicting_observations).toHaveLength(1);
    expect(created.supporting_observations[0]?.kind).toBe("observation");

    // Evidence statements became traceable model observations.
    const observations = await new ObservationRepository(db).listBySession(sessionId);
    expect(observations.map((o) => o.body)).toContain(
      "[user_reported] User reports a loud fan.",
    );

    expect(analyzed.tests).toHaveLength(1);
    const test = analyzed.tests[0]!;
    expect(test.safety_classification).toBe("safe");
    expect(test.status).toBe("awaiting_result");
    expect(test.result_options.map((o) => o.value)).toEqual(
      expect.arrayContaining(["option_1", "option_2", "not_sure", "cannot_perform"]),
    );

    // A contradictory result: vents are clear, against the dusty expectation.
    provider.queueSuccess(
      assessmentBody({
        summary: "Vents are clear; the heatsink theory is weakened.",
        hypotheses: [
          hypothesis({ assessment_status: "weakened", confidence: "low" }),
          hypothesis({
            title: "Dried thermal paste",
            assessment_status: "proposed",
            confidence: "medium",
          }),
        ],
        recommended_tests: [
          recommendedTest({
            name: "Temperature check",
            result_options: ["hot", "normal"],
          }),
        ],
        suggested_next_action: { action: "Check idle temperature.", rationale: null },
      }),
    );
    const recorded = await engine.recordResult(sessionId, test.id, {
      selected_option: "option_2",
      observation: "Vents are spotless.",
    });
    expect(recorded.reassessmentApplied).toBe(true);
    expect(recorded.reassessmentError).toBeNull();
    expect(recorded.test.status).toBe("completed");
    const statuses = new Map(recorded.hypotheses.map((h) => [h.title, h.status]));
    expect(statuses.get("Dust-clogged heatsink")).toBe("weakened");
    expect(statuses.get("Dried thermal paste")).toBe("proposed");

    const report = await engine.getReport(sessionId);
    expect(report.status).toBe("ready");
    const data = report.report_data;
    expect(data.symptoms).toContain("overheats");
    expect(data.tests_performed).toHaveLength(1);
    expect(data.tests_performed[0]).toMatchObject({
      result: "option_2",
      observation: "Vents are spotless.",
      source: "user_reported",
    });
    expect(data.remaining_uncertainty).toHaveLength(2);
    expect(data.recommended_next_steps.join(" ")).toContain("Temperature check");
    expect(data.hypotheses.every((h) => h.status !== "verified")).toBe(true);
  });

  it("persists nothing when the model invents citations", async () => {
    const sessionId = await makeSession();
    provider.queueSuccess(
      assessmentBody({
        hypotheses: [hypothesis()],
        recommended_tests: [recommendedTest()],
        citations: [
          {
            document_id: "99999999-9999-4999-8999-999999999999",
            excerpt: "Invented passage.",
            page: 1,
          },
        ],
      }),
    );
    const outcome = await engine.analyze(sessionId, {});
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      throw new Error("expected analysis to fail");
    }
    expect(outcome.error.category).toBe("validation_failed");
    expect(
      await new HypothesisRepository(db).listBySession(sessionId),
    ).toHaveLength(0);
    expect(
      await new ObservationRepository(db).listBySession(sessionId),
    ).toHaveLength(0);
  });

  it("blocks hazardous proposals and refuses their results", async () => {
    const sessionId = await makeSession();
    provider.queueSuccess(
      assessmentBody({
        hypotheses: [hypothesis()],
        recommended_tests: [
          recommendedTest({
            name: "Internal probe",
            objective: "Measure live circuits.",
            instructions: ["Open the chassis and probe live circuits."],
            result_options: ["spark", "no spark"],
          }),
          recommendedTest({ name: "Vent inspection" }),
        ],
      }),
    );
    const analyzed = await engine.analyze(sessionId, {});
    expect(analyzed.ok).toBe(true);
    if (!analyzed.ok) {
      throw new Error("expected analysis to succeed");
    }
    const [blocked, safe] = analyzed.tests;
    expect(blocked?.safety_classification).toBe("blocked");
    expect(blocked?.status).toBe("pending");
    expect(safe?.status).toBe("awaiting_result");

    await expect(
      engine.recordResult(sessionId, blocked?.id as string, { selected_option: "option_1" }),
    ).rejects.toMatchObject({ code: "blocked_test" });
  });

  it("keeps user results unverified; verification is explicit and technician-only", async () => {
    const sessionId = await makeSession("everyday");
    provider.queueSuccess(
      assessmentBody({
        hypotheses: [hypothesis()],
        recommended_tests: [recommendedTest()],
      }),
    );
    // Reassessment after the result: same hypothesis, still supported.
    provider.queueSuccess(
      assessmentBody({
        hypotheses: [hypothesis({ assessment_status: "supported" })],
        recommended_tests: [],
        suggested_next_action: { action: "None.", rationale: null },
      }),
    );
    const analyzed = await engine.analyze(sessionId, {});
    if (!analyzed.ok) {
      throw new Error("expected analysis to succeed");
    }
    const recorded = await engine.recordResult(sessionId, analyzed.tests[0]?.id as string, {
      selected_option: "option_1",
    });
    expect(recorded.hypotheses.every((h) => h.status !== "verified")).toBe(true);

    const hypothesisId = recorded.hypotheses[0]?.id as string;
    await expect(
      engine.verifyHypothesis(sessionId, hypothesisId, "Looks right.", "everyday"),
    ).rejects.toMatchObject({ code: "not_technician" });

    const verified = await engine.verifyHypothesis(
      sessionId,
      hypothesisId,
      "Confirmed with thermal camera in the shop.",
      "technician",
    );
    expect(verified.status).toBe("verified");
    const events = await new EventRepository(db).listBySession(sessionId);
    expect(events.map((e) => e.event_type)).toContain("hypothesis_verified");

    await new HypothesisRepository(db).update(hypothesisId, { status: "ruled_out" });
    await expect(
      engine.verifyHypothesis(sessionId, hypothesisId, "Changed my mind.", "technician"),
    ).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("validates results: unknown test, bad option, duplicates", async () => {
    const sessionId = await makeSession();
    provider.queueSuccess(
      assessmentBody({
        hypotheses: [hypothesis()],
        recommended_tests: [recommendedTest()],
      }),
    );
    provider.queueSuccess(assessmentBody({ hypotheses: [], recommended_tests: [] }));
    const analyzed = await engine.analyze(sessionId, {});
    if (!analyzed.ok) {
      throw new Error("expected analysis to succeed");
    }
    const testId = analyzed.tests[0]?.id as string;

    await expect(
      engine.recordResult(sessionId, "12345678-1234-4123-8123-123456789012", {
        selected_option: "option_1",
      }),
    ).rejects.toMatchObject({ code: "test_not_found" });
    await expect(
      engine.recordResult(sessionId, testId, { selected_option: "made_up_option" }),
    ).rejects.toMatchObject({ code: "invalid_option" });

    await engine.recordResult(sessionId, testId, { selected_option: "option_1" });
    await expect(
      engine.recordResult(sessionId, testId, { selected_option: "option_2" }),
    ).rejects.toMatchObject({ code: "result_exists" });
  });

  it("records the result but skips reassessment when the model fails", async () => {
    const sessionId = await makeSession();
    provider.queueSuccess(
      assessmentBody({
        hypotheses: [hypothesis()],
        recommended_tests: [recommendedTest()],
      }),
    );
    provider.queueFailure(new ModelError("unavailable", "Provider down."));
    const analyzed = await engine.analyze(sessionId, {});
    if (!analyzed.ok) {
      throw new Error("expected analysis to succeed");
    }
    const recorded = await engine.recordResult(sessionId, analyzed.tests[0]?.id as string, {
      selected_option: "option_1",
    });
    expect(recorded.reassessmentApplied).toBe(false);
    expect(recorded.reassessmentError).toContain("Provider down");
    expect(recorded.result.selected_option).toBe("option_1");
  });

  it("refuses analysis in critical stop", async () => {
    const sessionId = await makeSession();
    await new SessionRepository(db).updateSafetyState(sessionId, "critical_stop");
    await expect(engine.analyze(sessionId, {})).rejects.toMatchObject({
      code: "safety_block",
    });
    expect(
      await new HypothesisRepository(db).listBySession(sessionId),
    ).toHaveLength(0);
  });

  it("parks cannot-perform results as skipped", async () => {
    const sessionId = await makeSession();
    provider.queueSuccess(
      assessmentBody({
        hypotheses: [hypothesis()],
        recommended_tests: [recommendedTest()],
      }),
    );
    provider.queueSuccess(assessmentBody({ hypotheses: [], recommended_tests: [] }));
    const analyzed = await engine.analyze(sessionId, {});
    if (!analyzed.ok) {
      throw new Error("expected analysis to succeed");
    }
    const recorded = await engine.recordResult(sessionId, analyzed.tests[0]?.id as string, {
      selected_option: "cannot_perform",
      observation: "No screwdriver available.",
    });
    expect(recorded.test.status).toBe("skipped");
  });

  it("skips duplicate test proposals instead of twinning the checklist", async () => {
    const sessionId = await makeSession();
    provider.queueSuccess(
      assessmentBody({
        hypotheses: [hypothesis()],
        recommended_tests: [recommendedTest()],
      }),
    );
    // Reassessment re-proposes the same test plus a genuinely new one.
    provider.queueSuccess(
      assessmentBody({
        hypotheses: [hypothesis({ assessment_status: "supported" })],
        recommended_tests: [recommendedTest(), recommendedTest({ name: "Temperature check" })],
      }),
    );
    const first = await engine.analyze(sessionId, {});
    expect(first.ok).toBe(true);
    const second = await engine.analyze(sessionId, { stage: "reassessment" });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      throw new Error("expected reassessment to succeed");
    }
    expect(second.tests.map((t) => t.name)).toEqual(["Temperature check"]);
    expect(second.warnings.join(" ")).toContain("duplicate");
  });

  it("cites manual passages on the leading hypothesis during analysis", async () => {
    const sessionId = await makeSession();
    const doc = await new DocumentRepository(db).create({
      title: "Acme Cooling Service Notes",
      manufacturer: "Acme",
      model_numbers: [],
      document_type: "service_manual",
      source_name: "engine test fixture",
      language: "en",
      permission_status: "approved",
    });
    await new ChunkRepository(db).create(
      doc.id,
      {
        chunk_index: 0,
        content:
          "A clogged heatsink restricts airflow through the vents, causing overheating shutdowns under load. Clean the fins before replacing parts.",
        safety_tags: [],
        component_tags: [],
        model_applicability: [],
      },
    );
    await new DocumentRepository(db).updateIngestion(doc.id, {
      ingestion_status: "indexed",
      permission_status: "approved",
    });
    provider.queueSuccess(
      assessmentBody({
        hypotheses: [hypothesis()],
        recommended_tests: [recommendedTest()],
      }),
    );
    const analyzed = await engine.analyze(sessionId, {});
    expect(analyzed.ok).toBe(true);
    const citations = await new CitationRepository(db).listBySession(sessionId);
    expect(citations).toHaveLength(1);
    expect(citations[0]?.note).toContain("Auto-consulted");
    expect(citations[0]?.excerpt).toContain("clogged heatsink");
  });

  it("analyses cleanly when no manual matches the session", async () => {
    const sessionId = await makeSession();
    provider.queueSuccess(
      assessmentBody({
        hypotheses: [hypothesis()],
        recommended_tests: [recommendedTest()],
      }),
    );
    const analyzed = await engine.analyze(sessionId, {});
    expect(analyzed.ok).toBe(true);
    if (!analyzed.ok) {
      throw new Error("expected analysis to succeed");
    }
    expect(
      await new CitationRepository(db).listBySession(sessionId),
    ).toHaveLength(0);
    expect(analyzed.warnings.join(" ")).not.toContain("Manual consultation skipped");
  });
});
