import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { generateSync } from "otplib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import {
  authResponseSchema,
  mfaEnrollResponseSchema,
  mfaStatusResponseSchema,
  mfaVerifyResponseSchema,
} from "@fieldfix/contracts";
import { createApp } from "../src/app.js";
import type { Database } from "../src/db/database.js";
import { setupTestDb, teardownTestDb, truncateAll } from "./db/setup.js";
import { UsersRepository } from "../src/db/repositories/users.js";
import type { AppEnv } from "../src/env.js";
import { testEmailOutbox } from "../src/email/resend.js";
import { LocalStorageAdapter } from "../src/storage/local-adapter.js";
import type { StorageAdapter } from "../src/storage/types.js";

const TEST_MFA_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const TEST_ENV: AppEnv = {
  NODE_ENV: "test",
  PORT: 3001,
  CORS_ORIGIN: "http://localhost:3000",
  API_VERSION: "0.1.0-test",
  STORAGE_DRIVER: "local",
  MAX_UPLOAD_MB: 10,
  MFA_ENCRYPTION_KEY: TEST_MFA_KEY,
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

function app(env: AppEnv = TEST_ENV) {
  return createApp(env, { db, storage });
}

const authHeader = (token: string) => ({ Authorization: "Bearer " + token });

function emailedToken(to: string, pathPart: string): string {
  const found = [...testEmailOutbox]
    .reverse()
    .find((email) => email.to === to.toLowerCase() && email.text.includes(pathPart));
  const match = found?.text.match(/[?&]token=([0-9a-f]+)/);
  expect(match?.[1]).toMatch(/^[0-9a-f]{64}$/);
  return match?.[1] as string;
}

async function registerUser(
  email: string,
  password = "mfa-pass-01",
): Promise<{ id: string; token: string }> {
  const reg = await request(app())
    .post("/api/v1/auth/register")
    .send({ name: "Mfa User", email, password });
  expect(reg.status).toBe(201);
  const token = emailedToken(email, "/verify-email");
  const verify = await request(app()).post("/api/v1/auth/verify-email").send({ token });
  expect(verify.status).toBe(200);
  return { id: verify.body.user.id as string, token: verify.body.token as string };
}

async function enrollMfa(token: string): Promise<{ secret: string; backupCodes: string[] }> {
  const enroll = await request(app()).post("/api/v1/auth/mfa/enroll").set(authHeader(token));
  expect(enroll.status).toBe(200);
  expect(mfaEnrollResponseSchema.safeParse(enroll.body).success).toBe(true);
  const secret = enroll.body.secret as string;
  const verify = await request(app())
    .post("/api/v1/auth/mfa/verify")
    .set(authHeader(token))
    .send({ code: generateSync({ secret }) });
  expect(verify.status).toBe(200);
  expect(mfaVerifyResponseSchema.safeParse(verify.body).success).toBe(true);
  return { secret, backupCodes: (verify.body.backup_codes ?? []) as string[] };
}

beforeAll(async () => {
  db = await setupTestDb();
  storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-mfa-"));
  storage = new LocalStorageAdapter(storageDir);
});

afterAll(async () => {
  await teardownTestDb(db);
  await rm(storageDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await truncateAll(db);
});

describe("MFA enrollment", () => {
  it("reports disabled for fresh accounts and requires auth", async () => {
    await request(app()).get("/api/v1/auth/mfa/status").expect(401);
    const user = await registerUser("fresh-mfa@example.com");
    const res = await request(app()).get("/api/v1/auth/mfa/status").set(authHeader(user.token));
    expect(res.status).toBe(200);
    expect(mfaStatusResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.enabled).toBe(false);
  });

  it("enrolls with a pending secret that activates only after a valid code", async () => {
    const user = await registerUser("enroll-mfa@example.com");
    const enroll = await request(app())
      .post("/api/v1/auth/mfa/enroll")
      .set(authHeader(user.token));
    expect(enroll.status).toBe(200);
    expect(enroll.body.otpauth_url).toMatch(/^otpauth:\/\/totp\//);

    const statusBefore = await request(app())
      .get("/api/v1/auth/mfa/status")
      .set(authHeader(user.token));
    expect(statusBefore.body.enabled).toBe(false);

    const wrong = await request(app())
      .post("/api/v1/auth/mfa/verify")
      .set(authHeader(user.token))
      .send({ code: "000000" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("invalid_code");

    const ok = await request(app())
      .post("/api/v1/auth/mfa/verify")
      .set(authHeader(user.token))
      .send({ code: generateSync({ secret: enroll.body.secret as string }) });
    expect(ok.status).toBe(200);
    expect(ok.body.verified).toBe(true);
    expect(ok.body.backup_codes).toHaveLength(10);

    // Enabling 2FA sends a confirmation email (never containing secrets).
    const enabled = [...testEmailOutbox]
      .reverse()
      .find((mail) => mail.to === "enroll-mfa@example.com" && mail.subject.includes("Two-factor"));
    expect(enabled).toBeDefined();
    expect(enabled?.html).toContain("never emailed");
    for (const code of ok.body.backup_codes as string[]) {
      expect(enabled?.text).not.toContain(code);
      expect(enabled?.html).not.toContain(code);
    }

    const statusAfter = await request(app())
      .get("/api/v1/auth/mfa/status")
      .set(authHeader(user.token));
    expect(statusAfter.body.enabled).toBe(true);

    const duplicate = await request(app())
      .post("/api/v1/auth/mfa/enroll")
      .set(authHeader(user.token));
    expect(duplicate.status).toBe(409);
  });

  it("refuses enrollment when no encryption key is configured", async () => {
    const noKeyEnv = { ...TEST_ENV, MFA_ENCRYPTION_KEY: undefined };
    const reg = await request(app(noKeyEnv))
      .post("/api/v1/auth/register")
      .send({ name: "No Key", email: "nokey-mfa@example.com", password: "mfa-pass-01" });
    expect(reg.status).toBe(201);
    const token = emailedToken("nokey-mfa@example.com", "/verify-email");
    const verify = await request(app(noKeyEnv))
      .post("/api/v1/auth/verify-email")
      .send({ token });
    expect(verify.status).toBe(200);
    const res = await request(app(noKeyEnv))
      .post("/api/v1/auth/mfa/enroll")
      .set(authHeader(verify.body.token as string));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("mfa_unavailable");
  });
});

describe("MFA login challenge", () => {
  it("challenges enrolled accounts and issues a session only after a valid code", async () => {
    const user = await registerUser("challenge-mfa@example.com");
    const { secret } = await enrollMfa(user.token);

    const login = await request(app())
      .post("/api/v1/auth/login")
      .send({ email: "challenge-mfa@example.com", password: "mfa-pass-01" });
    expect(login.status).toBe(200);
    expect(login.body.mfa_required).toBe(true);
    const mfaToken = login.body.mfa_token as string;
    expect(typeof mfaToken).toBe("string");

    const wrong = await request(app())
      .post("/api/v1/auth/mfa/challenge")
      .send({ mfa_token: mfaToken, code: "000000" });
    expect(wrong.status).toBe(401);

    const ok = await request(app())
      .post("/api/v1/auth/mfa/challenge")
      .send({ mfa_token: mfaToken, code: generateSync({ secret }) });
    expect(ok.status).toBe(200);
    expect(authResponseSchema.safeParse(ok.body).success).toBe(true);

    const me = await request(app())
      .get("/api/v1/auth/me")
      .set(authHeader(ok.body.token as string));
    expect(me.status).toBe(200);

    // Single-use challenge: replaying the same token fails.
    const replay = await request(app())
      .post("/api/v1/auth/mfa/challenge")
      .send({ mfa_token: mfaToken, code: generateSync({ secret }) });
    expect(replay.status).toBe(401);
  });

  it("accepts each backup code exactly once", async () => {
    const user = await registerUser("backup-mfa@example.com");
    const { backupCodes } = await enrollMfa(user.token);
    expect(backupCodes).toHaveLength(10);
    const code = backupCodes[0] as string;

    const login = await request(app())
      .post("/api/v1/auth/login")
      .send({ email: "backup-mfa@example.com", password: "mfa-pass-01" });
    const first = await request(app())
      .post("/api/v1/auth/mfa/challenge")
      .send({ mfa_token: login.body.mfa_token, code });
    expect(first.status).toBe(200);

    const login2 = await request(app())
      .post("/api/v1/auth/login")
      .send({ email: "backup-mfa@example.com", password: "mfa-pass-01" });
    const reuse = await request(app())
      .post("/api/v1/auth/mfa/challenge")
      .send({ mfa_token: login2.body.mfa_token, code });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe("invalid_code");
  });

  it("leaves unenrolled accounts on the plain password flow", async () => {
    await registerUser("plain-mfa@example.com");
    const login = await request(app())
      .post("/api/v1/auth/login")
      .send({ email: "plain-mfa@example.com", password: "mfa-pass-01" });
    expect(login.status).toBe(200);
    expect(login.body.mfa_required ?? false).toBe(false);
    expect(authResponseSchema.safeParse(login.body).success).toBe(true);
  });
});

describe("MFA disable", () => {
  it("requires a valid code and restores plain login", async () => {
    const user = await registerUser("disable-mfa@example.com");
    const { secret } = await enrollMfa(user.token);

    const wrong = await request(app())
      .post("/api/v1/auth/mfa/disable")
      .set(authHeader(user.token))
      .send({ code: "000000" });
    expect(wrong.status).toBe(401);

    const still = await request(app())
      .get("/api/v1/auth/mfa/status")
      .set(authHeader(user.token));
    expect(still.body.enabled).toBe(true);

    const ok = await request(app())
      .post("/api/v1/auth/mfa/disable")
      .set(authHeader(user.token))
      .send({ code: generateSync({ secret }) });
    expect(ok.status).toBe(200);

    const status = await request(app())
      .get("/api/v1/auth/mfa/status")
      .set(authHeader(user.token));
    expect(status.body.enabled).toBe(false);

    const login = await request(app())
      .post("/api/v1/auth/login")
      .send({ email: "disable-mfa@example.com", password: "mfa-pass-01" });
    expect(authResponseSchema.safeParse(login.body).success).toBe(true);
  });
});

describe("Super Admin MFA enforcement", () => {
  it("blocks admin routes for super_admins without verified MFA", async () => {
    const user = await registerUser("owner-mfa@example.com");
    await new UsersRepository(db).updateRole(user.id, "super_admin");

    const blocked = await request(app())
      .get("/api/v1/admin/me")
      .set(authHeader(user.token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("mfa_required");


    await enrollMfa(user.token);
    const allowed = await request(app())
      .get("/api/v1/admin/me")
      .set(authHeader(user.token));
    expect(allowed.status).toBe(200);
    expect(allowed.body.role).toBe("super_admin");
  });
});
