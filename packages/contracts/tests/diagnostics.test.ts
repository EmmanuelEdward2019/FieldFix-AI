import { describe, expect, it } from "vitest";
import {
  analyzeRequestSchema,
  HAZARD_SCREEN_JSON_SCHEMA,
  hazardScreenResultSchema,
  IDENTIFY_JSON_SCHEMA,
  createAnnotationSchema,
  getIdentificationResponseSchema,
  identifiedComponentSchema,
  visionIdentificationSchema,
  createDiagnosticTestSchema,
  createHypothesisSchema,
  createSessionSchema,
  linkHypothesisEvidenceSchema,
  recordTestResultSchema,
  reportDataSchema,
  safetyTransitionSchema,
  testResultResponseSchema,
  verifyHypothesisSchema,
} from "../src/index.js";

describe("createSessionSchema", () => {
  it("accepts unknown device details but requires symptoms", () => {
    const parsed = createSessionSchema.safeParse({
      device_type: "laptop",
      symptoms: "Will not power on.",
      user_mode: "everyday",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts all three device categories", () => {
    for (const device_type of ["laptop", "desktop", "smartphone"]) {
      expect(
        createSessionSchema.safeParse({
          device_type,
          symptoms: "Something is wrong.",
          user_mode: "everyday",
        }).success,
      ).toBe(true);
    }
  });

  it("rejects an empty symptom report", () => {
    expect(
      createSessionSchema.safeParse({
        device_type: "laptop",
        symptoms: "",
        user_mode: "everyday",
      }).success,
    ).toBe(false);
  });
});

describe("createHypothesisSchema", () => {
  it("defaults supporting evidence and status", () => {
    const parsed = createHypothesisSchema.safeParse({
      title: "Faulty AC adapter",
      confidence_label: "medium",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.supporting_observations).toEqual([]);
      expect(parsed.data.status).toBe("proposed");
    }
  });
});

describe("linkHypothesisEvidenceSchema", () => {
  const fileId = "11111111-1111-4111-8111-111111111111";
  const obsId = "22222222-2222-4222-8222-222222222222";

  it("requires exactly one link target", () => {
    expect(
      linkHypothesisEvidenceSchema.safeParse({ evidence_file_id: fileId })
        .success,
    ).toBe(true);
    expect(
      linkHypothesisEvidenceSchema.safeParse({ observation_id: obsId }).success,
    ).toBe(true);
    expect(linkHypothesisEvidenceSchema.safeParse({}).success).toBe(false);
    expect(
      linkHypothesisEvidenceSchema.safeParse({
        evidence_file_id: fileId,
        observation_id: obsId,
      }).success,
    ).toBe(false);
  });
});

describe("createDiagnosticTestSchema", () => {
  it("requires at least one instruction and one result option", () => {
    const base = {
      name: "Verify AC adapter",
      objective: "Rule out a dead adapter.",
      skill_level: "beginner",
      instructions: [{ step: 1, text: "Check the adapter LED." }],
      result_options: [{ value: "led-on", label: "LED is on" }],
    } as const;
    expect(createDiagnosticTestSchema.safeParse(base).success).toBe(true);
    expect(
      createDiagnosticTestSchema.safeParse({ ...base, instructions: [] })
        .success,
    ).toBe(false);
    expect(
      createDiagnosticTestSchema.safeParse({ ...base, result_options: [] })
        .success,
    ).toBe(false);
  });
});

describe("recordTestResultSchema", () => {
  it("accepts a result with an optional observation", () => {
    expect(
      recordTestResultSchema.safeParse({
        selected_option: "led-off",
        observation: "No light on the brick.",
      }).success,
    ).toBe(true);
  });
});

describe("createAnnotationSchema", () => {
  it("accepts a box tied to image dimensions", () => {
    expect(
      createAnnotationSchema.safeParse({
        evidence_file_id: "33333333-3333-4333-8333-333333333333",
        kind: "box",
        coordinates: { x: 10, y: 20, width: 100, height: 80 },
        producer: "sam-3.1",
        image_width: 1280,
        image_height: 720,
      }).success,
    ).toBe(true);
  });
});

describe("reportDataSchema", () => {
  it("rejects a report that invents hypothesis statuses", () => {
    expect(
      reportDataSchema.safeParse({
        device: {
          device_type: "laptop",
          manufacturer: null,
          model: null,
          operating_system: null,
        },
        symptoms: "No power.",
        evidence_ids: [],
        observable_facts: [],
        hypotheses: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            title: "Bad adapter",
            status: "definitely-broken",
            confidence_label: "high",
          },
        ],
        tests_performed: [],
        sources: [],
        remaining_uncertainty: [],
        recommended_next_steps: [],
        safety_summary: [],
      }).success,
    ).toBe(false);
  });
});

