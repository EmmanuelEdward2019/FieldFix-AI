import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
 * Test A: complete laptop diagnostic (overheating under load) against
 * the integrated app — real Postgres, real storage, scripted (mocked)
 * model provider. Every step asserts on persisted state, not on the
 * mock's words.
 */
describe("E2E A: laptop diagnostic", () => {
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

  it("runs intake → evidence → analysis → test → reassessment → report", async () => {
    // 1-3. Intake: laptop category, device info, symptoms.
    const { id, token } = await e2eCreateSession(ctx, {
      device_type: "laptop",
      manufacturer: "Acme",
      model: "AcmeBook Pro 14",
      operating_system: "AcmeOS 26",
      symptoms: "Laptop overheats and shuts down under load. Fan is loud.",
      user_mode: "everyday",
    });

    // 4. Evidence upload (synthetic PNG fixture, not a real device photo).
    const fileId = await e2eUploadPng(ctx, id, token, "vents.png");
    const download = await request(ctx.app())
      .get(`/api/v1/sessions/${id}/evidence/${fileId}/download`)
      .set({ Authorization: `Bearer ${token}` });
    expect(download.status).toBe(200);

    // 5-6. Analysis → observations + hypotheses.
    ctx.model.queue(
      assessmentBody({
        summary: "Likely airflow restriction; motor failure possible.",
        hypotheses: [
          {
            title: "Dust-clogged heatsink",
            description: "Airflow blocked by dust.",
            confidence: "medium",
            confidence_rationale: "Loud fan plus shutdowns under load.",
            assessment_status: "supported",
            supporting_evidence: [
              { statement: "Loud fan reported.", provenance: "user_reported", source_ref: null },
            ],
            contradicting_evidence: [],
            affected_components: ["heatsink", "cooling fan"],
          },
          {
            title: "Failing fan motor",
            description: null,
            confidence: "low",
            confidence_rationale: null,
            assessment_status: "proposed",
            supporting_evidence: [],
            contradicting_evidence: [],
            affected_components: ["cooling fan"],
          },
        ],
        recommended_tests: [
          {
            name: "Vent inspection",
            objective: "Confirm airflow restriction.",
            instructions: ["Power off.", "Inspect vents with a light."],
            safety_notes: "Let the machine cool first.",
            required_tools: [],
            result_options: ["dusty", "clear"],
          },
        ],
      }),
    );
    const analyzed = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/analyze`)
      .set({ Authorization: `Bearer ${token}` })
      .send({});
    expect(analyzed.status).toBe(200);
    expect(analyzed.body.hypotheses).toHaveLength(2);
    expect(analyzed.body.tests).toHaveLength(1);
    const testId = analyzed.body.tests[0].id as string;
    const hypothesisId = analyzed.body.hypotheses[0].id as string;

    // 7-8. Technical documentation → resolved citation on a hypothesis.
    await e2eIngestMarkdown(
      ctx,
      "AcmeBook Cooling Service Notes",
      "# Cooling\n\nA dust-clogged heatsink causes shutdowns under load. Clean the vents with compressed air.\n",
    );
    const search = await request(ctx.app()).post("/api/v1/knowledge/search").send({
      query: "dust-clogged heatsink shutdowns",
      manufacturer: "Acme",
    });
    expect(search.status).toBe(200);
    expect(search.body.hits.length).toBeGreaterThan(0);
    const chunkId = search.body.hits[0].chunk_id as string;
    const attached = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/citations`)
      .set({ Authorization: `Bearer ${token}` })
      .send({
        hypothesis_id: hypothesisId,
        chunk_id: chunkId,
        excerpt: "dust-clogged heatsink causes shutdowns under load",
      });
    expect(attached.status).toBe(201);
    expect(attached.body.citation.document_title).toBe("AcmeBook Cooling Service Notes");

    // A fabricated excerpt must be refused, not stored.
    const forged = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/citations`)
      .set({ Authorization: `Bearer ${token}` })
      .send({
        hypothesis_id: hypothesisId,
        chunk_id: chunkId,
        excerpt: "the battery is definitely the confirmed cause",
      });
    expect(forged.status).toBe(422);

    // 9-11. Recommended test → result → reassessment weakens the theory.
    ctx.model.queue(
      assessmentBody({
        summary: "Vents are clear; weakening the heatsink theory.",
        hypotheses: [
          {
            title: "Dust-clogged heatsink",
            description: null,
            confidence: "low",
            confidence_rationale: null,
            assessment_status: "weakened",
            supporting_evidence: [],
            contradicting_evidence: [
              { statement: "Vents are clear.", provenance: "test_result", source_ref: null },
            ],
            affected_components: [],
          },
        ],
        recommended_tests: [],
      }),
    );
    const tests = await request(ctx.app())
      .get(`/api/v1/sessions/${id}/tests`)
      .set({ Authorization: `Bearer ${token}` });
    const options = tests.body.tests[0].test.result_options as Array<{ value: string; label: string }>;
    const clear = options.find((o) => o.label === "clear")?.value;
    expect(clear).toBeDefined();
    const recorded = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/tests/${testId}/results`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ selected_option: clear, observation: "Vents are spotless." });
    expect(recorded.status).toBe(201);
    expect(recorded.body.result.source).toBe("user_reported");
    expect(recorded.body.reassessment_applied).toBe(true);
    const heatsink = (
      recorded.body.hypotheses as Array<{ title: string; status: string }>
    ).find((h) => h.title === "Dust-clogged heatsink");
    expect(heatsink?.status).toBe("weakened");

    // 12. Session detail reflects the whole journey.
    const detail = await request(ctx.app())
      .get(`/api/v1/sessions/${id}`)
      .set({ Authorization: `Bearer ${token}` });
    expect(detail.status).toBe(200);
    expect(detail.body.hypotheses).toHaveLength(2);
    expect(detail.body.tests[0].result.selected_option).toBe(clear);
    expect(detail.body.citations).toHaveLength(1);
    expect(detail.body.model_runs.length).toBeGreaterThan(0);

    // 13. Final repair report: honest provenance throughout.
    const report = await request(ctx.app())
      .get(`/api/v1/sessions/${id}/report`)
      .set({ Authorization: `Bearer ${token}` });
    expect(report.status).toBe(200);
    const data = report.body.report.report_data;
    expect(data.device.device_type).toBe("laptop");
    expect(data.symptoms).toContain("overheats");
    expect(data.hypotheses).toHaveLength(2);
    expect(data.tests_performed[0].source).toBe("user_reported");
    expect(data.sources[0].document_title).toBe("AcmeBook Cooling Service Notes");
    expect(data.assessment).toContain("No fault has been independently verified.");
    expect(
      data.timeline.map((e: { event_type: string }) => e.event_type),
    ).toContain("analysis_completed");

    const pdf = await request(ctx.app())
      .get(`/api/v1/sessions/${id}/report?format=pdf`)
      .set({ Authorization: `Bearer ${token}` });
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/application\/pdf/);
  });
});
