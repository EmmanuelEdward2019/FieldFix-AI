import { z } from "zod";
import {
  diagnosticAssessmentSchema,
  diagnosticStageSchema,
} from "./models.js";

/**
 * Diagnostic-domain runtime schemas. The enums mirror the DB CHECK
 * constraints in apps/api/src/db/migrations — change both together.
 */

export const deviceTypeSchema = z.enum(["laptop", "desktop", "smartphone"]);
export type DeviceType = z.infer<typeof deviceTypeSchema>;

export const userModeSchema = z.enum(["everyday", "technician"]);
export type UserMode = z.infer<typeof userModeSchema>;

export const sessionStatusSchema = z.enum([
  "open",
  "in_progress",
  "awaiting_test",
  "completed",
  "archived",
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const safetyStateSchema = z.enum([
  "normal",
  "caution",
  "critical_stop",
  "review_required",
]);
export type SafetyState = z.infer<typeof safetyStateSchema>;

export const evidenceKindSchema = z.enum(["image", "video"]);
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;

export const processingStatusSchema = z.enum([
  "pending",
  "processing",
  "ready",
  "failed",
]);
export type ProcessingStatus = z.infer<typeof processingStatusSchema>;

export const observationSourceSchema = z.enum(["user", "model"]);
export type ObservationSource = z.infer<typeof observationSourceSchema>;

export const annotationKindSchema = z.enum(["box", "polygon", "point", "mask"]);
export type AnnotationKind = z.infer<typeof annotationKindSchema>;

export const hypothesisStatusSchema = z.enum([
  "proposed",
  "supported",
  "weakened",
  "ruled_out",
  "verified",
]);
export type HypothesisStatus = z.infer<typeof hypothesisStatusSchema>;

export const confidenceLabelSchema = z.enum(["low", "medium", "high"]);
export type ConfidenceLabel = z.infer<typeof confidenceLabelSchema>;

export const skillLevelSchema = z.enum(["beginner", "intermediate", "advanced"]);
export type SkillLevel = z.infer<typeof skillLevelSchema>;

export const safetyClassificationSchema = z.enum(["safe", "caution", "blocked"]);
export type SafetyClassification = z.infer<typeof safetyClassificationSchema>;

export const diagnosticTestStatusSchema = z.enum([
  "pending",
  "awaiting_result",
  "completed",
  "skipped",
  "blocked",
]);
export type DiagnosticTestStatus = z.infer<typeof diagnosticTestStatusSchema>;

export const triggerTypeSchema = z.enum([
  "user_report",
  "model_finding",
  "policy_rule",
]);
export type TriggerType = z.infer<typeof triggerTypeSchema>;

export const reportStatusSchema = z.enum(["draft", "ready", "failed"]);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

export const modelTaskTypeSchema = z.enum([
  "diagnosis",
  "segmentation",
  "identification",
  "safety_screen",
  "transcription",
  "illustration",
  "other",
]);
export type ModelTaskType = z.infer<typeof modelTaskTypeSchema>;

export const modelRunStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "timeout",
]);
export type ModelRunStatus = z.infer<typeof modelRunStatusSchema>;

/** Keeps demo/seeded model output distinguishable from live results. */
export const modelRunOriginSchema = z.enum(["live", "demo", "eval"]);
export type ModelRunOrigin = z.infer<typeof modelRunOriginSchema>;

/* Structured JSON payloads stored in JSONB columns. */

export const observationRefSchema = z.object({
  kind: z.enum(["evidence_file", "observation", "note"]),
  id: z.string().uuid().nullable(),
  note: z.string().min(1).max(2000),
});
export type ObservationRef = z.infer<typeof observationRefSchema>;

export const testInstructionSchema = z.object({
  step: z.number().int().positive(),
  text: z.string().min(1).max(2000),
});
export type TestInstruction = z.infer<typeof testInstructionSchema>;

export const testResultOptionSchema = z.object({
  value: z.string().min(1).max(120),
  label: z.string().min(1).max(200),
});
export type TestResultOption = z.infer<typeof testResultOptionSchema>;