describe("diagnostic loop schemas", () => {
  it("defaults the analysis stage and requires a verification rationale", () => {
    const analyzed = analyzeRequestSchema.safeParse({});
    expect(analyzed.success).toBe(true);
    if (analyzed.success) {
      expect(analyzed.data.stage).toBe("initial_assessment");
    }
    expect(analyzeRequestSchema.safeParse({ stage: "guessing" }).success).toBe(false);
    expect(verifyHypothesisSchema.safeParse({ rationale: "Confirmed." }).success).toBe(true);
    expect(verifyHypothesisSchema.safeParse({ rationale: "" }).success).toBe(false);
  });

  it("pins result provenance to user_reported", () => {
    const id = "88888888-8888-4888-8888-888888888888";
    expect(
      testResultResponseSchema.safeParse({
        id,
        test_id: id,
        session_id: id,
        selected_option: "option_1",
        observation: null,
        source: "user_reported",
        created_at: "2026-10-30T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      testResultResponseSchema.safeParse({
        id,
        test_id: id,
        session_id: id,
        selected_option: "option_1",
        observation: null,
        source: "technician_verified",
        created_at: "2026-10-30T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("defaults report test entries to user_reported", () => {
    const parsed = reportDataSchema.safeParse({
      device: {
        device_type: "laptop",
        manufacturer: null,
        model: null,
        operating_system: null,
      },
      symptoms: "No power.",
      evidence_ids: [],
      observable_facts: [],
      hypotheses: [],
      tests_performed: [
        {
          test_id: "88888888-8888-4888-8888-888888888888",
          name: "Vent inspection",
          result: "clear",
          observation: null,
        },
      ],
      sources: [],
      remaining_uncertainty: [],
      recommended_next_steps: [],
      safety_summary: [],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tests_performed[0]?.source).toBe("user_reported");
    }
  });
});

describe("safety policy schemas", () => {
  it("requires a target state and rationale for transitions", () => {
    expect(
      safetyTransitionSchema.safeParse({ to_state: "review_required", rationale: "Checking." })
        .success,
    ).toBe(true);
    expect(
      safetyTransitionSchema.safeParse({ to_state: "review_required", rationale: "" }).success,
    ).toBe(false);
    expect(
      safetyTransitionSchema.safeParse({ to_state: "meltdown", rationale: "x" }).success,
    ).toBe(false);
  });

  it("parses advisory screen results strictly", () => {
    expect(
      hazardScreenResultSchema.safeParse({
        hazard_suspected: true,
        categories: ["heat"],
        rationale: "Warm device.",
      }).success,
    ).toBe(true);
    expect(
      hazardScreenResultSchema.safeParse({ hazard_suspected: "maybe" }).success,
    ).toBe(false);
    expect(HAZARD_SCREEN_JSON_SCHEMA.strict).toBe(true);
    expect([...HAZARD_SCREEN_JSON_SCHEMA.schema.required].sort()).toEqual(
      ["categories", "hazard_suspected", "rationale"],
    );
  });
});

describe("identification schemas", () => {
  it("accepts a confident component and rejects bad confidence", () => {
    expect(
      identifiedComponentSchema.safeParse({ name: "battery", confidence: "high", note: null })
        .success,
    ).toBe(true);
    expect(
      identifiedComponentSchema.safeParse({ name: "battery", confidence: "certain", note: null })
        .success,
    ).toBe(false);
    expect(
      identifiedComponentSchema.safeParse({ name: "", confidence: "low", note: null }).success,
    ).toBe(false);
  });

  it("accepts a full vision payload with a null fault area", () => {
    const parsed = visionIdentificationSchema.safeParse({
      device_name: null,
      components: [{ name: "cooling fan", confidence: "medium", note: null }],
      suspected_fault_area: null,
      unidentifiable: ["bracket at the top edge"],
    });
    expect(parsed.success).toBe(true);
  });

  it("caps component and region lists", () => {
    const many = Array.from({ length: 13 }, (_, i) => ({
      name: `part-${i}`,
      confidence: "low",
      note: null,
    }));
    expect(
      visionIdentificationSchema.safeParse({
        device_name: null,
        components: many,
        suspected_fault_area: null,
        unidentifiable: [],
      }).success,
    ).toBe(false);
  });

  it("keeps the provider schema twin strict and complete", () => {
    expect(IDENTIFY_JSON_SCHEMA.strict).toBe(true);
    expect([...IDENTIFY_JSON_SCHEMA.schema.required].sort()).toEqual(
      ["components", "device_name", "suspected_fault_area", "unidentifiable"],
    );
  });

  it("parses a persisted identification round-trip", () => {
    const parsed = getIdentificationResponseSchema.safeParse({
      identification: {
        id: "11111111-1111-4111-8111-111111111111",
        session_id: "22222222-2222-4222-8222-222222222222",
        evidence_file_id: "33333333-3333-4333-8333-333333333333",
        device_name: "Test Laptop 14",
        components: [{ name: "battery", confidence: "high", note: null }],
        suspected_fault_area: { component_name: "battery", rationale: "Discolored connector." },
        unidentifiable: [],
        model_run_id: null,
        created_at: "2026-11-03T12:00:00.000Z",
      },
    });
    expect(parsed.success).toBe(true);
  });
});
