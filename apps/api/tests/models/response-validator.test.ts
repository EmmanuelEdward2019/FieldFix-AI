import { describe, expect, it } from "vitest";
import { ModelResponseValidator } from "../../src/models/meta/response-validator.js";
import { ModelError } from "../../src/models/types.js";

const DOC_ID = "22222222-2222-4222-8222-222222222222";
const EVIDENCE_ID = "33333333-3333-4333-8333-333333333333";

const CONTEXT = {
  allowedDocumentIds: new Set([DOC_ID]),
  allowedEvidenceIds: new Set([EVIDENCE_ID]),
};

function validAssessment(): Record<string, unknown> {
  return {
    summary: "Overheating is most consistent with restricted airflow.",
    observed_evidence: [
      { description: "Vents visibly clogged with dust.", evidence_file_id: EVIDENCE_ID },
    ],
    hypotheses: [
      {
        title: "Dust-clogged heatsink",
        description: "Restricted airflow raises CPU temperature.",
        confidence: "medium",
        confidence_rationale: "Visual dust plus loud fan.",
        assessment_status: "supported",
        supporting_evidence: [
          { statement: "User reports loud fan.", provenance: "user_reported", source_ref: null },
        ],
        contradicting_evidence: [],
        affected_components: ["heatsink", "fan"],
      },
    ],
    recommended_tests: [
      {
        name: "Vent inspection",
        objective: "Confirm airflow restriction.",
        instructions: ["Power off and cool down.", "Inspect vents with a light."],
        safety_notes: "Do not open while hot.",
        required_tools: ["flashlight"],
        result_options: ["clear", "dusty", "blocked"],
      },
    ],
    safety_warnings: [{ severity: "caution", message: "Let the unit cool first." }],
    missing_information: ["Idle vs load temperatures."],
    citations: [{ document_id: DOC_ID, excerpt: "Clean vents quarterly.", page: 12 }],
    suggested_next_action: {
      action: "Perform the vent inspection.",
      rationale: "Cheap, safe, and discriminating.",
    },
  };
}

describe("ModelResponseValidator", () => {
  it("accepts a valid assessment without warnings", () => {
    const validator = new ModelResponseValidator();
    const { assessment, warnings } = validator.validate(
      JSON.stringify(validAssessment()),
      CONTEXT,
    );
    expect(assessment.summary).toContain("restricted airflow");
    expect(assessment.hypotheses).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it("warns when hypotheses lack next tests and follow-ups", () => {
    const validator = new ModelResponseValidator();
    const body = validAssessment();
    body.recommended_tests = [];
    body.missing_information = [];
    const { warnings } = validator.validate(JSON.stringify(body), CONTEXT);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("without next tests");
  });

  it("rejects empty text", () => {
    const validator = new ModelResponseValidator();
    expect(() => validator.validate("", CONTEXT)).toThrowError(ModelError);
    try {
      validator.validate("", CONTEXT);
      expect.unreachable();
    } catch (err) {
      expect(err as ModelError).toMatchObject({ category: "empty_response" });
    }
  });

  it("rejects non-JSON and schema-violating output", () => {
    const validator = new ModelResponseValidator();
    expect(() => validator.validate("not json{", CONTEXT)).toThrowError(
      expect.objectContaining({ category: "malformed_response" }),
    );

    const missing = validAssessment();
    delete missing.summary;
    try {
      validator.validate(JSON.stringify(missing), CONTEXT);
      expect.unreachable();
    } catch (err) {
      expect(err as ModelError).toMatchObject({ category: "validation_failed" });
      expect((err as ModelError).message).toContain("summary");
    }

    // The assessment has no "verified" state: such output is rejected.
    const verified = validAssessment() as {
      hypotheses: Array<Record<string, unknown>>;
    };
    verified.hypotheses[0]!.assessment_status = "verified";
    expect(() => validator.validate(JSON.stringify(verified), CONTEXT)).toThrowError(
      expect.objectContaining({ category: "validation_failed" }),
    );
  });

  it("rejects fabricated citations and evidence references", () => {
    const validator = new ModelResponseValidator();
    const badCitation = validAssessment();
    badCitation.citations = [
      {
        document_id: "99999999-9999-4999-8999-999999999999",
        excerpt: "Invented.",
        page: null,
      },
    ];
    expect(() => validator.validate(JSON.stringify(badCitation), CONTEXT)).toThrowError(
      expect.objectContaining({ category: "validation_failed" }),
    );

    const badEvidence = validAssessment();
    badEvidence.observed_evidence = [
      {
        description: "Claimed sighting.",
        evidence_file_id: "99999999-9999-4999-8999-999999999999",
      },
    ];
    expect(() => validator.validate(JSON.stringify(badEvidence), CONTEXT)).toThrowError(
      expect.objectContaining({ category: "validation_failed" }),
    );
  });

  it("rejects empty assessments with no actionable content", () => {
    const validator = new ModelResponseValidator();
    const empty = validAssessment();
    empty.hypotheses = [];
    empty.recommended_tests = [];
    empty.missing_information = [];
    expect(() => validator.validate(JSON.stringify(empty), CONTEXT)).toThrowError(
      expect.objectContaining({ category: "validation_failed" }),
    );
  });
});
