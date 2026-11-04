import {
  diagnosticAssessmentSchema,
  type DiagnosticAssessment,
} from "@fieldfix/contracts";
import { ModelError } from "../types.js";

export interface ValidationContext {
  /** Document ids actually supplied — citations must reference these. */
  allowedDocumentIds: ReadonlySet<string>;
  /** Evidence file ids actually supplied. */
  allowedEvidenceIds: ReadonlySet<string>;
}

export interface ValidatedAssessment {
  assessment: DiagnosticAssessment;
  warnings: string[];
}

const MAX_ASSESSMENT_BYTES = 500_000;

/**
 * Validates raw model text into a DiagnosticAssessment: JSON parse, zod
 * schema, then semantic guardrails (no invented citations, no empty
 * assessments). Anything failing is rejected, never passed downstream.
 */
export class ModelResponseValidator {
  validate(text: string, context: ValidationContext): ValidatedAssessment {
    if (text.length === 0) {
      throw new ModelError("empty_response", "Provider returned no text.");
    }
    if (text.length > MAX_ASSESSMENT_BYTES) {
      throw new ModelError(
        "malformed_response",
        "Provider response exceeds the assessment size cap.",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new ModelError(
        "malformed_response",
        "Provider response is not valid JSON.",
      );
    }
    const result = diagnosticAssessmentSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "?"}: ${i.message}`)
        .join("; ");
      throw new ModelError(
        "validation_failed",
        `Provider response failed schema validation: ${issues}.`,
      );
    }
    const assessment = result.data;
    const warnings: string[] = [];

    for (const citation of assessment.citations) {
      if (!context.allowedDocumentIds.has(citation.document_id)) {
        throw new ModelError(
          "validation_failed",
          "Provider cited a document that was not supplied; rejecting assessment.",
        );
      }
    }
    for (const item of assessment.observed_evidence) {
      if (
        item.evidence_file_id != null &&
        !context.allowedEvidenceIds.has(item.evidence_file_id)
      ) {
        throw new ModelError(
          "validation_failed",
          "Provider referenced evidence that was not supplied; rejecting assessment.",
        );
      }
    }
    if (
      assessment.hypotheses.length === 0 &&
      assessment.recommended_tests.length === 0 &&
      assessment.missing_information.length === 0
    ) {
      throw new ModelError(
        "validation_failed",
        "Provider returned an empty assessment (no hypotheses, tests, or follow-ups).",
      );
    }
    if (
      assessment.hypotheses.length > 0 &&
      assessment.recommended_tests.length === 0 &&
      assessment.missing_information.length === 0
    ) {
      warnings.push(
        "Assessment proposes hypotheses without next tests or follow-ups.",
      );
    }
    return { assessment, warnings };
  }
}
