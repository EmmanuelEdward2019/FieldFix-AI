import "dotenv/config";
import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import {
  createAnnotationSchema,
  createCitationSchema,
  createChunkSchema,
  createDiagnosticTestSchema,
  createDocumentSchema,
  createEvidenceFileSchema,
  createHypothesisSchema,
  createModelRunSchema,
  createObservationSchema,
  createReportSchema,
  createSafetyEventSchema,
  createSessionSchema,
  diagnosticEventSchema,
  recordTestResultSchema,
  updateModelRunSchema,
} from "@fieldfix/contracts";
import { closeDb, createDb, type Database } from "./database.js";
import { ChunkRepository, DocumentRepository } from "./repositories/documents.js";
import { CitationRepository } from "./repositories/citations.js";
import {
  AnnotationRepository,
  EvidenceFileRepository,
  ObservationRepository,
} from "./repositories/evidence.js";
import { EventRepository } from "./repositories/events.js";
import { HypothesisRepository } from "./repositories/hypotheses.js";
import { ModelRunRepository } from "./repositories/model-runs.js";
import { ReportRepository } from "./repositories/reports.js";
import { SessionRepository } from "./repositories/sessions.js";
import { DiagnosticTestRepository } from "./repositories/tests.js";
import { recordSafetyTransition, recordTestResult } from "./workflows.js";

function demoTokenHash(label: string): string {
  return createHash("sha256").update(`fieldfix-demo:${label}`).digest("hex");
}

const CHECKSUMS = {
  docA: "a".repeat(64),
  docB: "b".repeat(64),
  fileA: "c".repeat(64),
};

/**
 * Reset demo content (rows flagged is_demo / origin demo) and insert the
 * two hackathon demo scenarios plus their knowledge base. All content is
 * fictional and clearly flagged; seed inputs are validated with the
 * shared contracts before insert.
 */
export async function runSeed(db: Kysely<Database>): Promise<void> {
  // Reset first: sessions cascade to their children, documents to chunks.
  // Citations reference chunks with NO ACTION, so sessions go first.
  await db.deleteFrom("diagnostic_sessions").where("is_demo", "=", true).execute();
  await db.deleteFrom("technical_documents").where("is_demo", "=", true).execute();

  const documents = new DocumentRepository(db);
  const chunks = new ChunkRepository(db);

  const docA = await documents.create({
    ...createDocumentSchema.parse({
      title: "AcmeBook Pro 14 Service Manual (demo excerpt)",
      manufacturer: "Acme",
      device_family: "AcmeBook",
      model_numbers: ["AcmeBook Pro 14"],
      document_type: "service_manual",
      source_name: "FieldFix demo seed (fictional)",
      version: "demo-1",
      licence_name: "Fictional demo content — not for redistribution",
      permission_status: "approved",
      checksum_sha256: CHECKSUMS.docA,
    }),
    is_demo: true,
  });
  const docAChunks = [
    {
      chunk_index: 0,
      page_number: 42,
      heading: "Power troubleshooting",
      content:
        "If the unit shows no signs of life, first verify the AC adapter: the LED on the adapter brick should glow steadily when plugged into a known-good outlet. A dark LED points to the adapter or cable rather than the system board.",
    },
    {
      chunk_index: 1,
      page_number: 87,
      heading: "Battery calibration",
      content:
        "Charge to 100 percent, then discharge to automatic shutdown before recharging uninterrupted. Recalibrate only with the manufacturer-supplied adapter.",
    },
    {
      chunk_index: 2,
      page_number: 3,
      heading: "Safety warnings",
      content:
        "Never open the chassis while connected to AC power. If the battery is deformed or unusually hot, stop and follow the battery safety procedure.",
      safety_tags: ["battery", "heat"],
    },
  ];
  for (const chunk of docAChunks) {
    await chunks.create(docA.id, createChunkSchema.parse(chunk));
  }
  await documents.updateIngestion(docA.id, {
    ingestion_status: "indexed",
    permission_status: "approved",
  });

  const docB = await documents.create({
    ...createDocumentSchema.parse({
      title: "Acme Phone 12 Safety Notice (demo excerpt)",
      manufacturer: "Acme",
      device_family: "Acme Phone",
      model_numbers: ["Acme Phone 12"],
      document_type: "safety_notice",
      source_name: "FieldFix demo seed (fictional)",
      version: "demo-1",
      licence_name: "Fictional demo content — not for redistribution",
      permission_status: "approved",
      checksum_sha256: CHECKSUMS.docB,
    }),
    is_demo: true,
  });
  const docBChunks = [
    {
      chunk_index: 0,
      page_number: 1,
      heading: "Swollen battery warning",
      content:
        "If the screen or back cover is lifting away from the frame, the battery may be swelling. Stop using and charging the device, do not press or puncture it, and seek qualified help.",
      safety_tags: ["battery", "swelling"],
    },
    {
      chunk_index: 1,
      page_number: 5,
      heading: "Charging guidance",
      content:
        "Use only the supplied charger. Unplug if the device becomes unusually hot while charging and let it cool before handling.",
    },
  ];
  for (const chunk of docBChunks) {
    await chunks.create(docB.id, createChunkSchema.parse(chunk));
  }
  await documents.updateIngestion(docB.id, {
    ingestion_status: "indexed",
    permission_status: "approved",
  });

  await seedLaptopScenario(db, docA.id);
  await seedSwollenBatteryScenario(db);
}

