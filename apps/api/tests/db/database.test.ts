import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import {
  createChunkSchema,
  createDiagnosticTestSchema,
  createDocumentSchema,
  createHypothesisSchema,
  type CreateDiagnosticTest,
  type CreateDocument,
  type CreateEvidenceFile,
  type CreateHypothesis,
  type ReportData,
} from "@fieldfix/contracts";
import type { Database } from "../../src/db/database.js";
import type { CreateSessionInput } from "../../src/db/repositories/index.js";
import {
  AnnotationRepository,
  ChunkRepository,
  CitationRepository,
  DiagnosticTestRepository,
  DocumentRepository,
  EventRepository,
  EvidenceFileRepository,
  HypothesisRepository,
  ModelRunRepository,
  ObservationRepository,
  ReportRepository,
  SafetyEventRepository,
  SessionRepository,
  TestResultRepository,
  searchChunks,
} from "../../src/db/repositories/index.js";
import {
  recordSafetyTransition,
  recordTestResult,
} from "../../src/db/workflows.js";
import { setupTestDb, teardownTestDb, truncateAll } from "./setup.js";

let db: Kysely<Database>;

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb(db);
});

beforeEach(async () => {
  await truncateAll(db);
});

const sessionInput: CreateSessionInput = {
  device_type: "laptop",
  symptoms: "Will not power on.",
  user_mode: "everyday",
  access_token_hash: "test-token-hash",
};

const fileInput: CreateEvidenceFile = {
  storage_key: "test/no-power.jpg",
  media_type: "image/jpeg",
  byte_size: 1024,
  kind: "image",
};

const hypothesisInput: CreateHypothesis = createHypothesisSchema.parse({
  title: "Faulty AC adapter",
  confidence_label: "medium",
});

const testInput: CreateDiagnosticTest = createDiagnosticTestSchema.parse({
  name: "Verify the AC adapter",
  objective: "Rule out a dead adapter.",
  skill_level: "beginner",
  instructions: [{ step: 1, text: "Check the adapter LED." }],
  result_options: [
    { value: "led-on", label: "LED is on" },
    { value: "led-off", label: "LED stays off" },
  ],
});

const docInput: CreateDocument = createDocumentSchema.parse({
  title: "Test Manual",
  document_type: "service_manual",
  source_name: "test",
  permission_status: "approved",
});

