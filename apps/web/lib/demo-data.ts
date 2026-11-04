import {
  createAnnotationSchema,
  createCitationSchema,
  createDiagnosticTestSchema,
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
  type CreateAnnotation,
  type CreateCitation,
  type CreateDiagnosticTest,
  type CreateEvidenceFile,
  type CreateHypothesis,
  type CreateObservation,
  type CreateSafetyEvent,
  type CreateSession,
  type DiagnosticEventInput,
  type DiagnosticTestStatus,
  type ProcessingStatus,
  type RecordTestResult,
  type ReportData,
  type ReportStatus,
  type SafetyState,
  type SessionStatus,
} from "@fieldfix/contracts";

/**
 * Demo dataset for the engineering dashboard. Every record is built with
 * the shared contract schemas, so fixtures cannot drift from what the
 * backend accepts. All content is fictional and flagged demo in the UI.
 * Nothing here claims live AI integration.
 */

export interface DemoAnnotation extends CreateAnnotation {
  id: string;
  createdAt: string;
}

export interface DemoEvidenceFile extends CreateEvidenceFile {
  id: string;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  createdAt: string;
  annotations: DemoAnnotation[];
}

export interface DemoObservation extends CreateObservation {
  id: string;
  createdAt: string;
}

export interface DemoHypothesis extends CreateHypothesis {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface DemoTestResult extends RecordTestResult {
  id: string;
  reportedAt: string;
}

export interface DemoTest extends CreateDiagnosticTest {
  id: string;
  status: DiagnosticTestStatus;
  result: DemoTestResult | null;
}

export interface DemoEvent extends DiagnosticEventInput {
  id: string;
  createdAt: string;
}

export interface DemoCitation extends CreateCitation {
  id: string;
  document_title: string;
  page_number: number | null;
  createdAt: string;
}

export interface DemoSafetyEvent extends CreateSafetyEvent {
  id: string;
  createdAt: string;
}

export interface DemoModelRun {
  id: string;
  provider: string;
  model_id: string;
  task_type: string;
  status: string;
  latency_ms: number | null;
  origin: "demo" | "live";
  createdAt: string;
}

export interface DemoReport {
  id: string;
  status: ReportStatus;
  data: ReportData;
  updatedAt: string;
}

export interface DemoSession extends CreateSession {
  id: string;
  status: SessionStatus;
  safety_state: SafetyState;
  createdAt: string;
  updatedAt: string;
  evidence: DemoEvidenceFile[];
  observations: DemoObservation[];
  hypotheses: DemoHypothesis[];
  tests: DemoTest[];
  events: DemoEvent[];
  citations: DemoCitation[];
  safety_events: DemoSafetyEvent[];
  model_runs: DemoModelRun[];
  report: DemoReport | null;
}

const LAPTOP_FILE_ID = "11111111-1111-4111-8111-111111111111";
const LAPTOP_OBS_USER = "22222222-2222-4222-8222-222222222222";
const LAPTOP_OBS_MODEL = "33333333-3333-4333-8333-333333333333";
const LAPTOP_H1 = "44444444-4444-4444-8444-444444444444";
const LAPTOP_H2 = "55555555-5555-4555-8555-555555555555";
const LAPTOP_T1 = "66666666-6666-4666-8666-666666666666";
const LAPTOP_T2 = "77777777-7777-4777-8777-777777777777";
const LAPTOP_CHUNK = "88888888-8888-4888-8888-888888888888";
const PHONE_FILE_ID = "99999999-9999-4999-8999-999999999999";

function laptopSession(): DemoSession {
  const sessionInput = createSessionSchema.parse({
    device_type: "laptop",
    manufacturer: "Acme",
    model: "AcmeBook Pro 14",
    symptoms:
      "Laptop will not power on. No lights, no fan noise when pressing the power button.",
    problem_started_note: "This morning; worked fine yesterday.",
    user_mode: "everyday",
  });
  const evidenceInput = createEvidenceFileSchema.parse({
    storage_key: "demo/acmebook/no-power.jpg",
    media_type: "image/jpeg",
    byte_size: 184320,
    original_filename: "acmebook-no-power.jpg",
    kind: "image",
    checksum_sha256: "c".repeat(64),
  });
  const annotationInput = createAnnotationSchema.parse({
    evidence_file_id: LAPTOP_FILE_ID,
    kind: "box",
    coordinates: { x: 820, y: 540, width: 120, height: 60 },
    label: "AC adapter LED",
    producer: "sam-3.1",
    image_width: 1280,
    image_height: 720,
    model_run_id: null,
  });
  const runInput = createModelRunSchema.parse({
    provider: "meta",
    model_id: "muse-spark-demo",
    task_type: "diagnosis",
    origin: "demo",
    request_id: "demo-req-laptop-1",
  });
  const runUpdate = updateModelRunSchema.parse({
    status: "succeeded",
    latency_ms: 1200,
  });
  const h1Input = createHypothesisSchema.parse({
    title: "Faulty AC adapter or charging cable",
    description: "No power reaches the unit, consistent with a dead adapter.",
    supporting_observations: [
      {
        kind: "evidence_file",
        id: LAPTOP_FILE_ID,
        note: "Adapter LED dark in photo",
      },
      {
        kind: "observation",
        id: LAPTOP_OBS_MODEL,
        note: "The AC adapter LED appears dark in the uploaded photo.",
      },
    ],
    confidence_label: "medium",
    confidence_rationale: "Dark LED plus total absence of life.",
    status: "supported",
  });
  const h2Input = createHypothesisSchema.parse({
    title: "Failed system-board power circuit",
    supporting_observations: [
      {
        kind: "observation",
        id: LAPTOP_OBS_USER,
        note: "Complete absence of response",
      },
    ],
    contradicting_observations: [
      { kind: "note", id: null, note: "No prior instability reported" },
    ],
    confidence_label: "low",
    confidence_rationale: "Adapter failure now explains the symptoms.",
    status: "weakened",
  });
  const t1Input = createDiagnosticTestSchema.parse({
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
  });
  const t2Input = createDiagnosticTestSchema.parse({
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
      { value: "cannot-perform", label: "Cannot perform this test" },
    ],
    position: 1,
  });
  const resultInput = recordTestResultSchema.parse({
    selected_option: "led-off",
    observation: "No light on the brick in a known-good outlet.",
  });
  const citationInput = createCitationSchema.parse({
    hypothesis_id: LAPTOP_H1,
    chunk_id: LAPTOP_CHUNK,
    excerpt:
      "A dark LED points to the adapter or cable rather than the system board.",
    note: "Supports checking the adapter first.",
  });
  const reportInput = createReportSchema.parse({
    status: "draft",
    report_data: {
      device: {
        device_type: "laptop",
        manufacturer: "Acme",
        model: "AcmeBook Pro 14",
        operating_system: null,
      },
      symptoms: sessionInput.symptoms,
      evidence_ids: [LAPTOP_FILE_ID],
      observable_facts: [
        "No lights or sounds on power press (user-reported).",
        "Adapter LED dark in photo (model-observed).",
      ],
      hypotheses: [
        {
          id: LAPTOP_H1,
          title: h1Input.title,
          status: "supported",
          confidence_label: "medium",
        },
        {
          id: LAPTOP_H2,
          title: h2Input.title,
          status: "weakened",
          confidence_label: "low",
        },
      ],
      tests_performed: [
        {
          test_id: LAPTOP_T1,
          name: t1Input.name,
          result: "led-off",
          observation: resultInput.observation ?? null,
        },
      ],
      sources: [
        {
          citation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          document_title: "AcmeBook Pro 14 Service Manual (demo excerpt)",
          page_number: 42,
          excerpt: citationInput.excerpt,
        },
      ],
      remaining_uncertainty: ["Adapter not yet swapped with a known-good unit."],
      recommended_next_steps: [
        "Retest with a known-good adapter of the same rating.",
      ],
      safety_summary: [],
    },
  });