async function seedLaptopScenario(
  db: Kysely<Database>,
  docAId: string,
): Promise<void> {
  const sessions = new SessionRepository(db);
  const files = new EvidenceFileRepository(db);
  const observations = new ObservationRepository(db);
  const annotations = new AnnotationRepository(db);
  const hypotheses = new HypothesisRepository(db);
  const tests = new DiagnosticTestRepository(db);
  const events = new EventRepository(db);
  const citations = new CitationRepository(db);
  const reports = new ReportRepository(db);
  const runs = new ModelRunRepository(db);

  const session = await sessions.create({
    ...createSessionSchema.parse({
      device_type: "laptop",
      manufacturer: "Acme",
      model: "AcmeBook Pro 14",
      symptoms:
        "Laptop will not power on. No lights, no fan noise when pressing the power button.",
      problem_started_note: "This morning; worked fine yesterday.",
      user_mode: "everyday",
    }),
    access_token_hash: demoTokenHash("laptop-session"),
    is_demo: true,
  });
  await sessions.updateStatus(session.id, "in_progress");
  await events.append(
    session.id,
    diagnosticEventSchema.parse({
      event_type: "session_created",
      payload: { device_type: "laptop", model: "AcmeBook Pro 14" },
    }),
  );

  const file = await files.create(
    session.id,
    createEvidenceFileSchema.parse({
      storage_key: "demo/acmebook/no-power.jpg",
      media_type: "image/jpeg",
      byte_size: 184320,
      original_filename: "acmebook-no-power.jpg",
      kind: "image",
      checksum_sha256: CHECKSUMS.fileA,
    }),
  );
  await files.setProcessing(file.id, "ready");

  const userObs = await observations.create(
    session.id,
    createObservationSchema.parse({
      source: "user",
      body: "No lights or sounds when pressing the power button.",
    }),
  );
  const modelObs = await observations.create(
    session.id,
    createObservationSchema.parse({
      evidence_file_id: file.id,
      source: "model",
      body: "The AC adapter LED appears dark in the uploaded photo.",
    }),
  );

  const run = await runs.create(
    createModelRunSchema.parse({
      session_id: session.id,
      provider: "meta",
      model_id: "muse-spark-demo",
      task_type: "diagnosis",
      origin: "demo",
      request_id: "demo-req-laptop-1",
    }),
  );
  await runs.update(
    run.id,
    updateModelRunSchema.parse({ status: "succeeded", latency_ms: 1200 }),
  );

  await annotations.create(
    createAnnotationSchema.parse({
      evidence_file_id: file.id,
      kind: "box",
      coordinates: { x: 820, y: 540, width: 120, height: 60 },
      label: "AC adapter LED",
      producer: "sam-3.1",
      image_width: 1280,
      image_height: 720,
      model_run_id: run.id,
    }),
  );

  const h1 = await hypotheses.create(
    session.id,
    createHypothesisSchema.parse({
      title: "Faulty AC adapter or charging cable",
      description: "No power reaches the unit, consistent with a dead adapter.",
      supporting_observations: [
        {
          kind: "evidence_file",
          id: file.id,
          note: "Adapter LED dark in photo",
        },
        { kind: "observation", id: modelObs.id, note: modelObs.body },
      ],
      confidence_label: "medium",
      confidence_rationale: "Dark LED plus total absence of life.",
    }),
  );
  const h2 = await hypotheses.create(
    session.id,
    createHypothesisSchema.parse({
      title: "Failed system-board power circuit",
      supporting_observations: [
        {
          kind: "observation",
          id: userObs.id,
          note: "Complete absence of response",
        },
      ],
      contradicting_observations: [
        { kind: "note", id: null, note: "No prior instability reported" },
      ],
      confidence_label: "low",
      confidence_rationale: "Possible but less likely before adapter is ruled out.",
    }),
  );
  await hypotheses.linkEvidence(h1.id, {
    evidence_file_id: file.id,
    observation_id: null,
  });

  const t1 = await tests.create(
    session.id,
    createDiagnosticTestSchema.parse({
      name: "Verify the AC adapter",
      objective: "Rule out a dead adapter or cable before suspecting the board.",
      rationale: "A dark adapter LED explains every observed symptom.",
      required_tools: ["Known-good power outlet"],
      skill_level: "beginner",
      safety_classification: "safe",
      instructions: [
        { step: 1, text: "Unplug the adapter from the laptop and the wall." },
        { step: 2, text: "Plug it into a known-good outlet." },
        { step: 3, text: "Observe the LED on the adapter brick." },
        { step: 4, text: "Record whether the LED glows steadily." },
      ],
      expected_outcomes: "A working adapter shows a steady LED.",
      result_options: [
        { value: "led-on", label: "LED is on" },
        { value: "led-off", label: "LED stays off" },
        { value: "not-sure", label: "Not sure" },
        { value: "cannot-perform", label: "Cannot perform this test" },
      ],
      position: 0,
    }),
  );
  await tests.create(
    session.id,
    createDiagnosticTestSchema.parse({
      name: "Listen for signs of life",
      objective: "Check for fan or drive activity on power press.",
      skill_level: "beginner",
      safety_classification: "safe",
      instructions: [
        { step: 1, text: "Connect the adapter." },
        { step: 2, text: "Press power and listen closely for 10 seconds." },
      ],
      result_options: [
        { value: "sounds", label: "Heard fan or drive sounds" },
        { value: "silent", label: "Fully silent" },
        { value: "not-sure", label: "Not sure" },
      ],
      position: 1,
    }),
  );

  const { result } = await recordTestResult(db, {
    session_id: session.id,
    test_id: t1.id,
    result: recordTestResultSchema.parse({
      selected_option: "led-off",
      observation: "No light on the brick in a known-good outlet.",
    }),
    hypothesis_updates: [
      { id: h1.id, patch: { status: "supported" } },
      {
        id: h2.id,
        patch: {
          status: "weakened",
          confidence_rationale: "Adapter failure now explains the symptoms.",
        },
      },
    ],
  });

  const docChunks = new ChunkRepository(db);
  const powerChunk = (await docChunks.listByDocument(docAId))[0];
  if (!powerChunk) {
    throw new Error("seed expected chunks for the demo manual");
  }
  const citation = await citations.create(
    session.id,
    createCitationSchema.parse({
      hypothesis_id: h1.id,
      chunk_id: powerChunk.id,
      excerpt:
        "A dark LED points to the adapter or cable rather than the system board.",
      note: "Supports checking the adapter first.",
    }),
  );

  await reports.create(
    session.id,
    createReportSchema.parse({
      status: "draft",
      report_data: {
        device: {
          device_type: "laptop",
          manufacturer: "Acme",
          model: "AcmeBook Pro 14",
          operating_system: null,
        },
        symptoms: session.symptoms,
        evidence_ids: [file.id],
        observable_facts: [
          "No lights or sounds on power press (user-reported).",
          "Adapter LED dark in photo (model-observed).",
        ],
        hypotheses: [
          {
            id: h1.id,
            title: h1.title,
            status: "supported",
            confidence_label: "medium",
          },
          {
            id: h2.id,
            title: h2.title,
            status: "weakened",
            confidence_label: "low",
          },
        ],
        tests_performed: [
          {
            test_id: t1.id,
            name: "Verify the AC adapter",
            result: result.selected_option,
            observation: result.observation,
          },
        ],
        sources: [
          {
            citation_id: citation.id,
            document_title: "AcmeBook Pro 14 Service Manual (demo excerpt)",
            page_number: 42,
            excerpt: citation.excerpt,
          },
        ],
        remaining_uncertainty: [
          "Adapter not yet swapped with a known-good unit.",
        ],
        recommended_next_steps: [
          "Retest with a known-good adapter of the same rating.",
        ],
        safety_summary: [],
      },
    }),
  );
}

