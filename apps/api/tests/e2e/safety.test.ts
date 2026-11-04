import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ModelError } from "../../src/models/types.js";
import {
  assessmentBody,
  e2eCreateSession,
  e2eUploadPng,
  resetE2E,
  setupE2E,
  teardownE2E,
  type E2EContext,
} from "./harness.js";

/**
 * Test C: swollen-battery critical-stop workflow, independent of the AI
 * provider. Uses synthetic text symptoms only — no real hazardous
 * battery, no real imagery.
 */
describe("E2E C: swollen-battery critical stop", () => {
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

  it("stops the loop, blocks bypasses, and recovers by technician path", async () => {
    // 1-3. Intake describing a swollen battery escalates immediately.
    const { id, token } = await e2eCreateSession(ctx, {
      device_type: "smartphone",
      manufacturer: "Acme",
      model: "Acme Phone 12",
      symptoms: "The back cover is lifting and the battery looks swollen. The phone gets hot.",
      user_mode: "everyday",
    });
    const auth = { Authorization: `Bearer ${token}` };
    expect((await e2eDetail()).session.safety_state).toBe("critical_stop");

    // 4+7. A prominent, recorded warning with safe next steps.
    const events = await request(ctx.app())
      .get(`/api/v1/sessions/${id}/safety/events`)
      .set(auth);
    expect(events.status).toBe(200);
    expect(events.body.events).toHaveLength(1);
    expect(events.body.events[0].new_state).toBe("critical_stop");
    expect(events.body.events[0].safe_next_steps).toContain(
      "Stop using and charging the device immediately.",
    );

    // 5. Ordinary troubleshooting is blocked.
    const analyzed = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/analyze`)
      .set(auth)
      .send({});
    expect(analyzed.status).toBe(422);
    expect(analyzed.body.error.code).toBe("safety_block");

    // 6. Bypass attempts fail: everyday users cannot transition, and
    // critical_stop cannot jump straight back to normal.
    const everyday = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/safety/transition`)
      .set(auth)
      .send({ to_state: "normal", rationale: "I want to continue." });
    expect(everyday.status).toBe(403);

    // 8. Evidence and reporting stay available while stopped.
    const fileId = await e2eUploadPng(ctx, id, token, "cover.png");
    expect(fileId).toBeDefined();
    const report = await request(ctx.app()).get(`/api/v1/sessions/${id}/report`).set(auth);
    expect(report.status).toBe(200);
    expect(report.body.report.report_data.safety_summary[0].new_state).toBe("critical_stop");

    // Recovery follows the technician path on a technician session.
    const tech = await e2eCreateSession(ctx, {
      device_type: "smartphone",
      symptoms: "Back cover lifting, swollen battery suspected.",
      user_mode: "technician",
    });
    const techAuth = { Authorization: `Bearer ${tech.token}` };
    const jump = await request(ctx.app())
      .post(`/api/v1/sessions/${tech.id}/safety/transition`)
      .set(techAuth)
      .send({ to_state: "normal", rationale: "Skipping review." });
    expect(jump.status).toBe(422);

    const toReview = await request(ctx.app())
      .post(`/api/v1/sessions/${tech.id}/safety/transition`)
      .set(techAuth)
      .send({ to_state: "review_required", rationale: "Inspected on the bench; keeping under review." });
    expect(toReview.status).toBe(200);
    expect(toReview.body.session.safety_state).toBe("review_required");

    // The loop stays blocked while under review.
    const stillBlocked = await request(ctx.app())
      .post(`/api/v1/sessions/${tech.id}/analyze`)
      .set(techAuth)
      .send({});
    expect(stillBlocked.status).toBe(422);

    // 9. Clearing to normal restores guided troubleshooting.
    const cleared = await request(ctx.app())
      .post(`/api/v1/sessions/${tech.id}/safety/transition`)
      .set(techAuth)
      .send({ to_state: "normal", rationale: "Battery replaced by a professional; device inspected." });
    expect(cleared.status).toBe(200);
    ctx.model.queue(
      assessmentBody({
        summary: "Post-replacement check.",
        hypotheses: [
          {
            title: "Replacement battery healthy",
            description: null,
            confidence: "medium",
            confidence_rationale: null,
            assessment_status: "supported",
            supporting_evidence: [],
            contradicting_evidence: [],
            affected_components: ["battery"],
          },
        ],
      }),
    );
    const resumed = await request(ctx.app())
      .post(`/api/v1/sessions/${tech.id}/analyze`)
      .set(techAuth)
      .send({});
    expect(resumed.status).toBe(200);

    async function e2eDetail(): Promise<{ session: { safety_state: string } }> {
      const res = await request(ctx.app()).get(`/api/v1/sessions/${id}`).set(auth);
      expect(res.status).toBe(200);
      return res.body as { session: { safety_state: string } };
    }
  });

  it("keeps safety independent of model failures", async () => {
    const { id, token } = await e2eCreateSession(ctx, {
      device_type: "smartphone",
      symptoms: "Screen flickers occasionally.",
      user_mode: "everyday",
    });
    const auth = { Authorization: `Bearer ${token}` };

    // Provider outage: the call fails, nothing is persisted, safety untouched.
    ctx.model.queue(new ModelError("unavailable", "Provider down."));
    const failed = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/analyze`)
      .set(auth)
      .send({});
    expect(failed.status).toBe(502);
    const detail = await request(ctx.app()).get(`/api/v1/sessions/${id}`).set(auth);
    expect(detail.body.session.safety_state).toBe("normal");
    expect(detail.body.hypotheses).toHaveLength(0);
    expect(detail.body.safety_events).toHaveLength(0);

    // Malformed model output is rejected, never stored as findings.
    ctx.model.queue("this is not JSON");
    const malformed = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/analyze`)
      .set(auth)
      .send({});
    expect(malformed.status).toBe(502);
    const again = await request(ctx.app()).get(`/api/v1/sessions/${id}`).set(auth);
    expect(again.body.hypotheses).toHaveLength(0);
  });
});