const annotationPointSchema = z.object({ x: z.number(), y: z.number() });

/**
 * Coordinates in original-image pixels (see image_width/image_height on
 * the annotation row). Boxes and polygons use pixel corners; masks carry
 * an encoded bitmap plus its dimensions. Mask `data` holds the wire
 * payload verbatim, encoding marker first (`~` lossless, `!` one_bit);
 * `bounds` is the half-open source-pixel box the raster covers.
 */
export const annotationCoordinatesSchema = z.union([
  z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  z.object({ points: z.array(annotationPointSchema).min(1).max(4096) }),
  z.object({
    rows: z.number().int().positive(),
    cols: z.number().int().positive(),
    data: z.string().min(1),
    bounds: z
      .object({
        left: z.number().int().nonnegative(),
        top: z.number().int().nonnegative(),
        right: z.number().int().positive(),
        bottom: z.number().int().positive(),
      })
      .optional(),
  }),
]);
export type AnnotationCoordinates = z.infer<typeof annotationCoordinatesSchema>;

/* Sessions (PRD 4.1). The access token hash is generated server-side. */

export const createSessionSchema = z.object({
  device_type: deviceTypeSchema,
  manufacturer: z.string().min(1).max(120).optional(),
  model: z.string().min(1).max(120).optional(),
  operating_system: z.string().min(1).max(120).optional(),
  symptoms: z.string().min(1).max(8000),
  problem_started_at: z.string().datetime().nullable().optional(),
  problem_started_note: z.string().max(500).nullable().optional(),
  recent_events: z.string().max(2000).nullable().optional(),
  user_mode: userModeSchema,
});
export type CreateSession = z.infer<typeof createSessionSchema>;

export const updateSessionSchema = z
  .object({
    manufacturer: z.string().min(1).max(120).nullable(),
    model: z.string().min(1).max(120).nullable(),
    operating_system: z.string().min(1).max(120).nullable(),
    symptoms: z.string().min(1).max(8000),
    recent_events: z.string().max(2000).nullable(),
    status: sessionStatusSchema,
    safety_state: safetyStateSchema,
  })
  .partial();
export type UpdateSession = z.infer<typeof updateSessionSchema>;

/* Evidence (PRD 4.2). Files live in object storage; only metadata here. */

export const createEvidenceFileSchema = z.object({
  storage_key: z.string().min(1).max(1024),
  media_type: z.string().min(1).max(120),
  byte_size: z.number().int().positive(),
  original_filename: z.string().max(255).nullable().optional(),
  kind: evidenceKindSchema,
  checksum_sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .nullable()
    .optional(),
});
export type CreateEvidenceFile = z.infer<typeof createEvidenceFileSchema>;

export const createObservationSchema = z.object({
  evidence_file_id: z.string().uuid().nullable().optional(),
  source: observationSourceSchema,
  body: z.string().min(1).max(8000),
});
export type CreateObservation = z.infer<typeof createObservationSchema>;

/* REST response shapes (sessions + evidence). Never include secrets. */

export const sessionResponseSchema = z.object({
  id: z.string().uuid(),
  device_type: deviceTypeSchema,
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  operating_system: z.string().nullable(),
  symptoms: z.string(),
  problem_started_at: z.string().datetime().nullable(),
  problem_started_note: z.string().nullable(),
  recent_events: z.string().nullable(),
  user_mode: userModeSchema,
  status: sessionStatusSchema,
  safety_state: safetyStateSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const createSessionResponseSchema = z.object({
  session: sessionResponseSchema,
  /** Single-use reveal: the raw token is never stored or returned again. */
  accessToken: z.string().min(1),
});
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;

export const evidenceFileResponseSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  media_type: z.string(),
  byte_size: z.number().int().nonnegative(),
  original_filename: z.string().nullable(),
  kind: evidenceKindSchema,
  processing_status: processingStatusSchema,
  processing_error: z.string().nullable(),
  checksum_sha256: z.string().nullable(),
  created_at: z.string().datetime(),
});
export type EvidenceFileResponse = z.infer<typeof evidenceFileResponseSchema>;

