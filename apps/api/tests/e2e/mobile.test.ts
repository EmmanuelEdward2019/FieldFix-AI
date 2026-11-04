import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MASK_6X4 } from "../vision/sam-fixture.js";
import {
  assessmentBody,
  e2eCreateSession,
  e2eIngestMarkdown,
  e2eUploadPng,
  resetE2E,
  setupE2E,
  teardownE2E,
  type E2EContext,
} from "./harness.js";

/**
 * Test B: complete mobile phone diagnostic (touch failure after a drop)
 * — a genuinely different device and fault from Test A, exercising the
 * same reusable engine plus component localization.
 */
describe("E2E B: mobile phone diagnostic", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await setupE2E();
  });
  afterAll(async () => {
    await teardownE2E(ctx);
  });
  beforeEach(async () => {
    await resetE2E(ctx);
  });

  it("runs a touch-fault journey with localization and report", async () => {
    // 1-3. Mobile intake.
    const { id, token } = await e2eCreateSession(ctx, {
      device_type: "smartphone",
      manufacturer: "Acme",
      model: "Acme Phone 12",
      operating_system: "AcmeOS Mobile 9",
      symptoms: "Lower half of the touchscreen stopped responding after a drop. Display looks fine.",
      user_mode: "everyday",
    });
    const auth = { Authorization: `Bearer ${token}` };

    // 4. Evidence.
    const fileId = await e2eUploadPng(ctx, id, token, "screen.png");

    // 5-7. Analysis with affected components + hypotheses.
    ctx.model.queue(
      assessmentBody({
        summary: "Digitizer damage likely; connector reseat possible.",
        hypotheses: [
          {
            title: "Cracked digitizer layer",
            description: null,
            confidence: "high",
            confidence_rationale: "Drop plus localized dead zone.",
            assessment_status: "supported",
            supporting_evidence: [
              { statement: "Dead zone after a drop.", provenance: "user_reported", source_ref: null },
            ],
            contradicting_evidence: [],
            affected_components: ["screen", "digitizer"],
          },
          {
            title: "Loose display connector",
            description: null,
            confidence: "low",
            confidence_rationale: null,
            assessment_status: "proposed",
            supporting_evidence: [],
            contradicting_evidence: [],
            affected_components: ["display connector"],
          },
        ],
        recommended_tests: [
          {
            name: "Touch grid check",
            objective: "Map the dead zone precisely.",
            instructions: ["Open a drawing app.", "Drag across the full screen."],
            safety_notes: null,
            required_tools: [],
            result_options: ["dead zone confirmed", "full response"],
          },
        ],
      }),
    );
    const analyzed = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/analyze`)
      .set(auth)
      .send({});
    expect(analyzed.status).toBe(200);
    expect(analyzed.body.hypotheses.map((h: { title: string }) => h.title)).toEqual(
      expect.arrayContaining(["Cracked digitizer layer", "Loose display connector"]),
    );
    const testId = analyzed.body.tests[0].id as string;

    // 6 (localization). Default smartphone vocabulary segments the photo.
    ctx.segmenter.objects = [
      {
        objectId: "0",
        box: { left: 10, top: 20, right: 16, bottom: 24 },
        mask: {
          rows: 4,
          cols: 6,
          encoding: "one_bit",
          payload: MASK_6X4,
          bounds: { left: 10, top: 20, right: 16, bottom: 24 },
        },
      },
    ];
    const segmented = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/evidence/${fileId}/segmentations`)
      .set(auth)
      .send({});
    expect(segmented.status).toBe(201);
    expect(segmented.body.concepts_used).toContain("screen");
    expect(segmented.body.annotations.length).toBeGreaterThan(0);
    const listed = await request(ctx.app())
      .get(`/api/v1/sessions/${id}/evidence/${fileId}/segmentations`)
      .set(auth);
    expect(listed.body.image_width).toBe(100);

    // 8. Documentation retrieval (phone service manual).
    await e2eIngestMarkdown(
      ctx,
      "Acme Phone Touch Service Notes",
      "# Touch\n\nA localized dead zone after impact indicates digitizer damage. Reseat the display connector before replacing the panel.\n",
    );
    const search = await request(ctx.app()).post("/api/v1/knowledge/search").send({
      query: "localized dead zone digitizer damage",
      manufacturer: "Acme",
    });
    expect(search.status).toBe(200);
    expect(search.body.hits.length).toBeGreaterThan(0);

    // 9-11. Test result updates the hypotheses.
    ctx.model.queue(
      assessmentBody({
        summary: "Dead zone confirmed; digitizer theory holds.",
        hypotheses: [
          {
            title: "Cracked digitizer layer",
            description: null,
            confidence: "high",
            confidence_rationale: null,
            assessment_status: "supported",
            supporting_evidence: [
              { statement: "Dead zone confirmed.", provenance: "test_result", source_ref: null },
            ],
            contradicting_evidence: [],
            affected_components: ["screen"],
          },
        ],
        recommended_tests: [],
      }),
    );
    const tests = await request(ctx.app()).get(`/api/v1/sessions/${id}/tests`).set(auth);
    const options = tests.body.tests[0].test.result_options as Array<{ value: string; label: string }>;
    const confirmed = options.find((o) => o.label === "dead zone confirmed")?.value;
    const recorded = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/tests/${testId}/results`)
      .set(auth)
      .send({ selected_option: confirmed });
    expect(recorded.status).toBe(201);
    expect(recorded.body.reassessment_applied).toBe(true);

    // 12. Repair report for the phone session.
    const report = await request(ctx.app()).get(`/api/v1/sessions/${id}/report`).set(auth);
    expect(report.status).toBe(200);
    const data = report.body.report.report_data;
    expect(data.device.device_type).toBe("smartphone");
    expect(data.hypotheses.map((h: { title: string }) => h.title)).toContain(
      "Cracked digitizer layer",
    );
    expect(data.assessment).toContain("No fault has been independently verified.");
  });
});
