import type { Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/db/database.js";
import { SessionRepository } from "../../src/db/repositories/sessions.js";
import { ModelRunRepository } from "../../src/db/repositories/model-runs.js";
import { setupTestDb, teardownTestDb, truncateAll } from "../db/setup.js";

/**
 * Model-run observability persistence (migration 006 columns), against
 * a real PostgreSQL test database. Fails fast without DATABASE_URL_TEST.
 */
describe("ModelRunRepository observability", () => {
  let db: Kysely<Database>;
  let sessions: SessionRepository;
  let runs: ModelRunRepository;

  beforeAll(async () => {
    db = await setupTestDb();
    sessions = new SessionRepository(db);
    runs = new ModelRunRepository(db);
  });

  afterAll(async () => {
    await teardownTestDb(db);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  async function makeSession(): Promise<string> {
    const session = await sessions.create({
      device_type: "laptop",
      symptoms: "Overheats under load.",
      user_mode: "everyday",
      access_token_hash: "hash-for-observability-tests",
    });
    return session.id;
  }

  it("defaults a new run to pending with empty modality", async () => {
    const sessionId = await makeSession();
    const run = await runs.create({
      session_id: sessionId,
      provider: "meta",
      model_id: "muse-spark-1.3",
      task_type: "diagnosis",
      origin: "live",
      request_id: "trace-1",
    });
    expect(run.status).toBe("pending");
    expect(run.validation_status).toBe("pending");
    expect(run.input_modality).toEqual([]);
    expect(run.request_id).toBe("trace-1");
    expect(run.created_at).toBeInstanceOf(Date);
  });

  it("records success metadata: latency, tokens, stage, modality, response id", async () => {
    const sessionId = await makeSession();
    const run = await runs.create({
      session_id: sessionId,
      provider: "meta",
      model_id: "muse-spark-1.3",
      task_type: "diagnosis",
      origin: "live",
      request_id: "trace-2",
    });
    const finished = await runs.update(run.id, {
      status: "succeeded",
      latency_ms: 1840,
      prompt_tokens: 1200,
      completion_tokens: 410,
      diagnostic_stage: "reassessment",
      input_modality: ["text", "image"],
      validation_status: "passed",
      provider_response_id: "resp_abc123",
    });
    expect(finished?.status).toBe("succeeded");
    expect(finished?.latency_ms).toBe(1840);
    expect(finished?.prompt_tokens).toBe(1200);
    expect(finished?.completion_tokens).toBe(410);
    expect(finished?.diagnostic_stage).toBe("reassessment");
    expect(finished?.input_modality).toEqual(["text", "image"]);
    expect(finished?.validation_status).toBe("passed");
    expect(finished?.provider_response_id).toBe("resp_abc123");

    const reread = await runs.getById(run.id);
    expect(reread?.status).toBe("succeeded");
    expect(reread?.input_modality).toEqual(["text", "image"]);
    // Unmentioned columns survive the update (no wipe-to-null).
    expect(finished?.request_id).toBe("trace-2");
  });

  it("records failure metadata with error category and message", async () => {
    const sessionId = await makeSession();
    const run = await runs.create({
      session_id: sessionId,
      provider: "meta",
      model_id: "muse-spark-1.3",
      task_type: "diagnosis",
      origin: "live",
    });
    const finished = await runs.update(run.id, {
      status: "failed",
      error_category: "rate_limited",
      error_message: "Rate limited by the provider.",
      diagnostic_stage: "initial_assessment",
      validation_status: "not_applicable",
    });
    expect(finished?.status).toBe("failed");
    expect(finished?.error_category).toBe("rate_limited");
    expect(finished?.validation_status).toBe("not_applicable");
  });

  it("lists runs per session in creation order", async () => {
    const sessionId = await makeSession();
    const first = await runs.create({
      session_id: sessionId,
      provider: "meta",
      model_id: "muse-spark-1.3",
      task_type: "diagnosis",
      origin: "live",
    });
    const second = await runs.create({
      session_id: sessionId,
      provider: "meta",
      model_id: "muse-spark-1.3",
      task_type: "diagnosis",
      origin: "live",
    });
    const listed = await runs.listBySession(sessionId);
    expect(listed.map((r) => r.id)).toEqual([first.id, second.id]);
  });
});