export const observationResponseSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  evidence_file_id: z.string().uuid().nullable(),
  source: observationSourceSchema,
  body: z.string(),
  created_at: z.string().datetime(),
});
export type ObservationResponse = z.infer<typeof observationResponseSchema>;

/* SessionDetailResponse is defined after the hypotheses/tests/safety
   response schemas below so every nested array stays fully typed. */

export const uploadEvidenceResponseSchema = z.object({
  file: evidenceFileResponseSchema,
  observation: observationResponseSchema.nullable(),
});
export type UploadEvidenceResponse = z.infer<typeof uploadEvidenceResponseSchema>;

export const listEvidenceResponseSchema = z.object({
  evidence: z.array(evidenceFileResponseSchema),
});
export type ListEvidenceResponse = z.infer<typeof listEvidenceResponseSchema>;

export const createAnnotationSchema = z.object({
  evidence_file_id: z.string().uuid(),
  kind: annotationKindSchema,
  coordinates: annotationCoordinatesSchema,
  label: z.string().max(200).nullable().optional(),
  producer: z.string().min(1).max(120),
  image_width: z.number().int().positive(),
  image_height: z.number().int().positive(),
  model_run_id: z.string().uuid().nullable().optional(),
});
export type CreateAnnotation = z.infer<typeof createAnnotationSchema>;

/* Image segmentation (component localization — never a diagnosis). */

const segmentConceptSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !/[<|>]/.test(value), {
    message: "Concepts must be plain noun phrases (no <, | or >).",
  });

export const segmentRequestSchema = z.object({
  /** Component noun phrases, one provider call each. Defaults to the device vocabulary. */
  concepts: z.array(segmentConceptSchema).min(1).max(8).optional(),
});
export type SegmentRequest = z.infer<typeof segmentRequestSchema>;

export const annotationResponseSchema = z.object({
  id: z.string().uuid(),
  evidence_file_id: z.string().uuid(),
  kind: annotationKindSchema,
  coordinates: annotationCoordinatesSchema,
  label: z.string().nullable(),
  producer: z.string(),
  image_width: z.number().int().positive(),
  image_height: z.number().int().positive(),
  model_run_id: z.string().uuid().nullable(),
  /** Server-rendered SVG path in mask-raster space (masks only, null when undecodable). */
  svg_path: z.string().nullable(),
  created_at: z.string().datetime(),
});
export type AnnotationResponse = z.infer<typeof annotationResponseSchema>;

export const segmentRunSummarySchema = z.object({
  id: z.string().uuid(),
  concept: z.string(),
  status: modelRunStatusSchema,
  model_id: z.string(),
});
export type SegmentRunSummary = z.infer<typeof segmentRunSummarySchema>;

export const segmentResponseSchema = z.object({
  annotations: z.array(annotationResponseSchema),
  runs: z.array(segmentRunSummarySchema),
  concepts_used: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type SegmentResponse = z.infer<typeof segmentResponseSchema>;

export const listSegmentationsResponseSchema = z.object({
  annotations: z.array(annotationResponseSchema),
  image_width: z.number().int().positive().nullable(),
  image_height: z.number().int().positive().nullable(),
});
export type ListSegmentationsResponse = z.infer<
  typeof listSegmentationsResponseSchema
>;

/* Visual component identification (additive evidence intelligence). */

export const identificationConfidenceSchema = z.enum(["high", "medium", "low"]);
export type IdentificationConfidence = z.infer<typeof identificationConfidenceSchema>;

export const identifiedComponentSchema = z.object({
  name: z.string().min(1).max(120),
  confidence: identificationConfidenceSchema,
  note: z.string().max(500).nullable(),
});
export type IdentifiedComponent = z.infer<typeof identifiedComponentSchema>;

export const suspectedFaultAreaSchema = z.object({
  component_name: z.string().min(1).max(120),
  rationale: z.string().min(1).max(1000),
});
export type SuspectedFaultArea = z.infer<typeof suspectedFaultAreaSchema>;

export const identificationResponseSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  evidence_file_id: z.string().uuid(),
  device_name: z.string().nullable(),
  components: z.array(identifiedComponentSchema),
  suspected_fault_area: suspectedFaultAreaSchema.nullable(),
  unidentifiable: z.array(z.string()),
  model_run_id: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
});
export type IdentificationResponse = z.infer<typeof identificationResponseSchema>;

