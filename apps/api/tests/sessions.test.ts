import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Kysely } from "kysely";
import {
  apiErrorSchema,
  createSessionResponseSchema,
  sessionDetailResponseSchema,
  uploadEvidenceResponseSchema,
} from "@fieldfix/contracts";
import { createApp } from "../src/app.js";
import type { Database } from "../src/db/database.js";
import { setupTestDb, teardownTestDb, truncateAll } from "./db/setup.js";
import { EvidenceFileRepository } from "../src/db/repositories/evidence.js";
import type { AppEnv } from "../src/env.js";
import { LocalStorageAdapter } from "../src/storage/local-adapter.js";
import { StorageError, type StorageAdapter } from "../src/storage/types.js";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);

const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypisom", "ascii"),
  Buffer.alloc(64, 9),
]);

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

let db: Kysely<Database>;
let storageDir: string;
let storage: StorageAdapter;

function app() {
  return createApp(TEST_ENV, { db, storage });
}

async function createSession(extra: Record<string, unknown> = {}) {
  const res = await request(app())
    .post("/api/v1/sessions")
    .send({
      device_type: "laptop",
      manufacturer: "Acme",
      model: "AcmeBook Pro 14",
      symptoms: "Will not power on.",
      user_mode: "everyday",
      ...extra,
    });
  expect(res.status).toBe(201);
  const parsed = createSessionResponseSchema.safeParse(res.body);
  expect(parsed.success).toBe(true);
  if (!parsed.success) {
    throw new Error("create session response failed contract validation");
  }
  return parsed.data;
}

beforeAll(async () => {
  db = await setupTestDb();
  storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-storage-"));
  storage = new LocalStorageAdapter(storageDir);
});

afterAll(async () => {
  await teardownTestDb(db);
  await rm(storageDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await truncateAll(db);
});

describe("POST /api/v1/sessions", () => {
  it("creates a session and reveals the access token once", async () => {
    const res = await request(app()).post("/api/v1/sessions").send({
      device_type: "smartphone",
      symptoms: "Screen stays black.",
      user_mode: "technician",
    });
    expect(res.status).toBe(201);
    const parsed = createSessionResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    expect(res.body.session.status).toBe("open");
    expect(res.body.session.safety_state).toBe("normal");
    expect(res.body.accessToken).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.session).not.toHaveProperty("access_token_hash");
    expect(res.body.session).not.toHaveProperty("accessToken");
  });

  it("rejects invalid bodies with the error envelope", async () => {
    const res = await request(app())
      .post("/api/v1/sessions")
      .send({ device_type: "laptop", user_mode: "everyday" });
    expect(res.status).toBe(400);
    const parsed = apiErrorSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.error.code).toBe("invalid_request");
    }
  });

  it("rejects malformed JSON with a 400 envelope, not a 500", async () => {
    const res = await request(app())
      .post("/api/v1/sessions")
      .set("Content-Type", "application/json")
      .send("{not-json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
  });

  it("returns 503 when the app has no database", async () => {
    const noDb = createApp(TEST_ENV);
    const res = await request(noDb).post("/api/v1/sessions").send({
      device_type: "laptop",
      symptoms: "x",
      user_mode: "everyday",
    });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("database_unavailable");
  });
});

