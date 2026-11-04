import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Kysely } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiErrorSchema,
  listSegmentationsResponseSchema,
  segmentResponseSchema,
} from "@fieldfix/contracts";
import { createApp } from "../src/app.js";
import type { AppEnv } from "../src/env.js";
import type { Database } from "../src/db/database.js";
import { LocalStorageAdapter } from "../src/storage/local-adapter.js";
import type { StorageAdapter } from "../src/storage/types.js";
import {
  ModelError,
  type SegmentCallInput,
  type SegmentationProvider,
  type SegmentationResult,
} from "../src/models/types.js";
import { SegmentationService } from "../src/vision/service.js";
import { setupTestDb, teardownTestDb, truncateAll } from "./db/setup.js";
import { MASK_6X4 } from "./vision/sam-fixture.js";
import { makePng } from "./vision/png-fixture.js";

const TEST_ENV: AppEnv = {
  NODE_ENV: "test",
  PORT: 3001,
  CORS_ORIGIN: "http://localhost:3000",
  API_VERSION: "0.1.0-test",
  STORAGE_DRIVER: "local",
  MAX_UPLOAD_MB: 10,
  IFIXIT_API_BASE_URL: "https://www.ifixit.com/api/2.0",
  META_MODEL_ID: "muse-spark-1.3",
  SAM_MODEL_ID: "sam-3.1",
  META_API_BASE_URL: "https://api.meta.ai/v1",
  META_REQUEST_TIMEOUT_MS: 60000,
  META_MAX_RETRIES: 3,
  META_REASONING_EFFORT: "medium",
  META_MAX_OUTPUT_TOKENS: 4000,
  META_MAX_IMAGES_PER_REQUEST: 8,
  META_MAX_IMAGE_BYTES: 10 * 1024 * 1024,
  VOICE_MODEL_ID: "muse-voice-transcribe-1.0",
  VOICE_MAX_AUDIO_MB: 32,
  EMAIL_FROM: "FieldFix AI <tests@example.com>",
  APP_BASE_URL: "http://localhost:3000",
};

class FakeSegmentationProvider implements SegmentationProvider {
  readonly id = "fake-sam";
  calls: SegmentCallInput[] = [];
  objects: SegmentationResult["objects"] = [];
  failure: ModelError | null = null;

  async segment(input: SegmentCallInput): Promise<SegmentationResult> {
    this.calls.push(input);
    if (this.failure) {
      throw this.failure;
    }
    return {
      model: "fake-sam-1",
      objects: this.objects,
      warnings: [],
      latencyMs: 5,
      attempts: 1,
    };
  }
}

function batteryObject(): SegmentationResult["objects"][number] {
  return {
    objectId: "0",
    box: { left: 10, top: 20, right: 16, bottom: 24 },
    mask: {
      rows: 4,
      cols: 6,
      encoding: "one_bit",
      payload: MASK_6X4,
      bounds: { left: 10, top: 20, right: 16, bottom: 24 },
    },
  };
}