export const identifyResponseSchema = z.object({
  identification: identificationResponseSchema,
  annotations: z.array(annotationResponseSchema),
  concepts_used: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type IdentifyResponse = z.infer<typeof identifyResponseSchema>;

export const getIdentificationResponseSchema = z.object({
  identification: identificationResponseSchema,
});
export type GetIdentificationResponse = z.infer<typeof getIdentificationResponseSchema>;

/** Raw vision-model identification payload (validated before storage). */
export const visionIdentificationSchema = z.object({
  device_name: z.string().max(200).nullable(),
  components: z.array(identifiedComponentSchema).max(12),
  suspected_fault_area: suspectedFaultAreaSchema.nullable(),
  unidentifiable: z.array(z.string().min(1).max(300)).max(12),
});
export type VisionIdentification = z.infer<typeof visionIdentificationSchema>;

/** Strict-subset JSON Schema twin for provider structured output. */
export const IDENTIFY_JSON_SCHEMA = {
  name: "evidence_identification",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["device_name", "components", "suspected_fault_area", "unidentifiable"],
    properties: {
      device_name: { type: ["string", "null"] },
      components: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "confidence", "note"],
          properties: {
            name: { type: "string" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            note: { type: ["string", "null"] },
          },
        },
      },
      suspected_fault_area: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["component_name", "rationale"],
        properties: {
          component_name: { type: "string" },
          rationale: { type: "string" },
        },
      },
      unidentifiable: { type: "array", items: { type: "string" } },
    },
  },
} as const;

/* Hypotheses (PRD 4.3). */

export const createHypothesisSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(8000).nullable().optional(),
  supporting_observations: z.array(observationRefSchema).default([]),
  contradicting_observations: z.array(observationRefSchema).default([]),
  confidence_label: confidenceLabelSchema,
  confidence_rationale: z.string().max(2000).nullable().optional(),
  status: hypothesisStatusSchema.default("proposed"),
});
export type CreateHypothesis = z.infer<typeof createHypothesisSchema>;

export const updateHypothesisSchema = z
  .object({
    title: z.string().min(1).max(300),
    description: z.string().max(8000).nullable(),
    supporting_observations: z.array(observationRefSchema),
    contradicting_observations: z.array(observationRefSchema),
    confidence_label: confidenceLabelSchema,
    confidence_rationale: z.string().max(2000).nullable(),
    status: hypothesisStatusSchema,
    suggested_next_test_id: z.string().uuid().nullable(),
    verified_by_test_result_id: z.string().uuid().nullable(),
  })
  .partial();
export type UpdateHypothesis = z.infer<typeof updateHypothesisSchema>;

export const linkHypothesisEvidenceSchema = z
  .object({
    evidence_file_id: z.string().uuid().nullable().optional(),
    observation_id: z.string().uuid().nullable().optional(),
  })
  .refine(
    (v) => (v.evidence_file_id == null) !== (v.observation_id == null),
    {
      message: "Exactly one of evidence_file_id or observation_id must be set.",
    },
  );
export type LinkHypothesisEvidence = z.infer<typeof linkHypothesisEvidenceSchema>;

/* Tests and results (PRD 4.4). */

export const createDiagnosticTestSchema = z.object({
  name: z.string().min(1).max(300),
  objective: z.string().min(1).max(2000),
  rationale: z.string().max(2000).nullable().optional(),
  required_tools: z.array(z.string().min(1).max(200)).default([]),
  skill_level: skillLevelSchema,
  safety_classification: safetyClassificationSchema.default("safe"),
  instructions: z.array(testInstructionSchema).min(1).max(100),
  expected_outcomes: z.string().max(4000).nullable().optional(),
  result_options: z.array(testResultOptionSchema).min(1).max(50),
  position: z.number().int().min(0).default(0),
});
export type CreateDiagnosticTest = z.infer<typeof createDiagnosticTestSchema>;

