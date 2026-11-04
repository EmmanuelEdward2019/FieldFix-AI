import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_JSON_SCHEMA,
  assessmentStatusSchema,
  diagnosticAssessmentSchema,
  diagnosticStageSchema,
  evidenceProvenanceSchema,
  inputModalitySchema,
  reasoningContextSchema,
  validationStatusSchema,
  type DiagnosticAssessment,
} from "../src/index.js";

const DOC_ID = "66666666-6666-4666-8666-666666666666";

function validAssessment(): DiagnosticAssessment {
  return {
    summary: "Summary.",
    observed_evidence: [],
    hypotheses: [
      {
        title: "H1",
        description: null,
        confidence: "low",
        confidence_rationale: null,
        assessment_status: "proposed",
        supporting_evidence: [],
        contradicting_evidence: [],
        affected_components: [],
      },
    ],
    recommended_tests: [],
    safety_warnings: [],
    missing_information: [],
    citations: [],
    suggested_next_action: { action: "Do the next test.", rationale: null },
  };
}

describe("diagnosticAssessmentSchema", () => {
  it("accepts a minimal valid assessment", () => {
    expect(diagnosticAssessmentSchema.safeParse(validAssessment()).success).toBe(true);
  });

  it("rejects missing summary and bad confidence", () => {
    const { summary: _omitted, ...rest } = validAssessment();
    expect(diagnosticAssessmentSchema.safeParse(rest).success).toBe(false);
    const bad = validAssessment();
    (bad.hypotheses[0] as { confidence: string }).confidence = "certain";
    expect(diagnosticAssessmentSchema.safeParse(bad).success).toBe(false);
  });

  it("has no verified assessment state", () => {
    expect(assessmentStatusSchema.options).toEqual([
      "proposed",
      "supported",
      "weakened",
      "ruled_out",
    ]);
    const bad = validAssessment();
    (bad.hypotheses[0] as { assessment_status: string }).assessment_status = "verified";
    expect(diagnosticAssessmentSchema.safeParse(bad).success).toBe(false);
  });

  it("covers all five provenance kinds", () => {
    expect(evidenceProvenanceSchema.options).toEqual([
      "observed",
      "inferred",
      "user_reported",
      "test_result",
      "technician_verified",
    ]);
  });

  it("requires uuid document ids on citations", () => {
    const bad = validAssessment();
    bad.citations = [{ document_id: "not-a-uuid", excerpt: "x", page: null }];
    expect(diagnosticAssessmentSchema.safeParse(bad).success).toBe(false);
    const good = validAssessment();
    good.citations = [{ document_id: DOC_ID, excerpt: "x", page: 3 }];
    expect(diagnosticAssessmentSchema.safeParse(good).success).toBe(true);
  });
});

describe("reasoningContextSchema", () => {
  function validContext(category: "laptop" | "desktop" | "smartphone") {
    return {
      device_category: category,
      device_type: "test device",
      symptoms: "Something is wrong.",
      safety: { state: "normal", restrictions: [] as string[] },
      stage: "initial_assessment",
      question: "What is wrong?",
    };
  }

  it("accepts all three device categories", () => {
    for (const category of ["laptop", "desktop", "smartphone"] as const) {
      const parsed = reasoningContextSchema.safeParse(validContext(category));
      expect(parsed.success).toBe(true);
    }
  });

  it("rejects empty symptoms and unknown stages", () => {
    expect(
      reasoningContextSchema.safeParse({ ...validContext("laptop"), symptoms: "" }).success,
    ).toBe(false);
    expect(
      reasoningContextSchema.safeParse({ ...validContext("laptop"), stage: "guessing" }).success,
    ).toBe(false);
    expect(diagnosticStageSchema.options).toEqual([
      "initial_assessment",
      "reassessment",
      "next_step",
    ]);
  });
});

describe("observability enums", () => {
  it("covers text/image modalities and validation states", () => {
    expect(inputModalitySchema.options).toEqual(["text", "image"]);
    expect(validationStatusSchema.options).toEqual([
      "pending",
      "passed",
      "failed",
      "not_applicable",
    ]);
  });
});

describe("ASSESSMENT_JSON_SCHEMA sync", () => {
  it("mirrors the zod assessment shape for strict structured output", () => {
    expect(ASSESSMENT_JSON_SCHEMA.name).toBe("diagnostic_assessment");
    expect(ASSESSMENT_JSON_SCHEMA.strict).toBe(true);
    const zodKeys = Object.keys(diagnosticAssessmentSchema.shape).sort();
    const schemaKeys = [...ASSESSMENT_JSON_SCHEMA.schema.required].sort();
    expect(schemaKeys).toEqual(zodKeys);
    // Enums stay in sync with the zod source of truth.
    const props = ASSESSMENT_JSON_SCHEMA.schema.properties;
    const hypothesis = props.hypotheses.items;
    expect(hypothesis.properties.confidence.enum).toEqual(["low", "medium", "high"]);
    expect(hypothesis.properties.assessment_status.enum).toEqual(
      assessmentStatusSchema.options,
    );
  });
});