async function seedSwollenBatteryScenario(db: Kysely<Database>): Promise<void> {
  const sessions = new SessionRepository(db);
  const reports = new ReportRepository(db);

  const session = await sessions.create({
    ...createSessionSchema.parse({
      device_type: "smartphone",
      manufacturer: "Acme",
      model: "Acme Phone 12",
      symptoms:
        "Back cover is lifting away from the frame and the phone gets hot while charging. Possible swollen battery.",
      problem_started_note: "Noticed two days ago, worse today.",
      recent_events: "Phone was dropped last week.",
      user_mode: "everyday",
    }),
    access_token_hash: demoTokenHash("swollen-battery-session"),
    is_demo: true,
  });

  const { safety_event } = await recordSafetyTransition(db, {
    session_id: session.id,
    event: createSafetyEventSchema.parse({
      previous_state: "normal",
      new_state: "critical_stop",
      trigger_type: "user_report",
      trigger_detail: "User reports lifting back cover plus heat while charging.",
      blocked_action: "troubleshooting_checklist",
      safe_next_steps:
        "Stop using and charging the device. Do not press, puncture, or open it. Seek qualified professional help.",
    }),
  });

  await reports.create(
    session.id,
    createReportSchema.parse({
      status: "draft",
      report_data: {
        device: {
          device_type: "smartphone",
          manufacturer: "Acme",
          model: "Acme Phone 12",
          operating_system: null,
        },
        symptoms: session.symptoms,
        evidence_ids: [],
        observable_facts: [
          "Back cover lifting (user-reported).",
          "Heat while charging (user-reported).",
        ],
        hypotheses: [],
        tests_performed: [],
        sources: [],
        remaining_uncertainty: ["Battery condition unverified by a technician."],
        recommended_next_steps: [
          "Keep the device powered off and seek qualified help.",
        ],
        safety_summary: [
          {
            id: safety_event.id,
            new_state: "critical_stop",
            trigger_type: "user_report",
          },
        ],
      },
    }),
  );
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_DEMO_SEED) {
    console.error(
      "Refusing to seed demo data in production. Set ALLOW_DEMO_SEED=1 to override.",
    );
    process.exitCode = 1;
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env and set it (see docs/DATABASE.md).",
    );
    process.exitCode = 1;
    return;
  }
  const db = createDb(url);
  try {
    await runSeed(db);
    console.log("demo seed complete: laptop + swollen-battery scenarios");
  } finally {
    await closeDb(db);
  }
}

// Only run the CLI when executed directly (importable for tests/tooling).
const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("seed.ts") || process.argv[1].endsWith("seed.js"));
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
