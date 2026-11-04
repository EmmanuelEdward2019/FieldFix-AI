import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/db/database.js";
import { SessionRepository } from "../../src/db/repositories/sessions.js";
import { EvidenceFileRepository } from "../../src/db/repositories/evidence.js";
import { HypothesisRepository } from "../../src/db/repositories/hypotheses.js";
import { ModelRunRepository } from "../../src/db/repositories/model-runs.js";
import { LocalStorageAdapter } from "../../src/storage/local-adapter.js";
import type { StorageAdapter } from "../../src/storage/types.js";
import {
  ModelError,
  type SegmentCallInput,
  type SegmentationProvider,
  type SegmentationResult,
} from "../../src/models/types.js";
import {
  SegmentationService,
  maskAnnotationToSvgPath,
} from "../../src/vision/service.js";
import { setupTestDb, teardownTestDb, truncateAll } from "../db/setup.js";
import { MASK_6X4 } from "./sam-fixture.js";
import { makePng } from "./png-fixture.js";

const IMAGE_WIDTH = 100;
const IMAGE_HEIGHT = 80;

class FakeSegmentationProvider implements SegmentationProvider {
  readonly id = "fake-sam";
  calls: SegmentCallInput[] = [];
  private script: Array<
    { ok: true; objects: SegmentationResult["objects"] } | { ok: false; error: ModelError }
  > = [];
  private cursor = 0;

  queueObjects(objects: SegmentationResult["objects"]): void {
    this.script.push({ ok: true, objects });
  }

  queueFailure(error: ModelError): void {
    this.script.push({ ok: false, error });
  }

