import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Kysely } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getIdentificationResponseSchema,
  identifyResponseSchema,
} from "@fieldfix/contracts";
import { createApp } from "../src/app.js";
import type { AppEnv } from "../src/env.js";
import type { Database } from "../src/db/database.js";
import { LocalStorageAdapter } from "../src/storage/local-adapter.js";
import type { StorageAdapter } from "../src/storage/types.js";
import {
  ModelError,
  type CallModality,
  type ModelProvider,
  type ProviderPrompt,
  type ProviderTextResult,
  type SegmentCallInput,
  type SegmentationProvider,
  type SegmentationResult,
} from "../src/models/types.js";
import { SegmentationService } from "../src/vision/service.js";
import { IdentificationService } from "../src/vision/identification.js";
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

const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";

class FakeVisionProvider implements ModelProvider {
  readonly id = "fake-vision";
  readonly modalities: readonly CallModality[] = ["text", "image"];
  prompts: ProviderPrompt[] = [];
  text = "";
  failure: ModelError | null = null;

  async complete(prompt: ProviderPrompt): Promise<ProviderTextResult> {
    this.prompts.push(prompt);
    if (this.failure) {
      throw this.failure;
    }
    return { text: this.text, model: "fake-vision-1", latencyMs: 5, attempts: 1 };
  }
}

class FakeSegmentationProvider implements SegmentationProvider {
  readonly id = "fake-sam";
  calls: SegmentCallInput[] = [];
  objects: SegmentationResult["objects"] = [];
  /** Per-call results consumed in order; falls back to `objects` when empty. */
  objectQueue: SegmentationResult["objects"][] = [];
  failure: ModelError | null = null;

  async segment(input: SegmentCallInput): Promise<SegmentationResult> {
    this.calls.push(input);
    if (this.failure) {
      throw this.failure;
    }
    const objects = this.objectQueue.shift() ?? this.objects;
    return { model: "fake-sam-1", objects, warnings: [], latencyMs: 5, attempts: 1 };
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

function visionPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    device_name: "Test Laptop 14",
    components: [
      { name: "battery", confidence: "high", note: "Bottom compartment." },
      { name: "cooling fan", confidence: "medium", note: null },
      { name: "mystery chip", confidence: "low", note: null },
    ],
    suspected_fault_area: {
      component_name: "battery",
      rationale: "The connector area looks discolored.",
    },
    unidentifiable: ["small bracket at the top edge"],
    ...overrides,
  });
}