  return {
    ...sessionInput,
    id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    status: "in_progress",
    safety_state: "normal",
    createdAt: "2026-10-30T07:12:00.000Z",
    updatedAt: "2026-10-30T07:41:00.000Z",
    evidence: [
      {
        ...evidenceInput,
        id: LAPTOP_FILE_ID,
        processing_status: "ready",
        processing_error: null,
        createdAt: "2026-10-30T07:14:00.000Z",
        annotations: [
          {
            ...annotationInput,
            id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
            createdAt: "2026-10-30T07:16:00.000Z",
          },
        ],
      },
    ],
    observations: [
      {
        ...createObservationSchema.parse({
          source: "user",
          body: "No lights or sounds when pressing the power button.",
        }),
        id: LAPTOP_OBS_USER,
        createdAt: "2026-10-30T07:12:30.000Z",
      },
      {
        ...createObservationSchema.parse({
          evidence_file_id: LAPTOP_FILE_ID,
          source: "model",
          body: "The AC adapter LED appears dark in the uploaded photo.",
        }),
        id: LAPTOP_OBS_MODEL,
        createdAt: "2026-10-30T07:15:00.000Z",
      },
    ],
    hypotheses: [
      {
        ...h1Input,
        id: LAPTOP_H1,
        createdAt: "2026-10-30T07:16:00.000Z",
        updatedAt: "2026-10-30T07:38:00.000Z",
      },
      {
        ...h2Input,
        id: LAPTOP_H2,
        createdAt: "2026-10-30T07:16:00.000Z",
        updatedAt: "2026-10-30T07:38:00.000Z",
      },
    ],
    tests: [
      {
        ...t1Input,
        id: LAPTOP_T1,
        status: "completed",
        result: {
          ...resultInput,
          id: "cccccccc-3333-4333-8333-cccccccccccc",
          reportedAt: "2026-10-30T07:37:00.000Z",
        },
      },
      {
        ...t2Input,
        id: LAPTOP_T2,
        status: "awaiting_result",
        result: null,
      },
    ],
    events: [
      {
        ...diagnosticEventSchema.parse({
          event_type: "session_created",
          payload: { device_type: "laptop", model: "AcmeBook Pro 14" },
        }),
        id: "dddddddd-4444-4444-8444-dddddddddddd",
        createdAt: "2026-10-30T07:12:00.000Z",
      },
      {
        ...diagnosticEventSchema.parse({
          event_type: "evidence_ready",
          payload: { evidence_file_id: LAPTOP_FILE_ID },
        }),
        id: "eeeeeeee-5555-4555-8555-eeeeeeeeeeee",
        createdAt: "2026-10-30T07:15:00.000Z",
      },
      {
        ...diagnosticEventSchema.parse({
          event_type: "analysis_completed",
          payload: { hypotheses: 2, model_run_id: runInput.request_id },
        }),
        id: "ffffffff-6666-4666-8666-ffffffffffff",
        createdAt: "2026-10-30T07:16:00.000Z",
      },
      {
        ...diagnosticEventSchema.parse({
          event_type: "test_result_recorded",
          payload: { test_id: LAPTOP_T1, selected_option: "led-off" },
        }),
        id: "11111111-7777-4777-8777-111111111111",
        createdAt: "2026-10-30T07:37:00.000Z",
      },
    ],
    citations: [
      {
        ...citationInput,
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        document_title: "AcmeBook Pro 14 Service Manual (demo excerpt)",
        page_number: 42,
        createdAt: "2026-10-30T07:20:00.000Z",
      },
    ],
    safety_events: [],
    model_runs: [
      {
        id: "22222222-8888-4888-8888-222222222222",
        provider: runInput.provider,
        model_id: runInput.model_id,
        task_type: runInput.task_type,
        status: runUpdate.status,
        latency_ms: runUpdate.latency_ms ?? null,
        origin: "demo",
        createdAt: "2026-10-30T07:15:10.000Z",
      },
    ],
    report: {
      id: "33333333-9999-4999-8999-333333333333",
      status: reportInput.status,
      data: reportInput.report_data,
      updatedAt: "2026-10-30T07:41:00.000Z",
    },
  };
}