describe("GET /api/v1/sessions/:id", () => {
  it("returns the session detail with a valid token", async () => {
    const { session, accessToken } = await createSession();
    const res = await request(app())
      .get(`/api/v1/sessions/${session.id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(sessionDetailResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.session.id).toBe(session.id);
    expect(res.body.evidence).toEqual([]);
    expect(res.body.observations).toEqual([]);
    // Extended detail carries the full loop state for the dashboard.
    for (const key of ["hypotheses", "tests", "citations", "safety_events", "model_runs"]) {
      expect(res.body[key]).toEqual([]);
    }
    // Creation itself is logged for the account activity feed.
    expect(res.body.events.map((e: { event_type: string }) => e.event_type)).toEqual([
      "session_created",
    ]);
  });

  it("returns 404 for unknown or malformed ids", async () => {
    const { accessToken } = await createSession();
    const missing = await request(app())
      .get("/api/v1/sessions/00000000-0000-4000-8000-000000000000")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("session_not_found");

    const malformed = await request(app())
      .get("/api/v1/sessions/not-a-uuid")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(malformed.status).toBe(404);
  });

  it("returns 403 without a token or with the wrong token", async () => {
    const { session, accessToken } = await createSession();
    const other = await createSession({ device_type: "smartphone" });

    const missing = await request(app()).get(`/api/v1/sessions/${session.id}`);
    expect(missing.status).toBe(403);

    const wrong = await request(app())
      .get(`/api/v1/sessions/${session.id}`)
      .set("Authorization", `Bearer ${other.accessToken}`);
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe("forbidden");

    // A token for one session grants nothing on another.
    const cross = await request(app())
      .get(`/api/v1/sessions/${other.session.id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(cross.status).toBe(403);
  });
});

describe("POST /api/v1/sessions/:id/evidence", () => {
  it("stores bytes privately and metadata in the database", async () => {
    const { session, accessToken } = await createSession();
    const res = await request(app())
      .post(`/api/v1/sessions/${session.id}/evidence`)
      .set("Authorization", `Bearer ${accessToken}`)
      .field("observation", "Dark adapter LED.")
      .attach("file", PNG, {
        filename: "adapter.png",
        contentType: "image/png",
      });
    expect(res.status).toBe(201);
    expect(uploadEvidenceResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.file.media_type).toBe("image/png");
    expect(res.body.file.byte_size).toBe(PNG.length);
    expect(res.body.file.original_filename).toBe("adapter.png");
    expect(res.body.file.processing_status).toBe("ready");
    expect(res.body.file.checksum_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.observation?.body).toBe("Dark adapter LED.");
    expect(res.body.file).not.toHaveProperty("storage_key");

    const files = new EvidenceFileRepository(db);
    const rows = await files.listBySession(session.id);
    expect(rows).toHaveLength(1);
    const stored = await storage.get(rows[0]?.storage_key ?? "");
    expect(stored.equals(PNG)).toBe(true);
  });

  it("stores video evidence with kind video", async () => {
    const { session, accessToken } = await createSession();
    const res = await request(app())
      .post(`/api/v1/sessions/${session.id}/evidence`)
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", MP4, {
        filename: "rattle.mp4",
        contentType: "video/mp4",
      });
    expect(res.status).toBe(201);
    expect(uploadEvidenceResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.file.media_type).toBe("video/mp4");
    expect(res.body.file.kind).toBe("video");
    expect(res.body.file.processing_status).toBe("ready");

    const preview = await request(app())
      .get(`/api/v1/sessions/${session.id}/evidence/${res.body.file.id}/download`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(preview.status).toBe(200);
    expect(preview.headers["content-type"]).toBe("video/mp4");
  });

  it("rejects non-image files with 415", async () => {
    const { session, accessToken } = await createSession();
    const res = await request(app())
      .post(`/api/v1/sessions/${session.id}/evidence`)
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", Buffer.from("#!/bin/sh\nevil\n"), {
        filename: "run.sh",
        contentType: "text/plain",
      });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("unsupported_media_type");
  });

  it("rejects bytes that contradict the declared type with 415", async () => {
    const { session, accessToken } = await createSession();
    const res = await request(app())
      .post(`/api/v1/sessions/${session.id}/evidence`)
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", Buffer.from("definitely not a png"), {
        filename: "fake.png",
        contentType: "image/png",
      });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("file_content_mismatch");
  });

  it("rejects missing files with 400 and oversized files with 413", async () => {
    const { session, accessToken } = await createSession();
    const missing = await request(app())
      .post(`/api/v1/sessions/${session.id}/evidence`)
      .set("Authorization", `Bearer ${accessToken}`)
      .field("observation", "No file attached.");
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("file_missing");

    const tinyEnv: AppEnv = { ...TEST_ENV, MAX_UPLOAD_MB: 1 };
    const tinyApp = createApp(tinyEnv, { db, storage });
    const big = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(1024 * 1024, 1),
    ]);
    const oversized = await request(tinyApp)
      .post(`/api/v1/sessions/${session.id}/evidence`)
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", big, {
        filename: "big.png",
        contentType: "image/png",
      });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe("file_too_large");
  });

  it("requires session access for uploads", async () => {
    const { session } = await createSession();
    const res = await request(app())
      .post(`/api/v1/sessions/${session.id}/evidence`)
      .attach("file", PNG, {
        filename: "adapter.png",
        contentType: "image/png",
      });
    expect(res.status).toBe(403);
  });

  it("returns 500 without metadata when storage fails", async () => {
    const failing: StorageAdapter = {
      driver: "failing-test-double",
      put: async () => {
        throw new StorageError("disk on fire");
      },
      get: async () => {
        throw new StorageError("disk on fire");
      },
      delete: async () => undefined,
    };
    const brokenApp = createApp(TEST_ENV, { db, storage: failing });
    const created = await request(brokenApp).post("/api/v1/sessions").send({
      device_type: "laptop",
      symptoms: "Will not power on.",
      user_mode: "everyday",
    });
    expect(created.status).toBe(201);

    const res = await request(brokenApp)
      .post(`/api/v1/sessions/${created.body.session.id}/evidence`)
      .set("Authorization", `Bearer ${created.body.accessToken}`)
      .attach("file", PNG, {
        filename: "adapter.png",
        contentType: "image/png",
      });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("storage_error");

    const files = new EvidenceFileRepository(db);
    await expect(
      files.listBySession(created.body.session.id),
    ).resolves.toEqual([]);
  });
});