  async segment(input: SegmentCallInput): Promise<SegmentationResult> {
    this.calls.push(input);
    const step = this.script[this.cursor];
    this.cursor += 1;
    if (!step) {
      throw new ModelError("unavailable", "Fake script exhausted.");
    }
    if (!step.ok) {
      throw step.error;
    }
    return {
      model: "fake-sam-1",
      objects: step.objects,
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

describe("SegmentationService (real DB + storage, mocked provider)", () => {
  let db: Kysely<Database>;
  let storageDir: string;
  let storage: StorageAdapter;
  let provider: FakeSegmentationProvider;
  let service: SegmentationService;

  beforeAll(async () => {
    db = await setupTestDb();
    storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-segment-"));
    storage = new LocalStorageAdapter(storageDir);
  });

  afterAll(async () => {
    await teardownTestDb(db);
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAll(db);
    provider = new FakeSegmentationProvider();
    service = new SegmentationService({
      db,
      storage,
      provider,
      modelId: "sam-3.1",
    });
  });

  async function makeSession(deviceType: "laptop" | "smartphone" = "laptop"): Promise<string> {
    const session = await new SessionRepository(db).create({
      device_type: deviceType,
      symptoms: "Something looks wrong.",
      user_mode: "everyday",
      access_token_hash: `hash-${Math.random()}`,
    });
    return session.id;
  }

  async function storeImage(
    sessionId: string,
    bytes: Buffer = makePng(IMAGE_WIDTH, IMAGE_HEIGHT),
  ): Promise<string> {
    const key = `sessions/${sessionId}/photo-${Math.random().toString(36).slice(2)}.png`;
    await storage.put(key, bytes, "image/png");
    const file = await new EvidenceFileRepository(db).create(sessionId, {
      storage_key: key,
      media_type: "image/png",
      byte_size: bytes.length,
      kind: "image",
    });
    return file.id;
  }

  it("persists box+mask geometry with image dims and run records", async () => {
    const sessionId = await makeSession();
    const fileId = await storeImage(sessionId);
    provider.queueObjects([batteryObject()]);

    const outcome = await service.segment(sessionId, fileId, ["battery"]);
    expect(outcome.conceptsUsed).toEqual(["battery"]);
    expect(outcome.imageWidth).toBe(IMAGE_WIDTH);
    expect(outcome.imageHeight).toBe(IMAGE_HEIGHT);
    expect(outcome.warnings).toEqual([]);
    expect(outcome.annotations).toHaveLength(2);

    const [box, mask] = outcome.annotations;
    expect(box?.kind).toBe("box");
    expect(box?.coordinates).toEqual({ x: 10, y: 20, width: 6, height: 4 });
    expect(box?.label).toBe("battery");
    expect(box?.producer).toBe("sam-3.1");
    expect(box?.image_width).toBe(IMAGE_WIDTH);
    expect(box?.image_height).toBe(IMAGE_HEIGHT);
    expect(box?.model_run_id).toBe(outcome.runs[0]?.id);

    expect(mask?.kind).toBe("mask");
    expect(mask?.coordinates).toEqual({
      rows: 4,
      cols: 6,
      data: MASK_6X4,
      bounds: { left: 10, top: 20, right: 16, bottom: 24 },
    });

    expect(outcome.runs).toHaveLength(1);
    const run = await new ModelRunRepository(db).getById(outcome.runs[0]?.id as string);
    expect(run).toMatchObject({
      task_type: "segmentation",
      status: "succeeded",
      validation_status: "passed",
      model_id: "sam-3.1",
    });
    expect(run?.input_modality).toEqual(["image"]);

    // Geometry round-trips byte-identically.
    const reread = await service.list(fileId);
    expect(reread).toHaveLength(2);
    expect(reread[0]?.coordinates).toEqual(box?.coordinates);
    expect(reread[1]?.coordinates).toEqual(mask?.coordinates);

    // Masks decode to a renderable SVG path.
    if (!mask) {
      throw new Error("expected a mask annotation");
    }
    expect(maskAnnotationToSvgPath(mask.coordinates)).toMatch(/^M/);
  });

  it("leaves original bytes and fault state untouched", async () => {
    const sessionId = await makeSession();
    const bytes = makePng(IMAGE_WIDTH, IMAGE_HEIGHT);
    const fileId = await storeImage(sessionId, bytes);
    provider.queueObjects([batteryObject()]);

    await service.segment(sessionId, fileId, ["battery"]);

    const files = new EvidenceFileRepository(db);
    const file = await files.getById(fileId);
    const reread = await storage.get(file?.storage_key as string);
    expect(reread.equals(bytes)).toBe(true);

    expect(await new HypothesisRepository(db).listBySession(sessionId)).toHaveLength(0);
  });

  it("uses device vocabularies by default and reports zero matches", async () => {
    const sessionId = await makeSession("smartphone");
    const fileId = await storeImage(sessionId);
    for (let i = 0; i < 8; i += 1) {
      provider.queueObjects([]);
    }
    const outcome = await service.segment(sessionId, fileId);
    expect(outcome.conceptsUsed).toEqual([
      "screen",
      "battery",
      "camera",
      "charging port",
      "speaker",
      "side button",
      "back cover",
      "sim tray",
    ]);
    expect(outcome.annotations).toHaveLength(0);
    expect(outcome.runs).toHaveLength(8);
    expect(outcome.warnings).toHaveLength(8);
    expect(provider.calls).toHaveLength(8);
    expect(provider.calls[0]?.imageWidth).toBe(IMAGE_WIDTH);
  });

  it("persists nothing when the provider fails", async () => {
    const sessionId = await makeSession();
    const fileId = await storeImage(sessionId);
    provider.queueObjects([batteryObject()]);
    provider.queueFailure(new ModelError("unavailable", "Provider down."));

    await expect(service.segment(sessionId, fileId, ["battery", "screen"])).rejects.toMatchObject(
      { code: "provider_failed" },
    );
    expect(await service.list(fileId)).toHaveLength(0);
    expect(await new ModelRunRepository(db).listBySession(sessionId)).toHaveLength(0);
  });

  it("rejects non-images, unknown files, and bad concepts", async () => {
    const sessionId = await makeSession();
    const fileId = await storeImage(sessionId);

    const key = `sessions/${sessionId}/notes.txt`;
    const text = Buffer.from("hello");
    await storage.put(key, text, "text/plain");
    const textFile = await new EvidenceFileRepository(db).create(sessionId, {
      storage_key: key,
      media_type: "text/plain",
      byte_size: text.length,
      kind: "image",
    });
    await expect(service.segment(sessionId, textFile.id, ["battery"])).rejects.toMatchObject({
      code: "not_an_image",
    });
    await expect(
      service.segment(sessionId, "12345678-1234-4123-8123-123456789012", ["battery"]),
    ).rejects.toMatchObject({ code: "file_not_found" });
    await expect(service.segment(sessionId, fileId, [])).rejects.toMatchObject({
      code: "invalid_concepts",
    });
    await expect(service.segment(sessionId, fileId, ["a<b"])).rejects.toMatchObject({
      code: "invalid_concepts",
    });
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects corrupt image bytes", async () => {
    const sessionId = await makeSession();
    const fileId = await storeImage(sessionId, Buffer.from("not a png at all"));
    await expect(service.segment(sessionId, fileId, ["battery"])).rejects.toMatchObject({
      code: "unreadable_image",
    });
    expect(provider.calls).toHaveLength(0);
  });

  it("degrades mask SVG reads instead of throwing", async () => {
    expect(maskAnnotationToSvgPath({ x: 1, y: 2, width: 3, height: 4 })).toBeNull();
    expect(
      maskAnnotationToSvgPath({ rows: 4, cols: 6, data: "no-marker-here" }),
    ).toBeNull();
    expect(
      maskAnnotationToSvgPath({ rows: 4, cols: 6, data: "!bogus!!" }),
    ).toBeNull();
  });
});