describe("sessions", () => {
  it("round-trips a session and cascades deletes to session children", async () => {
    const sessions = new SessionRepository(db);
    const files = new EvidenceFileRepository(db);
    const observations = new ObservationRepository(db);
    const annotations = new AnnotationRepository(db);
    const hypotheses = new HypothesisRepository(db);
    const tests = new DiagnosticTestRepository(db);
    const results = new TestResultRepository(db);
    const events = new EventRepository(db);
    const citations = new CitationRepository(db);
    const safety = new SafetyEventRepository(db);
    const reports = new ReportRepository(db);
    const runs = new ModelRunRepository(db);
    const documents = new DocumentRepository(db);
    const chunks = new ChunkRepository(db);

    const session = await sessions.create({ ...sessionInput });
    expect(session.device_type).toBe("laptop");
    expect(session.status).toBe("open");
    expect(session.safety_state).toBe("normal");
    await expect(sessions.getById(session.id)).resolves.toMatchObject({
      id: session.id,
      symptoms: "Will not power on.",
    });

    const file = await files.create(session.id, { ...fileInput });
    const obs = await observations.create(session.id, {
      source: "user",
      body: "No lights.",
    });
    expect(obs.evidence_file_id).toBeNull();
    await annotations.create({
      evidence_file_id: file.id,
      kind: "box",
      coordinates: { x: 1, y: 2, width: 10, height: 10 },
      producer: "test",
      image_width: 100,
      image_height: 100,
    });
    const hypothesis = await hypotheses.create(session.id, {
      ...hypothesisInput,
    });
    await hypotheses.linkEvidence(hypothesis.id, {
      evidence_file_id: file.id,
    });
    const test = await tests.create(session.id, { ...testInput });
    await results.create({
      test_id: test.id,
      session_id: session.id,
      selected_option: "led-off",
    });
    await events.append(session.id, {
      event_type: "session_created",
      payload: {},
    });
    const doc = await documents.create({
      ...docInput,
      permission_status: "approved",
    });
    await documents.updateIngestion(doc.id, { ingestion_status: "indexed" });
    const chunk = await chunks.create(
      doc.id,
      createChunkSchema.parse({
        chunk_index: 0,
        content: "Check the adapter LED.",
      }),
    );
    await citations.create(session.id, {
      hypothesis_id: hypothesis.id,
      chunk_id: chunk.id,
      excerpt: "Check the adapter LED.",
    });
    await safety.append(session.id, {
      previous_state: "normal",
      new_state: "caution",
      trigger_type: "policy_rule",
      safe_next_steps: "Proceed carefully.",
    });
    await reports.create(session.id, {
      status: "draft",
      report_data: {
        device: {
          device_type: "laptop",
          manufacturer: null,
          model: null,
          operating_system: null,
        },
        symptoms: session.symptoms,
        evidence_ids: [],
        observable_facts: [],
        hypotheses: [],
        tests_performed: [],
        sources: [],
        remaining_uncertainty: [],
        recommended_next_steps: [],
        safety_summary: [],
      },
    });
    await runs.create({
      session_id: session.id,
      provider: "meta",
      model_id: "test-model",
      task_type: "diagnosis",
      origin: "eval",
    });

    await sessions.remove(session.id);

    await expect(files.listBySession(session.id)).resolves.toEqual([]);
    await expect(observations.listBySession(session.id)).resolves.toEqual([]);
    await expect(annotations.listByFile(file.id)).resolves.toEqual([]);
    await expect(hypotheses.listBySession(session.id)).resolves.toEqual([]);
    await expect(
      hypotheses.listEvidenceLinks(hypothesis.id),
    ).resolves.toEqual([]);
    await expect(tests.listBySession(session.id)).resolves.toEqual([]);
    await expect(results.listBySession(session.id)).resolves.toEqual([]);
    await expect(events.listBySession(session.id)).resolves.toEqual([]);
    await expect(citations.listBySession(session.id)).resolves.toEqual([]);
    await expect(safety.listBySession(session.id)).resolves.toEqual([]);
    await expect(reports.listBySession(session.id)).resolves.toEqual([]);
    await expect(runs.listBySession(session.id)).resolves.toEqual([]);
    // Knowledge base rows are not session children: they survive.
    await expect(documents.getById(doc.id)).resolves.toMatchObject({
      id: doc.id,
    });
    await expect(chunks.listByDocument(doc.id)).resolves.toHaveLength(1);
  });
});

describe("evidence constraints", () => {
  it("rejects duplicate storage keys and invalid column values", async () => {
    const sessions = new SessionRepository(db);
    const files = new EvidenceFileRepository(db);
    const session = await sessions.create({ ...sessionInput });

    await files.create(session.id, { ...fileInput });
    await expect(
      files.create(session.id, { ...fileInput }),
    ).rejects.toThrow();

    await expect(
      db
        .insertInto("evidence_files")
        .values({
          session_id: session.id,
          storage_key: "test/other.jpg",
          media_type: "image/jpeg",
          byte_size: 10,
          kind: "pdf" as "image",
        })
        .execute(),
    ).rejects.toThrow();
  });
});

