import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ModelError } from "../../src/models/types.js";
import {
  e2eCreateSession,
  e2eUploadPng,
  resetE2E,
  setupE2E,
  teardownE2E,
  type E2EContext,
} from "./harness.js";

/**
 * Test D: regression and failure testing across auth, validation,
 * uploads, provider failures, and persistence. Each failure must leave
 * prior session state intact.
 */
describe("E2E D: regression and failures", () => {
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

  it("rejects bad auth, bad ids, and bad bodies with envelopes", async () => {
    const { id, token } = await e2eCreateSession(ctx, {
      device_type: "desktop",
      symptoms: "No display on boot.",
      user_mode: "everyday",
    });

    const noToken = await request(ctx.app()).get(`/api/v1/sessions/${id}`);
    expect(noToken.status).toBe(403);
    const wrongToken = await request(ctx.app())
      .get(`/api/v1/sessions/${id}`)
      .set({ Authorization: "Bearer wrong" });
    expect(wrongToken.status).toBe(403);
    expect(wrongToken.body.error.code).toBe("forbidden");

    const unknown = await request(ctx.app())
      .get("/api/v1/sessions/12345678-1234-4123-8123-123456789012")
      .set({ Authorization: `Bearer ${token}` });
    expect(unknown.status).toBe(404);

    const malformed = await request(ctx.app())
      .get("/api/v1/sessions/not-a-uuid")
      .set({ Authorization: `Bearer ${token}` });
    expect(malformed.status).toBe(404);

    const badBody = await request(ctx.app()).post("/api/v1/sessions").send({
      device_type: "toaster",
      symptoms: "x",
      user_mode: "everyday",
    });
    expect(badBody.status).toBe(400);

    const badAnalyze = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/analyze`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ stage: "not_a_stage" });
    expect(badAnalyze.status).toBe(400);
  });

  it("rejects unsupported and oversized uploads without side effects", async () => {
    const { id, token } = await e2eCreateSession(ctx, {
      device_type: "laptop",
      symptoms: "Weird noise.",
      user_mode: "everyday",
    });
    const auth = { Authorization: `Bearer ${token}` };

    const script = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/evidence`)
      .set(auth)
      .attach("file", Buffer.from("console.log('x')"), {
        filename: "evil.js",
        contentType: "application/javascript",
      });
    expect(script.status).toBe(415);

    const renamed = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/evidence`)
      .set(auth)
      .attach("file", Buffer.from("not a png"), {
        filename: "fake.png",
        contentType: "image/png",
      });
    expect(renamed.status).toBe(415);

    const huge = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/evidence`)
      .set(auth)
      .attach("file", Buffer.alloc(11 * 1024 * 1024, 0), {
        filename: "huge.png",
        contentType: "image/png",
      });
    expect(huge.status).toBe(413);

    // Nothing was stored by the rejected uploads.
    const detail = await request(ctx.app()).get(`/api/v1/sessions/${id}`).set(auth);
    expect(detail.body.evidence).toHaveLength(0);
  });

  it("maps provider failures honestly and keeps prior state", async () => {
    const { id, token } = await e2eCreateSession(ctx, {
      device_type: "laptop",
      symptoms: "Battery drains fast.",
      user_mode: "everyday",
    });
    const auth = { Authorization: `Bearer ${token}` };
    const fileId = await e2eUploadPng(ctx, id, token, "battery.png");

    ctx.model.queue(new ModelError("rate_limited", "Slow down."));
    const limited = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/analyze`)
      .set(auth)
      .send({});
    expect(limited.status).toBe(429);

    ctx.model.queue(new ModelError("timeout", "Too slow."));
    const timedOut = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/analyze`)
      .set(auth)
      .send({});
    expect(timedOut.status).toBe(504);

    ctx.segmenter.failure = new ModelError("not_found", "No such model.");
    const segFailed = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/evidence/${fileId}/segmentations`)
      .set(auth)
      .send({ concepts: ["battery"] });
    expect(segFailed.status).toBe(502);
    ctx.segmenter.failure = null;

    // Failures persisted nothing; the session and evidence survive.
    const detail = await request(ctx.app()).get(`/api/v1/sessions/${id}`).set(auth);
    expect(detail.body.evidence).toHaveLength(1);
    expect(detail.body.hypotheses).toHaveLength(0);
    expect(detail.body.model_runs.length).toBeGreaterThan(0);
  });

  it("persists sessions across app restarts", async () => {
    const { id, token } = await e2eCreateSession(ctx, {
      device_type: "smartphone",
      symptoms: "Speaker crackles.",
      user_mode: "everyday",
    });
    await e2eUploadPng(ctx, id, token, "speaker.png");

    // A fresh app over the same database sees the same state.
    const fresh = ctx.app();
    const detail = await request(fresh)
      .get(`/api/v1/sessions/${id}`)
      .set({ Authorization: `Bearer ${token}` });
    expect(detail.status).toBe(200);
    expect(detail.body.session.symptoms).toBe("Speaker crackles.");
    expect(detail.body.evidence).toHaveLength(1);
  });

  it("gates admin and knowledge routes", async () => {
    const noToken = await request(ctx.app())
      .post("/api/v1/admin/documents")
      .send({ connector: "myfixit_dataset", ref: "x" });
    expect(noToken.status).toBe(403);

    const wrongToken = await request(ctx.app())
      .get("/api/v1/admin/ingestion-jobs/12345678-1234-4123-8123-123456789012")
      .set({ Authorization: "Bearer wrong" });
    expect(wrongToken.status).toBe(403);

    const badSearch = await request(ctx.app()).post("/api/v1/knowledge/search").send({
      query: "",
    });
    expect(badSearch.status).toBe(400);

    // A configured admin token passes the gate (missing row 404s after).
    const authed = await request(ctx.app())
      .get("/api/v1/admin/ingestion-jobs/12345678-1234-4123-8123-123456789012")
      .set({ Authorization: `Bearer ${ctx.adminToken}` });
    expect(authed.status).toBe(404);
  });

  it("refuses citations that do not resolve to real passages", async () => {
    const { id, token } = await e2eCreateSession(ctx, {
      device_type: "laptop",
      symptoms: "Won't boot.",
      user_mode: "everyday",
    });
    const auth = { Authorization: `Bearer ${token}` };

    const unknownChunk = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/citations`)
      .set(auth)
      .send({
        test_id: "12345678-1234-4123-8123-123456789012",
        chunk_id: "12345678-1234-4123-8123-123456789012",
        excerpt: "something",
      });
    expect(unknownChunk.status).toBe(404);

    const unlinked = await request(ctx.app())
      .post(`/api/v1/sessions/${id}/citations`)
      .set(auth)
      .send({
        chunk_id: "12345678-1234-4123-8123-123456789012",
        excerpt: "something",
      });
    expect(unlinked.status).toBe(400);
  });
});