export const recordTestResultSchema = z.object({
  selected_option: z.string().min(1).max(120),
  observation: z.string().max(4000).nullable().optional(),
});
export type RecordTestResult = z.infer<typeof recordTestResultSchema>;

/* Workflow events (append-only). */

export const diagnosticEventSchema = z.object({
  event_type: z.string().min(1).max(120),
  payload: z.record(z.unknown()).default({}),
});
export type DiagnosticEventInput = z.infer<typeof diagnosticEventSchema>;

/* Safety (PRD 4.7). */

export const createSafetyEventSchema = z.object({
  previous_state: safetyStateSchema,
  new_state: safetyStateSchema,
  trigger_type: triggerTypeSchema,
  trigger_detail: z.string().max(4000).nullable().optional(),
  evidence_file_id: z.string().uuid().nullable().optional(),
  blocked_action: z.string().max(500).nullable().optional(),
  safe_next_steps: z.string().min(1).max(4000),
});
export type CreateSafetyEvent = z.infer<typeof createSafetyEventSchema>;

export const safetyTransitionSchema = z.object({
  to_state: safetyStateSchema,
  rationale: z.string().min(1).max(2000),
});
export type SafetyTransition = z.infer<typeof safetyTransitionSchema>;

export const safetyEventResponseSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  previous_state: safetyStateSchema,
  new_state: safetyStateSchema,
  trigger_type: triggerTypeSchema,
  trigger_detail: z.string().nullable(),
  evidence_file_id: z.string().uuid().nullable(),
  blocked_action: z.string().nullable(),
  safe_next_steps: z.string(),
  created_at: z.string().datetime(),
});
export type SafetyEventResponse = z.infer<typeof safetyEventResponseSchema>;

/**
 * Advisory model-screening output. The model may only raise suspicion;
 * it can never clear, de-escalate, or decide a safety state. Parsed
 * strictly — anything else means "no signal", never a decision.
 */
export const hazardScreenResultSchema = z.object({
  hazard_suspected: z.boolean(),
  categories: z.array(z.string().min(1).max(80)).max(10).default([]),
  rationale: z.string().max(2000).default(""),
});
export type HazardScreenResult = z.infer<typeof hazardScreenResultSchema>;

/** Strict-subset JSON Schema twin for provider structured output. */
export const HAZARD_SCREEN_JSON_SCHEMA = {
  name: "hazard_screen",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["hazard_suspected", "categories", "rationale"],
    properties: {
      hazard_suspected: { type: "boolean" },
      categories: { type: "array", items: { type: "string" } },
      rationale: { type: "string" },
    },
  },
} as const;

/* Reports (PRD 4.8). */

export const reportDataSchema = z.object({
  device: z.object({
    device_type: deviceTypeSchema,
    manufacturer: z.string().nullable(),
    model: z.string().nullable(),
    operating_system: z.string().nullable(),
  }),
  symptoms: z.string(),
  evidence_ids: z.array(z.string().uuid()),
  observable_facts: z.array(z.string()),
  hypotheses: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      status: hypothesisStatusSchema,
      confidence_label: confidenceLabelSchema,
      supporting_observations: z.array(observationRefSchema).optional(),
      contradicting_observations: z.array(observationRefSchema).optional(),
    }),
  ),
  tests_performed: z.array(
    z.object({
      test_id: z.string().uuid(),
      name: z.string(),
      result: z.string().nullable(),
      observation: z.string().nullable(),
      // Reports only ever hold user-reported results. Anything
      // independently verified is recorded as a verification event
      // on the hypothesis, never as a measurement here.
      source: z.literal("user_reported").default("user_reported"),
    }),
  ),
  sources: z.array(
    z.object({
      citation_id: z.string().uuid(),
      document_title: z.string(),
      page_number: z.number().int().nullable(),
      excerpt: z.string(),
    }),
  ),
  remaining_uncertainty: z.array(z.string()),
  recommended_next_steps: z.array(z.string()),
  safety_summary: z.array(
    z.object({
      id: z.string().uuid(),
      new_state: safetyStateSchema,
      trigger_type: triggerTypeSchema,
    }),
  ),
  /** Deterministic summary composed from counts only — never a new claim. */
  assessment: z.string().max(2000).optional(),
  /** Session timeline: workflow event types with timestamps, oldest first. */
  timeline: z
    .array(
      z.object({
        event_type: z.string().min(1).max(120),
        created_at: z.string().datetime(),
      }),
    )
    .max(500)
    .optional(),
});
export type ReportData = z.infer<typeof reportDataSchema>;