describe("GET /api/v1/sessions/:id/evidence/:fileId/download", () => {
  it("returns 500 instead of crashing when a download read fails", async () => {
    const { session, accessToken } = await createSession();
    const uploaded = await request(app())
      .post(`/api/v1/sessions/${session.id}/evidence`)
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", PNG, {
        filename: "adapter.png",
        contentType: "image/png",
      });
    expect(uploaded.status).toBe(201);
    const spy = vi
      .spyOn(storage, "get")
      .mockRejectedValueOnce(new Error("simulated storage failure"));
    try {
      const res = await request(app())
        .get(
          `/api/v1/sessions/${session.id}/evidence/${uploaded.body.file.id}/download`,
        )
        .set("Authorization", `Bearer ${accessToken}`);
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("internal_error");
    } finally {
      spy.mockRestore();
    }
  });

  it("streams stored bytes back with the right content type", async () => {
    const { session, accessToken } = await createSession();
    const uploaded = await request(app())
      .post(`/api/v1/sessions/${session.id}/evidence`)
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", PNG, {
        filename: "adapter.png",
        contentType: "image/png",
      });
    expect(uploaded.status).toBe(201);

    const res = await request(app())
      .get(
        `/api/v1/sessions/${session.id}/evidence/${uploaded.body.file.id}/download`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect((res.body as Buffer).equals(PNG)).toBe(true);
  });

  it("refuses cross-session and unauthenticated downloads", async () => {
    const first = await createSession();
    const second = await createSession({ device_type: "smartphone" });
    const uploaded = await request(app())
      .post(`/api/v1/sessions/${first.session.id}/evidence`)
      .set("Authorization", `Bearer ${first.accessToken}`)
      .attach("file", PNG, {
        filename: "adapter.png",
        contentType: "image/png",
      });
    const fileId = uploaded.body.file.id as string;

    const noToken = await request(app()).get(
      `/api/v1/sessions/${first.session.id}/evidence/${fileId}/download`,
    );
    expect(noToken.status).toBe(403);

    const crossSession = await request(app())
      .get(`/api/v1/sessions/${second.session.id}/evidence/${fileId}/download`)
      .set("Authorization", `Bearer ${second.accessToken}`);
    expect(crossSession.status).toBe(404);

    const unknownFile = await request(app())
      .get(
        `/api/v1/sessions/${first.session.id}/evidence/00000000-0000-4000-8000-000000000000/download`,
      )
      .set("Authorization", `Bearer ${first.accessToken}`);
    expect(unknownFile.status).toBe(404);
  });
});
