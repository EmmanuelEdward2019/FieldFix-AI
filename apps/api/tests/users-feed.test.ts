import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import {
  listActivityResponseSchema,
  listMyNotificationsResponseSchema,
  listMySessionsResponseSchema,
} from "@fieldfix/contracts";
import { createApp } from "../src/app.js";
import type { Database } from "../src/db/database.js";
import { setupTestDb, teardownTestDb, truncateAll } from "./db/setup.js";
import { NotificationRepository } from "../src/db/repositories/notifications.js";
import type { AppEnv } from "../src/env.js";
import { testEmailOutbox } from "../src/email/resend.js";
import { LocalStorageAdapter } from "../src/storage/local-adapter.js";
import type { StorageAdapter } from "../src/storage/types.js";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
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

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

function emailedToken(to: string, pathPart: string): string {
  const found = [...testEmailOutbox]
    .reverse()
    .find((email) => email.to === to.toLowerCase() && email.text.includes(pathPart));
  const match = found?.text.match(/[?&]token=([0-9a-f]+)/);
  expect(match?.[1]).toMatch(/^[0-9a-f]{64}$/);
  return match?.[1] as string;
}

async function registerUser(email: string): Promise<{ id: string; token: string }> {
  const reg = await request(app())
    .post("/api/v1/auth/register")
    .send({ name: "Feed User", email, password: "feed-pass-01" });
  expect(reg.status).toBe(201);
  const token = emailedToken(email, "/verify-email");
  const verify = await request(app()).post("/api/v1/auth/verify-email").send({ token });
  expect(verify.status).toBe(200);
  return { id: verify.body.user.id as string, token: verify.body.token as string };
}

async function createOwnedSession(token: string, symptoms = "Will not power on.") {
  const res = await request(app())
    .post("/api/v1/sessions")
    .set(bearer(token))
    .send({ device_type: "laptop", symptoms, user_mode: "everyday" });
  expect(res.status).toBe(201);
  return res.body.session as { id: string };
}

beforeAll(async () => {
  db = await setupTestDb();
  storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-feed-"));
  storage = new LocalStorageAdapter(storageDir);
});

afterAll(async () => {
  await teardownTestDb(db);
  await rm(storageDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await truncateAll(db);
});

describe("GET /api/v1/users/me/activity", () => {
  it("returns only the caller's persisted events, newest first", async () => {
    const alice = await registerUser("alice-feed@example.com");
    const bob = await registerUser("bob-feed@example.com");
    const session = await createOwnedSession(alice.token);
    await request(app())
      .post(`/api/v1/sessions/${session.id}/evidence`)
      .set(bearer(alice.token))
      .attach("file", PNG, { filename: "front.png", contentType: "image/png" })
      .expect(201);
    await createOwnedSession(bob.token, "Cracked screen.");

    const res = await request(app())
      .get("/api/v1/users/me/activity")
      .set(bearer(alice.token));
    expect(res.status).toBe(200);
    expect(listActivityResponseSchema.safeParse(res.body).success).toBe(true);
    const types = res.body.activity.map((a: { event_type: string }) => a.event_type);
    expect(types).toEqual(["evidence_uploaded", "session_created"]);
    expect(
      res.body.activity.every((a: { session_id: string }) => a.session_id === session.id),
    ).toBe(true);

    const other = await request(app())
      .get("/api/v1/users/me/activity")
      .set(bearer(bob.token));
    expect(
      other.body.activity.every((a: { session_id: string }) => a.session_id !== session.id),
    ).toBe(true);
    expect(
      other.body.activity.some((a: { event_type: string }) => a.event_type === "session_created"),
    ).toBe(true);
  });

  it("requires authentication", async () => {
    await request(app()).get("/api/v1/users/me/activity").expect(401);
  });
});

describe("user notifications", () => {
  it("scopes feeds, counts, and reads to the owner", async () => {
    const alice = await registerUser("alice-n@example.com");
    const bob = await registerUser("bob-n@example.com");
    const notifications = new NotificationRepository(db);
    await notifications.record({
      kind: "analysis_completed",
      title: "Analysis done",
      body: "Ready.",
      link: "/diagnostics/x",
      userId: alice.id,
    });
    await notifications.record({
      kind: "analysis_completed",
      title: "Bob's analysis",
      body: "Ready.",
      userId: bob.id,
    });
    await notifications.record({
      kind: "announcement",
      title: "Maintenance window",
      body: "Sunday.",
    });
    await notifications.record({
      kind: "ingestion_failed",
      title: "Admin ops",
      body: "Internal.",
    });

    const res = await request(app())
      .get("/api/v1/users/me/notifications")
      .set(bearer(alice.token));
    expect(res.status).toBe(200);
    expect(listMyNotificationsResponseSchema.safeParse(res.body).success).toBe(true);
    const kinds = res.body.notifications.map((n: { kind: string }) => n.kind).sort();
    expect(kinds).toEqual(["analysis_completed", "announcement"]);
    expect(res.body.unread).toBe(1);

    const ownId = res.body.notifications.find(
      (n: { kind: string }) => n.kind === "analysis_completed",
    ).id as string;
    await request(app())
      .patch(`/api/v1/users/me/notifications/${ownId}/read`)
      .set(bearer(alice.token))
      .expect(200);
    const after = await request(app())
      .get("/api/v1/users/me/notifications")
      .set(bearer(alice.token));
    expect(after.body.unread).toBe(0);

    // Bob cannot clear Alice's row, and unknown ids 404.
    await request(app())
      .patch(`/api/v1/users/me/notifications/${ownId}/read`)
      .set(bearer(bob.token))
      .expect(404);
    await request(app())
      .patch("/api/v1/users/me/notifications/00000000-0000-0000-0000-000000000000/read")
      .set(bearer(bob.token))
      .expect(404);
  });

  it("supports read-all for owned rows", async () => {
    const user = await registerUser("reader@example.com");
    const notifications = new NotificationRepository(db);
    await notifications.record({ kind: "report_ready", title: "R", body: "B", userId: user.id });
    await request(app())
      .post("/api/v1/users/me/notifications/read-all")
      .set(bearer(user.token))
      .expect(200);
    const res = await request(app())
      .get("/api/v1/users/me/notifications")
      .set(bearer(user.token));
    expect(res.body.unread).toBe(0);
  });
});

describe("GET /api/v1/users/me/sessions counts", () => {
  it("includes test and evidence counts for progress display", async () => {
    const user = await registerUser("counts@example.com");
    const session = await createOwnedSession(user.token);
    await request(app())
      .post(`/api/v1/sessions/${session.id}/evidence`)
      .set(bearer(user.token))
      .attach("file", PNG, { filename: "front.png", contentType: "image/png" })
      .expect(201);
    const res = await request(app())
      .get("/api/v1/users/me/sessions")
      .set(bearer(user.token));
    expect(res.status).toBe(200);
    expect(listMySessionsResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.sessions[0]).toMatchObject({
      test_count: 0,
      tests_recorded: 0,
      evidence_count: 1,
    });
  });
});