export const createReportSchema = z.object({
  status: reportStatusSchema.default("draft"),
  report_data: reportDataSchema,
  error_message: z.string().max(2000).nullable().optional(),
});
export type CreateReport = z.infer<typeof createReportSchema>;

/* Model runs (PRD 7.2 observability). */

export const createModelRunSchema = z.object({
  session_id: z.string().uuid().nullable().optional(),
  provider: z.string().min(1).max(120),
  model_id: z.string().min(1).max(120),
  task_type: modelTaskTypeSchema,
  origin: modelRunOriginSchema.default("live"),
  request_id: z.string().max(200).nullable().optional(),
});
export type CreateModelRun = z.infer<typeof createModelRunSchema>;

export const updateModelRunSchema = z.object({
  status: modelRunStatusSchema,
  latency_ms: z.number().int().nonnegative().nullable().optional(),
  prompt_tokens: z.number().int().nonnegative().nullable().optional(),
  completion_tokens: z.number().int().nonnegative().nullable().optional(),
  request_id: z.string().max(200).nullable().optional(),
  error_category: z.string().max(200).nullable().optional(),
  error_message: z.string().max(4000).nullable().optional(),
  diagnostic_stage: z.string().max(60).nullable().optional(),
  input_modality: z.array(z.enum(["text", "image"])).max(8).optional(),
  validation_status: z
    .enum(["pending", "passed", "failed", "not_applicable"])
    .optional(),
  provider_response_id: z.string().max(200).nullable().optional(),
});
export type UpdateModelRun = z.infer<typeof updateModelRunSchema>;

/* Diagnostic loop (analyze -> test -> result -> reassess -> report). */

export const analyzeRequestSchema = z.object({
  stage: diagnosticStageSchema.default("initial_assessment"),
  question: z.string().min(1).max(2000).optional(),
  provider_id: z.string().min(1).max(120).optional(),
});
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

export const hypothesisResponseSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  supporting_observations: z.array(observationRefSchema),
  contradicting_observations: z.array(observationRefSchema),
  confidence_label: confidenceLabelSchema,
  confidence_rationale: z.string().nullable(),
  status: hypothesisStatusSchema,
  suggested_next_test_id: z.string().uuid().nullable(),
  verified_by_test_result_id: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type HypothesisResponse = z.infer<typeof hypothesisResponseSchema>;

export const diagnosticTestResponseSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  name: z.string(),
  objective: z.string(),
  rationale: z.string().nullable(),
  required_tools: z.array(z.string()),
  skill_level: skillLevelSchema,
  safety_classification: safetyClassificationSchema,
  instructions: z.array(testInstructionSchema),
  expected_outcomes: z.string().nullable(),
  result_options: z.array(testResultOptionSchema),
  position: z.number().int(),
  status: diagnosticTestStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type DiagnosticTestResponse = z.infer<
  typeof diagnosticTestResponseSchema
>;

export const testResultResponseSchema = z.object({
  id: z.string().uuid(),
  test_id: z.string().uuid(),
  session_id: z.string().uuid(),
  selected_option: z.string(),
  observation: z.string().nullable(),
  // Provenance is structural: results captured through the API are
  // always user-reported, never independently verified measurements.
  source: z.literal("user_reported"),
  created_at: z.string().datetime(),
});
export type TestResultResponse = z.infer<typeof testResultResponseSchema>;