describe("recordTestResult", () => {
  it("persists result, hypothesis updates, and event atomically", async () => {
    const sessions = new SessionRepository(db);
    const hypotheses = new HypothesisRepository(db);
    const tests = new DiagnosticTestRepository(db);
    const results = new TestResultRepository(db);
    const events = new EventRepository(db);

    const session = await sessions.create({ ...sessionInput });
    const h1 = await hypotheses.create(session.id, { ...hypothesisInput });
    const h2 = await hypotheses.create(session.id, {
      ...hypothesisInput,
      title: "Dead board",
    });
    const test = await tests.create(session.id, { ...testInput });

    const { result, test: updated } = await recordTestResult(db, {
      session_id: session.id,
      test_id: test.id,
      result: { selected_option: "led-off", observation: "Dark." },
      hypothesis_updates: [
        { id: h1.id, patch: { status: "supported" } },
        { id: h2.id, patch: { status: "weakened" } },
      ],
    });

    expect(result.selected_option).toBe("led-off");
    expect(updated.status).toBe("completed");
    await expect(results.getByTestId(test.id)).resolves.toMatchObject({
      id: result.id,
    });
    await expect(hypotheses.getById(h1.id)).resolves.toMatchObject({
      status: "supported",
    });
    await expect(hypotheses.getById(h2.id)).resolves.toMatchObject({
      status: "weakened",
    });
    const logged = await events.listBySession(session.id);
    expect(logged.map((e) => e.event_type)).toContain("test_result_recorded");
  });

  it("rolls back the result when a hypothesis update fails", async () => {
    const sessions = new SessionRepository(db);
    const hypotheses = new HypothesisRepository(db);
    const tests = new DiagnosticTestRepository(db);
    const results = new TestResultRepository(db);
    const events = new EventRepository(db);

    const session = await sessions.create({ ...sessionInput });
    const other = await sessions.create({ ...sessionInput });
    const foreign = await hypotheses.create(other.id, { ...hypothesisInput });
    const test = await tests.create(session.id, { ...testInput });

    await expect(
      recordTestResult(db, {
        session_id: session.id,
        test_id: test.id,
        result: { selected_option: "led-off" },
        hypothesis_updates: [{ id: foreign.id, patch: { status: "supported" } }],
      }),
    ).rejects.toThrow(/does not belong to session/);

    await expect(results.getByTestId(test.id)).resolves.toBeUndefined();
    await expect(tests.getById(test.id)).resolves.toMatchObject({
      status: "pending",
    });
    await expect(events.listBySession(session.id)).resolves.toEqual([]);
  });
});

describe("knowledge search", () => {
  it("finds approved indexed chunks and skips pending documents", async () => {
    const documents = new DocumentRepository(db);
    const chunks = new ChunkRepository(db);

    const live = await documents.create({
      ...docInput,
      permission_status: "approved",
    });
    await documents.updateIngestion(live.id, { ingestion_status: "indexed" });
    await chunks.create(
      live.id,
      createChunkSchema.parse({
        chunk_index: 0,
        page_number: 42,
        heading: "Power troubleshooting",
        content: "A dark adapter LED points to the adapter or cable.",
      }),
    );

    const pending = await documents.create({
      ...docInput,
      title: "Pending Manual",
      permission_status: "pending",
    });
    await documents.updateIngestion(pending.id, {
      ingestion_status: "indexed",
    });
    await chunks.create(
      pending.id,
      createChunkSchema.parse({
        chunk_index: 0,
        content: "Adapter LED adapter LED adapter.",
      }),
    );

    const hits = await searchChunks(db, { query: "adapter LED", limit: 10 });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      document_title: "Test Manual",
      page_number: 42,
      heading: "Power troubleshooting",
    });
    expect(hits[0]?.excerpt.toLowerCase()).toContain("adapter");
    expect(hits[0]?.rank).toBeGreaterThan(0);
  });

  it("rejects duplicate checksums and orphan citations", async () => {
    const sessions = new SessionRepository(db);
    const documents = new DocumentRepository(db);
    const chunks = new ChunkRepository(db);
    const citations = new CitationRepository(db);

    const checksum = "d".repeat(64);
    await documents.create({
      ...docInput,
      permission_status: "approved",
      checksum_sha256: checksum,
    });
    await expect(
      documents.create({
        ...docInput,
        title: "Duplicate",
        permission_status: "approved",
        checksum_sha256: checksum,
      }),
    ).rejects.toThrow();

    const session = await sessions.create({ ...sessionInput });
    const doc = await documents.create({
      ...docInput,
      title: "Cited",
      permission_status: "approved",
    });
    const chunk = await chunks.create(
      doc.id,
      createChunkSchema.parse({
        chunk_index: 0,
        content: "Some content.",
      }),
    );
    await expect(
      citations.create(session.id, {
        hypothesis_id: null,
        test_id: null,
        chunk_id: chunk.id,
        excerpt: "Orphan.",
      }),
    ).rejects.toThrow();
  });
});