function swollenBatterySession(): DemoSession {
  const sessionInput = createSessionSchema.parse({
    device_type: "smartphone",
    manufacturer: "Acme",
    model: "Acme Phone 12",
    symptoms:
      "Back cover is lifting away from the frame and the phone gets hot while charging. Possible swollen battery.",
    problem_started_note: "Noticed two days ago, worse today.",
    recent_events: "Phone was dropped last week.",
    user_mode: "everyday",
  });
  const fileInput = createEvidenceFileSchema.parse({
    storage_key: "demo/acme-phone/lifting-cover.jpg",
    media_type: "image/jpeg",
    byte_size: 241664,
    original_filename: "lifting-cover.jpg",
    kind: "image",
    checksum_sha256: "d".repeat(64),
  });
  const safetyInput = createSafetyEventSchema.parse({
    previous_state: "normal",
    new_state: "critical_stop",
    trigger_type: "user_report",
    trigger_detail:
      "User reports lifting back cover plus heat while charging.",
    blocked_action: "troubleshooting_checklist",
    safe_next_steps:
      "Stop using and charging the device. Do not press, puncture, or open it. Seek qualified professional help.",
  });

  return {
    ...sessionInput,
    id: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",
    status: "open",
    safety_state: "critical_stop",
    createdAt: "2026-10-30T08:02:00.000Z",
    updatedAt: "2026-10-30T08:05:00.000Z",
    evidence: [
      {
        ...fileInput,
        id: PHONE_FILE_ID,
        processing_status: "ready",
        processing_error: null,
        createdAt: "2026-10-30T08:03:00.000Z",
        annotations: [],
      },
    ],
    observations: [
      {
        ...createObservationSchema.parse({
          evidence_file_id: PHONE_FILE_ID,
          source: "user",
          body: "The back cover visibly lifts on the left edge.",
        }),
        id: "44444444-aaaa-4aaa-8aaa-444444444444",
        createdAt: "2026-10-30T08:03:30.000Z",
      },
    ],
    hypotheses: [],
    tests: [],
    events: [
      {
        ...diagnosticEventSchema.parse({
          event_type: "session_created",
          payload: { device_type: "smartphone", model: "Acme Phone 12" },
        }),
        id: "55555555-bbbb-4bbb-8bbb-555555555555",
        createdAt: "2026-10-30T08:02:00.000Z",
      },
      {
        ...diagnosticEventSchema.parse({
          event_type: "safety_state_changed",
          payload: {
            previous_state: "normal",
            new_state: "critical_stop",
            trigger_type: "user_report",
          },
        }),
        id: "66666666-cccc-4ccc-8ccc-666666666666",
        createdAt: "2026-10-30T08:05:00.000Z",
      },
    ],
    citations: [],
    safety_events: [
      {
        ...safetyInput,
        id: "77777777-dddd-4ddd-8ddd-777777777777",
        createdAt: "2026-10-30T08:05:00.000Z",
      },
    ],
    model_runs: [],
    report: null,
  };
}