export const testWithResultResponseSchema = z.object({
  test: diagnosticTestResponseSchema,
  result: testResultResponseSchema.nullable(),
});

export const diagnosticEventResponseSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  event_type: z.string(),
  payload: z.record(z.unknown()),
  created_at: z.string().datetime(),
});
export type DiagnosticEventResponse = z.infer<typeof diagnosticEventResponseSchema>;

export const sessionCitationResponseSchema = z.object({
  id: z.string().uuid(),
  chunk_id: z.string().uuid(),
  hypothesis_id: z.string().uuid().nullable(),
  test_id: z.string().uuid().nullable(),
  excerpt: z.string(),
  note: z.string().nullable(),
  document_id: z.string().uuid(),
  document_title: z.string(),
  page_number: z.number().int().nullable(),
  heading: z.string().nullable(),
  created_at: z.string().datetime(),
});
export type SessionCitationResponse = z.infer<typeof sessionCitationResponseSchema>;

export const modelRunResponseSchema = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  model_id: z.string(),
  task_type: modelTaskTypeSchema,
  status: modelRunStatusSchema,
  latency_ms: z.number().int().nullable(),
  created_at: z.string().datetime(),
});
export type ModelRunResponse = z.infer<typeof modelRunResponseSchema>;

export const sessionDetailResponseSchema = z.object({
  session: sessionResponseSchema,
  evidence: z.array(evidenceFileResponseSchema),
  observations: z.array(observationResponseSchema),
  hypotheses: z.array(hypothesisResponseSchema).default([]),
  tests: z.array(testWithResultResponseSchema).default([]),
  events: z.array(diagnosticEventResponseSchema).default([]),
  citations: z.array(sessionCitationResponseSchema).default([]),
  safety_events: z.array(safetyEventResponseSchema).default([]),
  model_runs: z.array(modelRunResponseSchema).default([]),
});
export type SessionDetailResponse = z.infer<typeof sessionDetailResponseSchema>;
export type TestWithResultResponse = z.infer<
  typeof testWithResultResponseSchema
>;

export const analyzeResponseSchema = z.object({
  assessment: diagnosticAssessmentSchema,
  hypotheses: z.array(hypothesisResponseSchema),
  tests: z.array(diagnosticTestResponseSchema),
  run: z.object({
    id: z.string().uuid(),
    status: modelRunStatusSchema,
    model_id: z.string(),
  }),
  warnings: z.array(z.string()),
});
export type AnalyzeResponse = z.infer<typeof analyzeResponseSchema>;

export const recordResultResponseSchema = z.object({
  result: testResultResponseSchema,
  test: diagnosticTestResponseSchema,
  reassessment_applied: z.boolean(),
  reassessment_error: z.string().nullable(),
  hypotheses: z.array(hypothesisResponseSchema),
});
export type RecordResultResponse = z.infer<typeof recordResultResponseSchema>;

export const verifyHypothesisSchema = z.object({
  rationale: z.string().min(1).max(2000),
});
export type VerifyHypothesis = z.infer<typeof verifyHypothesisSchema>;

export const reportResponseSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  status: reportStatusSchema,
  report_data: reportDataSchema,
  error_message: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type ReportResponse = z.infer<typeof reportResponseSchema>;

/** Report list card for an owner's Repair Reports page. */
export const ownedReportSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  status: reportStatusSchema,
  device_type: deviceTypeSchema,
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  symptoms: z.string(),
  created_at: z.string().datetime(),
});
export type OwnedReport = z.infer<typeof ownedReportSchema>;

export const listOwnedReportsResponseSchema = z.object({
  reports: z.array(ownedReportSchema),
});
export type ListOwnedReportsResponse = z.infer<typeof listOwnedReportsResponseSchema>;

export const listOwnedSessionsResponseSchema = z.object({
  sessions: z.array(sessionResponseSchema),
});
export type ListOwnedSessionsResponse = z.infer<typeof listOwnedSessionsResponseSchema>;