describe("append-only logs", () => {
  it("rejects updates and deletes on events and safety logs", async () => {
    const sessions = new SessionRepository(db);
    const events = new EventRepository(db);
    const safety = new SafetyEventRepository(db);

    const session = await sessions.create({ ...sessionInput });
    const event = await events.append(session.id, {
      event_type: "session_created",
      payload: {},
    });
    const safetyEvent = await safety.append(session.id, {
      previous_state: "normal",
      new_state: "caution",
      trigger_type: "policy_rule",
      safe_next_steps: "Careful.",
    });

    await expect(
      db
        .updateTable("diagnostic_events")
        .set({ event_type: "rewritten" })
        .where("id", "=", event.id)
        .execute(),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.deleteFrom("diagnostic_events").where("id", "=", event.id).execute(),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.deleteFrom("safety_events").where("id", "=", safetyEvent.id).execute(),
    ).rejects.toThrow(/append-only/);
  });
});

describe("recordSafetyTransition", () => {
  it("moves safety state and audits the transition atomically", async () => {
    const sessions = new SessionRepository(db);
    const safety = new SafetyEventRepository(db);
    const events = new EventRepository(db);

    const session = await sessions.create({ ...sessionInput });
    const { session: moved, safety_event } = await recordSafetyTransition(db, {
      session_id: session.id,
      event: {
        previous_state: "normal",
        new_state: "critical_stop",
        trigger_type: "user_report",
        trigger_detail: "Swollen battery suspected.",
        blocked_action: "troubleshooting_checklist",
        safe_next_steps: "Stop using the device.",
      },
    });

    expect(moved.safety_state).toBe("critical_stop");
    expect(safety_event.new_state).toBe("critical_stop");
    await expect(safety.getLatest(session.id)).resolves.toMatchObject({
      id: safety_event.id,
    });
    const logged = await events.listBySession(session.id);
    expect(logged.map((e) => e.event_type)).toContain("safety_state_changed");
  });
});

describe("reports and model runs", () => {
  it("returns the latest report and tracks run completion", async () => {
    const sessions = new SessionRepository(db);
    const reports = new ReportRepository(db);
    const runs = new ModelRunRepository(db);

    const session = await sessions.create({ ...sessionInput });
    const base: ReportData = {
      device: {
        device_type: "laptop",
        manufacturer: null,
        model: null,
        operating_system: null,
      },
      symptoms: session.symptoms,
      evidence_ids: [],
      observable_facts: [],
      hypotheses: [],
      tests_performed: [],
      sources: [],
      remaining_uncertainty: [],
      recommended_next_steps: [],
      safety_summary: [],
    };
    const first = await reports.create(session.id, {
      status: "draft",
      report_data: { ...base },
    });
    const second = await reports.create(session.id, {
      status: "ready",
      report_data: { ...base },
    });
    expect(first.status).toBe("draft");
    await expect(reports.getLatest(session.id)).resolves.toMatchObject({
      id: second.id,
      status: "ready",
    });

    const run = await runs.create({
      session_id: session.id,
      provider: "meta",
      model_id: "muse-spark",
      task_type: "diagnosis",
      origin: "live",
    });
    expect(run.status).toBe("pending");
    await expect(
      runs.update(run.id, { status: "succeeded", latency_ms: 900 }),
    ).resolves.toMatchObject({ status: "succeeded", latency_ms: 900 });
    await expect(runs.listBySession(session.id)).resolves.toHaveLength(1);
  });
});