describe("identification routes", () => {
  let db: Kysely<Database>;
  let storageDir: string;
  let storage: StorageAdapter;
  let vision: FakeVisionProvider;
  let sam: FakeSegmentationProvider;

  function app() {
    const segmentation = new SegmentationService({
      db,
      storage,
      provider: sam,
      modelId: "sam-3.1",
    });
    const identification = new IdentificationService({
      db,
      storage,
      vision,
      modelId: "fake-vision-1",
      segmentation,
    });
    return createApp(TEST_ENV, { db, storage, segmentation, identification });
  }

  async function createSession(): Promise<{ id: string; token: string }> {
    const res = await request(app()).post("/api/v1/sessions").send({
      device_type: "laptop",
      symptoms: "Battery drains fast.",
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

  async function uploadVideo(sessionId: string, token: string): Promise<string> {
    const ftyp = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x66, 0x74, 0x79, 0x70]);
    const res = await request(app())
      .post(`/api/v1/sessions/${sessionId}/evidence`)
      .set({ Authorization: `Bearer ${token}` })
      .attach("file", ftyp, { filename: "clip.mp4", contentType: "video/mp4" });
    expect(res.status).toBe(201);
    return res.body.file.id as string;
  }

  beforeAll(async () => {
    db = await setupTestDb();
    storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-identify-"));
    storage = new LocalStorageAdapter(storageDir);
  });

  afterAll(async () => {
    await teardownTestDb(db);
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAll(db);
    vision = new FakeVisionProvider();
    vision.text = visionPayload();
    sam = new FakeSegmentationProvider();
    sam.objects = [batteryObject()];
  });

  it("identifies, persists, and localizes high/medium components", async () => {
    const { id, token } = await createSession();
    const auth = { Authorization: `Bearer ${token}` };
    const fileId = await uploadImage(id, token);
    const res = await request(app())
      .post(`/api/v1/sessions/${id}/evidence/${fileId}/identification`)
      .set(auth);
    expect(res.status).toBe(201);
    const parsed = identifyResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error("identify response failed contract validation");
    }
    expect(parsed.data.identification.device_name).toBe("Test Laptop 14");
    expect(parsed.data.identification.components).toHaveLength(3);
    expect(parsed.data.identification.suspected_fault_area?.component_name).toBe("battery");
    expect(parsed.data.identification.unidentifiable).toEqual([
      "small bracket at the top edge",
    ]);
    // High + medium names localize; the low-confidence name does not.
    expect(parsed.data.concepts_used).toEqual(["battery", "cooling fan"]);
    expect(sam.calls.map((c) => c.concept)).toEqual(["battery", "cooling fan"]);
    // One box + one mask per concept with the shared fake object.
    expect(parsed.data.annotations).toHaveLength(4);
    // The vision call received the image plus symptom context.
    expect(vision.prompts).toHaveLength(1);
    expect(vision.prompts[0]?.images).toHaveLength(1);
    expect(vision.prompts[0]?.jsonSchema.strict).toBe(true);

    // The pass is retrievable and the run is task-typed.
    const latest = await request(app())
      .get(`/api/v1/sessions/${id}/evidence/${fileId}/identification`)
      .set(auth);
    expect(latest.status).toBe(200);
    const latestParsed = getIdentificationResponseSchema.safeParse(latest.body);
    expect(latestParsed.success).toBe(true);
    const runs = await db.selectFrom("model_runs").selectAll().execute();
    expect(runs.some((r) => r.task_type === "identification" && r.status === "succeeded")).toBe(true);
  });

  it("falls back to the generic device sweep when names do not ground", async () => {
    const { id, token } = await createSession();
    const fileId = await uploadImage(id, token);
    // Named concepts find nothing; the generic laptop sweep finds the
    // battery object on its first concept.
    sam.objectQueue = [[], [], [batteryObject()], [], [], [], [], [], [], []];
    const res = await request(app())
      .post(`/api/v1/sessions/${id}/evidence/${fileId}/identification`)
      .set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(201);
    expect(sam.calls.map((c) => c.concept).slice(0, 2)).toEqual(["battery", "cooling fan"]);
    expect(sam.calls.map((c) => c.concept)).toContain("keyboard");
    expect(res.body.annotations.length).toBeGreaterThan(0);
    expect(res.body.warnings.join(" ")).toContain("generic device parts");
  });

  it("returns 404 when a file was never identified", async () => {
    const { id, token } = await createSession();
    const fileId = await uploadImage(id, token);
    const res = await request(app())
      .get(`/api/v1/sessions/${id}/evidence/${fileId}/identification`)
      .set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("identification_not_found");
  });

  it("rejects video without calling the provider", async () => {
    const { id, token } = await createSession();
    const fileId = await uploadVideo(id, token);
    const res = await request(app())
      .post(`/api/v1/sessions/${id}/evidence/${fileId}/identification`)
      .set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("not_supported");
    expect(vision.prompts).toHaveLength(0);
  });

  it("404s for unknown files and other sessions' files", async () => {
    const { id, token } = await createSession();
    const auth = { Authorization: `Bearer ${token}` };
    const missing = await request(app())
      .post(`/api/v1/sessions/${id}/evidence/${UNKNOWN_ID}/identification`)
      .set(auth);
    expect(missing.status).toBe(404);

    const other = await createSession();
    const foreignFile = await uploadImage(other.id, other.token);
    const cross = await request(app())
      .post(`/api/v1/sessions/${id}/evidence/${foreignFile}/identification`)
      .set(auth);
    expect(cross.status).toBe(404);
  });

  it("maps vision failures to 502 and persists nothing", async () => {
    const { id, token } = await createSession();
    const auth = { Authorization: `Bearer ${token}` };
    const fileId = await uploadImage(id, token);
    vision.failure = new ModelError("unavailable", "Vision down.");
    const res = await request(app())
      .post(`/api/v1/sessions/${id}/evidence/${fileId}/identification`)
      .set(auth);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("provider_failed");
    const latest = await request(app())
      .get(`/api/v1/sessions/${id}/evidence/${fileId}/identification`)
      .set(auth);
    expect(latest.status).toBe(404);
  });

  it("maps unparseable vision output to 502", async () => {
    const { id, token } = await createSession();
    const fileId = await uploadImage(id, token);
    vision.text = "not json at all";
    const res = await request(app())
      .post(`/api/v1/sessions/${id}/evidence/${fileId}/identification`)
      .set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(502);
  });

  it("degrades to names-only when localization fails", async () => {
    const { id, token } = await createSession();
    const auth = { Authorization: `Bearer ${token}` };
    const fileId = await uploadImage(id, token);
    sam.failure = new ModelError("unavailable", "SAM down.");
    const res = await request(app())
      .post(`/api/v1/sessions/${id}/evidence/${fileId}/identification`)
      .set(auth);
    expect(res.status).toBe(201);
    expect(res.body.annotations).toHaveLength(0);
    expect(res.body.concepts_used).toHaveLength(0);
    expect(res.body.warnings.join(" ")).toContain("localization skipped");
    expect(res.body.identification.components).toHaveLength(3);
  });

  it("warns and sweeps generically when nothing is confident enough to locate", async () => {
    const { id, token } = await createSession();
    const fileId = await uploadImage(id, token);
    vision.text = visionPayload({
      components: [{ name: "blurry thing", confidence: "low", note: null }],
      suspected_fault_area: null,
    });
    const res = await request(app())
      .post(`/api/v1/sessions/${id}/evidence/${fileId}/identification`)
      .set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(201);
    expect(res.body.warnings.join(" ")).toContain("No confident component names");
    // The generic device sweep still outlines parts so the photo is
    // never bare — 8 laptop concepts, all finding the fake object.
    expect(sam.calls).toHaveLength(8);
    expect(res.body.annotations.length).toBeGreaterThan(0);
  });

  it("returns 500 instead of crashing on unexpected failures", async () => {
    const { id, token } = await createSession();
    const fileId = await uploadImage(id, token);
    const spy = vi
      .spyOn(IdentificationService.prototype, "identify")
      .mockRejectedValueOnce(new Error("simulated service failure"));
    try {
      const res = await request(app())
        .post(`/api/v1/sessions/${id}/evidence/${fileId}/identification`)
        .set({ Authorization: `Bearer ${token}` });
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("internal_error");
    } finally {
      spy.mockRestore();
    }
  });
});