function freshIntakeSession(): DemoSession {
  const sessionInput = createSessionSchema.parse({
    device_type: "laptop",
    manufacturer: "Acme",
    model: "AcmeBook Air 13",
    symptoms: "Screen flickers intermittently at low brightness.",
    user_mode: "technician",
  });

  return {
    ...sessionInput,
    id: "cccccccc-1111-4111-8111-cccccccccccc",
    status: "open",
    safety_state: "normal",
    createdAt: "2026-10-30T08:20:00.000Z",
    updatedAt: "2026-10-30T08:20:00.000Z",
    evidence: [],
    observations: [],
    hypotheses: [],
    tests: [],
    events: [
      {
        ...diagnosticEventSchema.parse({
          event_type: "session_created",
          payload: { device_type: "laptop", model: "AcmeBook Air 13" },
        }),
        id: "88888888-eeee-4eee-8eee-888888888888",
        createdAt: "2026-10-30T08:20:00.000Z",
      },
    ],
    citations: [],
    safety_events: [],
    model_runs: [],
    report: null,
  };
}

export const DEMO_SESSIONS: DemoSession[] = [
  laptopSession(),
  swollenBatterySession(),
  freshIntakeSession(),
];

export function getDemoSession(id: string): DemoSession | undefined {
  return DEMO_SESSIONS.find((s) => s.id === id);
}