describe("segmentation routes", () => {
  let db: Kysely<Database>;
  let storageDir: string;
  let storage: StorageAdapter;
  let provider: FakeSegmentationProvider;

  function app() {
    const service = new SegmentationService({
      db,
      storage,
      provider,
      modelId: "sam-3.1",
    });
    return createApp(TEST_ENV, { db, storage, segmentation: service });
  }

  async function createSession(): Promise<{ id: string; token: string }> {
    const res = await request(app()).post("/api/v1/sessions").send({
      device_type: "laptop",
      symptoms: "Something looks wrong.",
      user_mode: "everyday",
    });
    expect(res.status).toBe(201);
    return { id: res.body.session.id as string, token: res.body.accessToken as string };
  }

  async function uploadImage(sessionId: string, token: string): Promise<string> {
    const res = await request(app())
      .post(`/api/v1/sessions/${sessionId}/evidence`)
      .set({ Authorization: `Bearer ${token}` })
      .attach("file", makePng(100, 80), { filename: "photo.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    return res.body.file.id as string;
  }

  beforeAll(async () => {
    db = await setupTestDb();
    storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-segment-http-"));
    storage = new LocalStorageAdapter(storageDir);
  });

  afterAll(async () => {
    await teardownTestDb(db);
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAll(db);
    provider = new FakeSegmentationProvider();
  });

  it("returns 500 instead of crashing when segmentation fails", async () => {
    const { id, token } = await createSession();
    const auth = { Authorization: `Bearer ${token}` };
    const fileId = await uploadImage(id, token);
    // Spy the service (not the provider: provider failures are domain
    // errors mapped to 502). This simulates an unexpected service failure.
    const spy = vi
      .spyOn(SegmentationService.prototype, "segment")
      .mockRejectedValueOnce(new Error("simulated service failure"));
    try {
      const res = await request(app())
        .post(`/api/v1/sessions/${id}/evidence/${fileId}/segmentations`)
        .set(auth)
        .send({ concepts: ["battery"] });
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("internal_error");
    } finally {
      spy.mockRestore();
    }
  });

  it("segments an image and serves annotations with SVG paths", async () => {
    const { id, token } = await createSession();
    const auth = { Authorization: `Bearer ${token}` };
    const fileId = await uploadImage(id, token);
    provider.objects = [batteryObject()];

    const segmented = await request(app())
      .post(`/api/v1/sessions/${id}/evidence/${fileId}/segmentations`)
      .set(auth)
      .send({ concepts: ["battery"] });
    expect(segmented.status).toBe(201);
    expect(segmentResponseSchema.safeParse(segmented.body).success).toBe(true);
    expect(segmented.body.concepts_used).toEqual(["battery"]);
    expect(segmented.body.annotations).toHaveLength(2);
    expect(segmented.body.annotations[0]).toMatchObject({
      kind: "box",
      label: "battery",
      producer: "sam-3.1",
      image_width: 100,
      image_height: 80,
      svg_path: null,
    });
    expect(segmented.body.annotations[1]).toMatchObject({
      kind: "mask",
      label: "battery",
    });
    expect(segmented.body.annotations[1].svg_path).toMatch(/^M/);
    expect(segmented.body.runs).toHaveLength(1);
    expect(segmented.body.runs[0]).toMatchObject({ concept: "battery", model_id: "sam-3.1" });

    const listed = await request(app())
      .get(`/api/v1/sessions/${id}/evidence/${fileId}/segmentations`)
      .set(auth);
    expect(listed.status).toBe(200);
    expect(listSegmentationsResponseSchema.safeParse(listed.body).success).toBe(true);
    expect(listed.body.annotations).toHaveLength(2);
    expect(listed.body.image_width).toBe(100);
    expect(listed.body.image_height).toBe(80);
  });

  it("creates desktop sessions with the desktop component vocabulary", async () => {
    const created = await request(app()).post("/api/v1/sessions").send({
      device_type: "desktop",
      symptoms: "No display on boot.",
      user_mode: "everyday",
    });
    expect(created.status).toBe(201);
    const id = created.body.session.id as string;
    const token = created.body.accessToken as string;
    const auth = { Authorization: `Bearer ${token}` };

    const uploaded = await request(app())
      .post(`/api/v1/sessions/${id}/evidence`)
      .set(auth)
      .attach("file", makePng(100, 80), { filename: "tower.png", contentType: "image/png" });
    const fileId = uploaded.body.file.id as string;

    const segmented = await request(app())
      .post(`/api/v1/sessions/${id}/evidence/${fileId}/segmentations`)
      .set(auth)
      .send({});
    expect(segmented.status).toBe(201);
    expect(segmented.body.concepts_used).toContain("power supply");
    expect(segmented.body.concepts_used).toContain("graphics card");
    expect(provider.calls).toHaveLength(8);
  });

  it("requires session access and valid ids", async () => {
    const { id, token } = await createSession();
    const fileId = await uploadImage(id, token);

    const noToken = await request(app())
      .post(`/api/v1/sessions/${id}/evidence/${fileId}/segmentations`)
      .send({ concepts: ["battery"] });
    expect(noToken.status).toBe(403);

    const unknownFile = await request(app())
      .post(`/api/v1/sessions/${id}/evidence/12345678-1234-4123-8123-123456789012/segmentations`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ concepts: ["battery"] });
    expect(unknownFile.status).toBe(404);

    const malformed = await request(app())
      .get(`/api/v1/sessions/${id}/evidence/not-a-uuid/segmentations`)
      .set({ Authorization: `Bearer ${token}` });
    expect(malformed.status).toBe(404);
  });

  it("rejects bad concepts and failing providers honestly", async () => {
    const { id, token } = await createSession();
    const auth = { Authorization: `Bearer ${token}` };
    const fileId = await uploadImage(id, token);

    const badBody = await request(app())
      .post(`/api/v1/sessions/${id}/evidence/${fileId}/segmentations`)
      .set(auth)
      .send({ concepts: ["ok", "bad<concept"] });
    expect(badBody.status).toBe(400);
    expect(apiErrorSchema.safeParse(badBody.body).success).toBe(true);

    provider.failure = new ModelError("not_found", "No such model.");
    const failed = await request(app())
      .post(`/api/v1/sessions/${id}/evidence/${fileId}/segmentations`)
      .set(auth)
      .send({ concepts: ["battery"] });
    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe("provider_failed");

    const listed = await request(app())
      .get(`/api/v1/sessions/${id}/evidence/${fileId}/segmentations`)
      .set(auth);
    expect(listed.body.annotations).toHaveLength(0);
  });

  it("degrades honestly when the model is unavailable", async () => {
    // Wired app without an injected service and without META_API_KEY.
    const bare = createApp(TEST_ENV, { db, storage });
    const created = await request(bare).post("/api/v1/sessions").send({
      device_type: "laptop",
      symptoms: "Something looks wrong.",
      user_mode: "everyday",
    });
    const sessionId = created.body.session.id as string;
    const token = created.body.accessToken as string;
    const uploaded = await request(bare)
      .post(`/api/v1/sessions/${sessionId}/evidence`)
      .set({ Authorization: `Bearer ${token}` })
      .attach("file", makePng(100, 80), { filename: "p.png", contentType: "image/png" });
    const fileId = uploaded.body.file.id as string;

    const segmented = await request(bare)
      .post(`/api/v1/sessions/${sessionId}/evidence/${fileId}/segmentations`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ concepts: ["battery"] });
    expect(segmented.status).toBe(502);
    expect(apiErrorSchema.safeParse(segmented.body).success).toBe(true);
  });
});
