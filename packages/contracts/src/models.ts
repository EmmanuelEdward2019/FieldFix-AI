import { z } from "zod";

/**
 * Model-reasoning contracts. `reasoningContextSchema` shapes what FieldFix
 * sends to a model; `diagnosticAssessmentSchema` shapes what comes back.
 * `ASSESSMENT_JSON_SCHEMA` mirrors the assessment in JSON Schema for the
 * Meta structured-output parameter (`text.format`, strict subset). The two
 * must stay in sync — see tests/models.test.ts.
 */

/** Provenance vocabulary: every finding states where it came from. */
export const evidenceProvenanceSchema = z.enum([
  "observed", // direct observation from submitted evidence
  "inferred", // model-generated inference
  "user_reported", // user-reported information
  "test_result", // result from a test actually performed
  "technician_verified", // independently verified by a technician
]);
export type EvidenceProvenance = z.infer<typeof evidenceProvenanceSchema>;

/** Model-side hypothesis standing. Deliberately has no "verified". */
export const assessmentStatusSchema = z.enum([
  "proposed",
  "supported",
  "weakened",
  "ruled_out",
]);
export type AssessmentStatus = z.infer<typeof assessmentStatusSchema>;

const evidenceStatementSchema = z.object({
  statement: z.string().min(1).max(2000),
  provenance: evidenceProvenanceSchema,
  source_ref: z.string().max(300).nullable().optional(),
});

const hypothesisAssessmentSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(4000).nullable().optional(),
  confidence: z.enum(["low", "medium", "high"]),
  confidence_rationale: z.string().max(2000).nullable().optional(),
  assessment_status: assessmentStatusSchema,
  supporting_evidence: z.array(evidenceStatementSchema).max(20).default([]),
  contradicting_evidence: z.array(evidenceStatementSchema).max(20).default([]),
  affected_components: z.array(z.string().min(1).max(200)).max(20).default([]),
});

const recommendedTestSchema = z.object({
  name: z.string().min(1).max(300),
  objective: z.string().min(1).max(2000),
  instructions: z.array(z.string().min(1).max(2000)).min(1).max(50),
  safety_notes: z.string().max(2000).nullable().optional(),
  required_tools: z.array(z.string().min(1).max(200)).max(20).default([]),
  result_options: z.array(z.string().min(1).max(200)).min(1).max(20),
});

const safetyWarningSchema = z.object({
  severity: z.enum(["info", "caution", "stop"]),
  message: z.string().min(1).max(2000),
});

const assessmentCitationSchema = z.object({
  document_id: z.string().uuid(),
  excerpt: z.string().min(1).max(4000),
  page: z.number().int().positive().nullable().optional(),
});

/** Structured diagnostic response contract (never free prose). */
export const diagnosticAssessmentSchema = z.object({
  summary: z.string().min(1).max(8000),
  observed_evidence: z
    .array(
      z.object({
        description: z.string().min(1).max(2000),
        evidence_file_id: z.string().uuid().nullable().optional(),
      }),
    )
    .max(50)
    .default([]),
  hypotheses: z.array(hypothesisAssessmentSchema).max(20).default([]),
  recommended_tests: z.array(recommendedTestSchema).max(20).default([]),
  safety_warnings: z.array(safetyWarningSchema).max(20).default([]),
  missing_information: z.array(z.string().min(1).max(1000)).max(20).default([]),
  citations: z.array(assessmentCitationSchema).max(30).default([]),
  suggested_next_action: z.object({
    action: z.string().min(1).max(1000),
    rationale: z.string().max(2000).nullable().optional(),
  }),
});
export type DiagnosticAssessment = z.infer<typeof diagnosticAssessmentSchema>;

/* Reasoning input context (device-agnostic). */

export const deviceCategorySchema = z.enum(["laptop", "desktop", "smartphone"]);
export type DeviceCategory = z.infer<typeof deviceCategorySchema>;

export const diagnosticStageSchema = z.enum([
  "initial_assessment",
  "reassessment",
  "next_step",
]);
export type DiagnosticStage = z.infer<typeof diagnosticStageSchema>;