/**
 * Referential-integrity check over the fixture graph. The dashboard
 * loader runs this so a broken fixture renders the error state instead
 * of silently mismatched panels.
 */
export function assertDemoIntegrity(sessions: DemoSession[]): void {
  for (const session of sessions) {
    const fileIds = new Set(session.evidence.map((f) => f.id));
    const obsIds = new Set(session.observations.map((o) => o.id));
    const hypIds = new Set(session.hypotheses.map((h) => h.id));
    const testIds = new Set(session.tests.map((t) => t.id));

    for (const file of session.evidence) {
      for (const annotation of file.annotations) {
        if (annotation.evidence_file_id !== file.id) {
          throw new Error(
            `Demo integrity: annotation ${annotation.id} points at ${annotation.evidence_file_id}, attached to ${file.id}`,
          );
        }
      }
    }
    for (const obs of session.observations) {
      if (obs.evidence_file_id != null && !fileIds.has(obs.evidence_file_id)) {
        throw new Error(
          `Demo integrity: observation ${obs.id} references missing file ${obs.evidence_file_id}`,
        );
      }
    }
    for (const hyp of session.hypotheses) {
      for (const ref of [
        ...hyp.supporting_observations,
        ...hyp.contradicting_observations,
      ]) {
        if (ref.kind === "evidence_file" && ref.id != null && !fileIds.has(ref.id)) {
          throw new Error(
            `Demo integrity: hypothesis ${hyp.id} references missing file ${ref.id}`,
          );
        }
        if (ref.kind === "observation" && ref.id != null && !obsIds.has(ref.id)) {
          throw new Error(
            `Demo integrity: hypothesis ${hyp.id} references missing observation ${ref.id}`,
          );
        }
      }
    }
    for (const citation of session.citations) {
      if (citation.hypothesis_id != null && !hypIds.has(citation.hypothesis_id)) {
        throw new Error(
          `Demo integrity: citation ${citation.id} references missing hypothesis ${citation.hypothesis_id}`,
        );
      }
      if (citation.test_id != null && !testIds.has(citation.test_id)) {
        throw new Error(
          `Demo integrity: citation ${citation.id} references missing test ${citation.test_id}`,
        );
      }
    }
    for (const test of session.tests) {
      if (
        test.result != null &&
        !test.result_options.some((o) => o.value === test.result?.selected_option)
      ) {
        throw new Error(
          `Demo integrity: test ${test.id} result is not one of its options`,
        );
      }
    }
  }
}

export interface DemoLoadResult {
  sessions: DemoSession[];
}

/** Async loader so the shell can show real loading/error states. */
export async function loadDemoSessions(): Promise<DemoLoadResult> {
  await new Promise((resolve) => setTimeout(resolve, 450));
  assertDemoIntegrity(DEMO_SESSIONS);
  return { sessions: DEMO_SESSIONS };
}