export const reasoningContextSchema = z.object({
  device_category: deviceCategorySchema,
  device_type: z.string().min(1).max(120),
  manufacturer: z.string().max(120).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
  hardware_specs: z.record(z.string().max(500)).optional(),
  operating_system: z.string().max(120).nullable().optional(),
  symptoms: z.string().min(1).max(8000),
  observations: z
    .array(
      z.object({
        source: z.enum(["user", "model"]),
        body: z.string().min(1).max(8000),
      }),
    )
    .max(100)
    .default([]),
  test_history: z
    .array(
      z.object({
        name: z.string().min(1).max(300),
        result: z.string().max(1000).nullable().optional(),
        observation: z.string().max(4000).nullable().optional(),
      }),
    )
    .max(100)
    .default([]),
  current_hypotheses: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        status: z.string().min(1).max(60),
        confidence: z.enum(["low", "medium", "high"]),
      }),
    )
    .max(50)
    .default([]),
  doc_excerpts: z
    .array(
      z.object({
        document_id: z.string().uuid(),
        title: z.string().min(1).max(500),
        page: z.number().int().positive().nullable().optional(),
        excerpt: z.string().min(1).max(20000),
      }),
    )
    .max(20)
    .default([]),
  safety: z.object({
    state: z.string().min(1).max(60),
    restrictions: z.array(z.string().min(1).max(1000)).max(20).default([]),
  }),
  stage: diagnosticStageSchema,
  question: z.string().min(1).max(2000),
});
export type ReasoningContext = z.infer<typeof reasoningContextSchema>;

/* Model-run observability additions (migration 006). */

export const inputModalitySchema = z.enum(["text", "image"]);
export type InputModality = z.infer<typeof inputModalitySchema>;

export const validationStatusSchema = z.enum([
  "pending",
  "passed",
  "failed",
  "not_applicable",
]);
export type ValidationStatus = z.infer<typeof validationStatusSchema>;

/**
 * JSON Schema twin of diagnosticAssessmentSchema for Meta `text.format`
 * with `strict: true`. Uses only the strict subset: plain root object,
 * enums, nested objects/arrays, every object with
 * `additionalProperties: false` and complete `required`. Length bounds
 * live in the zod schema and are re-checked on our side.
 */
export const ASSESSMENT_JSON_SCHEMA = {
  name: "diagnostic_assessment",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "summary",
      "observed_evidence",
      "hypotheses",
      "recommended_tests",
      "safety_warnings",
      "missing_information",
      "citations",
      "suggested_next_action",
    ],
    properties: {
      summary: { type: "string" },
      observed_evidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["description", "evidence_file_id"],
          properties: {
            description: { type: "string" },
            evidence_file_id: { type: ["string", "null"] },
          },
        },
      },
      hypotheses: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "title",
            "description",
            "confidence",
            "confidence_rationale",
            "assessment_status",
            "supporting_evidence",
            "contradicting_evidence",
            "affected_components",
          ],
          properties: {
            title: { type: "string" },
            description: { type: ["string", "null"] },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            confidence_rationale: { type: ["string", "null"] },
            assessment_status: {
              type: "string",
              enum: ["proposed", "supported", "weakened", "ruled_out"],
            },
            supporting_evidence: { $ref: "#/$defs/evidenceStatementArray" },
            contradicting_evidence: { $ref: "#/$defs/evidenceStatementArray" },
            affected_components: { type: "array", items: { type: "string" } },
          },
        },
      },
      recommended_tests: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "name",
            "objective",
            "instructions",
            "safety_notes",
            "required_tools",
            "result_options",
          ],
          properties: {
            name: { type: "string" },
            objective: { type: "string" },
            instructions: { type: "array", items: { type: "string" } },
            safety_notes: { type: ["string", "null"] },
            required_tools: { type: "array", items: { type: "string" } },
            result_options: { type: "array", items: { type: "string" } },
          },
        },
      },
      safety_warnings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "message"],
          properties: {
            severity: { type: "string", enum: ["info", "caution", "stop"] },
            message: { type: "string" },
          },
        },
      },
      missing_information: { type: "array", items: { type: "string" } },
      citations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["document_id", "excerpt", "page"],
          properties: {
            document_id: { type: "string" },
            excerpt: { type: "string" },
            page: { type: ["integer", "null"] },
          },
        },
      },
      suggested_next_action: {
        type: "object",
        additionalProperties: false,
        required: ["action", "rationale"],
        properties: {
          action: { type: "string" },
          rationale: { type: ["string", "null"] },
        },
      },
    },
    $defs: {
      evidenceStatementArray: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["statement", "provenance", "source_ref"],
          properties: {
            statement: { type: "string" },
            provenance: {
              type: "string",
              enum: [
                "observed",
                "inferred",
                "user_reported",
                "test_result",
                "technician_verified",
              ],
            },
            source_ref: { type: ["string", "null"] },
          },
        },
      },
    },
  },
} as const;
