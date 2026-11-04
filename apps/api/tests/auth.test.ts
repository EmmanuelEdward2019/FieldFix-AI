import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Kysely } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authResponseSchema, registerResponseSchema, userResponseSchema } from "@fieldfix/contracts";
import { createApp } from "../src/app.js";
import type { AppEnv } from "../src/env.js";
import type { Database } from "../src/db/database.js";
import { clearTestEmailOutbox, testEmailOutbox } from "../src/email/resend.js";
import { LocalStorageAdapter } from "../src/storage/local-adapter.js";
import type { StorageAdapter } from "../src/storage/types.js";
import { setupTestDb, teardownTestDb, truncateAll } from "./db/setup.js";

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

async function register(
  extra: Record<string, unknown> = {},
): Promise<{ user: { id: string } }> {
  const res = await request(app())
    .post("/api/v1/auth/register")
    .send({ name: "Ada T.", email: "ada@example.com", password: "correct-horse-01", ...extra });
  expect(res.status).toBe(201);
  expect(registerResponseSchema.safeParse(res.body).success).toBe(true);
  return { user: res.body.user };
}

/** Latest emailed link token for an address (test outbox stands in for Resend). */
function emailedToken(to: string, path: string): string {
  const found = [...testEmailOutbox]
    .reverse()
    .find((email) => email.to === to.toLowerCase() && email.text.includes(path));
  const match = found?.text.match(/[?&]token=([0-9a-f]+)/);
  expect(match?.[1]).toMatch(/^[0-9a-f]{64}$/);
  return match?.[1] as string;
}

async function registerAndConfirm(
  extra: Record<string, unknown> = {},
): Promise<{ user: { id: string }; token: string }> {
  const { user } = await register(extra);
  const email = (extra.email as string | undefined) ?? "ada@example.com";
  const token = emailedToken(email, "/verify-email");
  const res = await request(app()).post("/api/v1/auth/verify-email").send({ token });
  expect(res.status).toBe(200);
  expect(authResponseSchema.safeParse(res.body).success).toBe(true);
  return { user, token: res.body.token as string };
}

beforeAll(async () => {
  db = await setupTestDb();
  storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-auth-"));
  storage = new LocalStorageAdapter(storageDir);
});

afterAll(async () => {
  await teardownTestDb(db);
  await rm(storageDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await truncateAll(db);
  clearTestEmailOutbox();
});

describe("auth routes", () => {
  it("registers unconfirmed, queues a confirmation link, and never leaks secrets", async () => {
    const res = await request(app()).post("/api/v1/auth/register").send({
      name: "Ada T.",
      email: "Ada@Example.com",
      password: "correct-horse-01",
    });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("ada@example.com");
    expect(res.body.confirmation_required).toBe(true);
    expect(res.body.token).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("password_hash");
    expect(JSON.stringify(res.body)).not.toContain("scrypt");
    // A confirmation email with a single-use link went out.
    const token = emailedToken("ada@example.com", "/verify-email");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    // Login stays blocked until the link is clicked.
    const early = await request(app()).post("/api/v1/auth/login").send({
      email: "ada@example.com",
      password: "correct-horse-01",
    });
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe("email_unconfirmed");
  });

  it("rejects duplicate emails, bad input, and short passwords", async () => {
    await register();
    const dup = await request(app()).post("/api/v1/auth/register").send({
      name: "Other",
      email: "ADA@example.com",
      password: "another-pass-02",
    });
    expect(dup.status).toBe(409);

    const bad = await request(app()).post("/api/v1/auth/register").send({
      name: "",
      email: "not-an-email",
      password: "short",
    });
    expect(bad.status).toBe(400);
  });

  it("logs in with correct credentials and rejects wrong ones uniformly", async () => {
    await registerAndConfirm();
    const ok = await request(app()).post("/api/v1/auth/login").send({
      email: "ada@example.com",
      password: "correct-horse-01",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toMatch(/^[0-9a-f]{64}$/);

    const wrongPass = await request(app()).post("/api/v1/auth/login").send({
      email: "ada@example.com",
      password: "wrong-password-99",
    });
    expect(wrongPass.status).toBe(401);
    const unknown = await request(app()).post("/api/v1/auth/login").send({
      email: "nobody@example.com",
      password: "wrong-password-99",
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrongPass.body);
  });

  it("serves and updates the profile behind auth", async () => {
    const { token } = await registerAndConfirm();
    const anon = await request(app()).get("/api/v1/auth/me");
    expect(anon.status).toBe(401);

    const me = await request(app())
      .get("/api/v1/auth/me")
      .set({ Authorization: `Bearer ${token}` });
    expect(me.status).toBe(200);
    expect(userResponseSchema.safeParse(me.body.user).success).toBe(true);

    const renamed = await request(app())
      .patch("/api/v1/auth/me")
      .set({ Authorization: `Bearer ${token}` })
      .send({ name: "Ada L." });
    expect(renamed.status).toBe(200);
    expect(renamed.body.user.name).toBe("Ada L.");
  });

  it("logs out, supports logout-all, and rotates on password change", async () => {
    const { token } = await registerAndConfirm();
    const second = await request(app()).post("/api/v1/auth/login").send({
      email: "ada@example.com",
      password: "correct-horse-01",
    });
    const token2 = second.body.token as string;

    await request(app())
      .post("/api/v1/auth/logout")
      .set({ Authorization: `Bearer ${token}` })
      .expect(204);
    const dead = await request(app())
      .get("/api/v1/auth/me")
      .set({ Authorization: `Bearer ${token}` });
    expect(dead.status).toBe(401);
    // The other session survives a single logout.
    const alive = await request(app())
      .get("/api/v1/auth/me")
      .set({ Authorization: `Bearer ${token2}` });
    expect(alive.status).toBe(200);

    const wrongCurrent = await request(app())
      .post("/api/v1/auth/password")
      .set({ Authorization: `Bearer ${token2}` })
      .send({ current_password: "nope", new_password: "brand-new-pass-03" });
    expect(wrongCurrent.status).toBe(403);

    await request(app())
      .post("/api/v1/auth/password")
      .set({ Authorization: `Bearer ${token2}` })
      .send({ current_password: "correct-horse-01", new_password: "brand-new-pass-03" })
      .expect(204);
    // Password change signs out everywhere.
    const after = await request(app())
      .get("/api/v1/auth/me")
      .set({ Authorization: `Bearer ${token2}` });
    expect(after.status).toBe(401);
    const relogin = await request(app()).post("/api/v1/auth/login").send({
      email: "ada@example.com",
      password: "brand-new-pass-03",
    });
    expect(relogin.status).toBe(200);
  });
});

describe("ownership", () => {
  async function sessionAs(token: string | null, symptoms = "Rattling fan.") {
    const req = request(app()).post("/api/v1/sessions").send({
      device_type: "laptop",
      symptoms,
      user_mode: "everyday",
    });
    if (token) {
      req.set({ Authorization: `Bearer ${token}` });
    }
    const res = await req;
    expect(res.status).toBe(201);
    return { id: res.body.session.id as string, token: res.body.accessToken as string };
  }

  it("links signed-in sessions to the owner and isolates users", async () => {
    const ada = await registerAndConfirm();
    const bob = await registerAndConfirm({ name: "Bob", email: "bob@example.com", password: "bob-pass-0004" });

    const adaSession = await sessionAs(ada.token, "Ada's laptop hums.");
    const bobSession = await sessionAs(bob.token, "Bob's phone is hot.");
    const anonSession = await sessionAs(null, "Anonymous demo-like session.");

    // Owners read their own sessions with the login token.
    const own = await request(app())
      .get(`/api/v1/sessions/${adaSession.id}`)
      .set({ Authorization: `Bearer ${ada.token}` });
    expect(own.status).toBe(200);

    // Cross-user access by ID swapping is forbidden.
    const cross = await request(app())
      .get(`/api/v1/sessions/${bobSession.id}`)
      .set({ Authorization: `Bearer ${ada.token}` });
    expect(cross.status).toBe(403);

    // Session tokens still work for their own session (shareable links).
    const viaSessionToken = await request(app())
      .get(`/api/v1/sessions/${bobSession.id}`)
      .set({ Authorization: `Bearer ${bobSession.token}` });
    expect(viaSessionToken.status).toBe(200);

    // Anonymous sessions stay token-only: no login token opens them.
    const anonBlocked = await request(app())
      .get(`/api/v1/sessions/${anonSession.id}`)
      .set({ Authorization: `Bearer ${ada.token}` });
    expect(anonBlocked.status).toBe(403);
    const anonOk = await request(app())
      .get(`/api/v1/sessions/${anonSession.id}`)
      .set({ Authorization: `Bearer ${anonSession.token}` });
    expect(anonOk.status).toBe(200);
  });

  it("lists only the caller's sessions and reports", async () => {
    const ada = await registerAndConfirm();
    const bob = await registerAndConfirm({ name: "Bob", email: "bob@example.com", password: "bob-pass-0004" });
    await sessionAs(ada.token, "Ada laptop.");
    await sessionAs(ada.token, "Ada phone.");
    await sessionAs(bob.token, "Bob laptop.");

    const adaList = await request(app())
      .get("/api/v1/users/me/sessions")
      .set({ Authorization: `Bearer ${ada.token}` });
    expect(adaList.status).toBe(200);
    expect(adaList.body.sessions).toHaveLength(2);

    const bobList = await request(app())
      .get("/api/v1/users/me/sessions")
      .set({ Authorization: `Bearer ${bob.token}` });
    expect(bobList.body.sessions).toHaveLength(1);

    const anon = await request(app()).get("/api/v1/users/me/sessions");
    expect(anon.status).toBe(401);

    // Reports endpoint is gated the same way (empty: no reports yet).
    const reports = await request(app())
      .get("/api/v1/users/me/reports")
      .set({ Authorization: `Bearer ${ada.token}` });
    expect(reports.status).toBe(200);
    expect(reports.body.reports).toEqual([]);
  });
});

describe("email verification and password reset", () => {
  it("verifies once: links are single-use and bad tokens fail", async () => {
    await register();
    const token = emailedToken("ada@example.com", "/verify-email");
    const first = await request(app()).post("/api/v1/auth/verify-email").send({ token });
    expect(first.status).toBe(200);
    expect(first.body.token).toMatch(/^[0-9a-f]{64}$/);

    const reuse = await request(app()).post("/api/v1/auth/verify-email").send({ token });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe("invalid_or_expired");

    const bogus = await request(app())
      .post("/api/v1/auth/verify-email")
      .send({ token: "0".repeat(64) });
    expect(bogus.status).toBe(400);
  });

  it("resends confirmation uniformly and revokes the older link", async () => {
    await register();
    const first = emailedToken("ada@example.com", "/verify-email");
    const resend = await request(app())
      .post("/api/v1/auth/verify-email/resend")
      .send({ email: "ada@example.com" });
    expect(resend.status).toBe(200);

    const unknown = await request(app())
      .post("/api/v1/auth/verify-email/resend")
      .send({ email: "nobody@example.com" });
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(resend.body);

    const second = emailedToken("ada@example.com", "/verify-email");
    expect(second).not.toBe(first);
    // The superseded link no longer verifies.
    const stale = await request(app()).post("/api/v1/auth/verify-email").send({ token: first });
    expect(stale.status).toBe(400);
    const fresh = await request(app()).post("/api/v1/auth/verify-email").send({ token: second });
    expect(fresh.status).toBe(200);
  });

  it("resets passwords by emailed link and signs out everywhere", async () => {
    const { token } = await registerAndConfirm();
    const forgot = await request(app())
      .post("/api/v1/auth/password/forgot")
      .send({ email: "ada@example.com" });
    expect(forgot.status).toBe(200);

    const unknown = await request(app())
      .post("/api/v1/auth/password/forgot")
      .send({ email: "nobody@example.com" });
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(forgot.body);

    const resetToken = emailedToken("ada@example.com", "/reset-password");
    await request(app())
      .post("/api/v1/auth/password/reset")
      .send({ token: resetToken, new_password: "reset-pass-0005" })
      .expect(204);

    // A password-changed notice follows the reset.
    const changed = [...testEmailOutbox]
      .reverse()
      .find((mail) => mail.to === "ada@example.com" && mail.subject.includes("changed"));
    expect(changed).toBeDefined();
    expect(changed?.html).toContain("Sign in");
    expect(changed?.html).toContain("info@fieldfix.ai");

    // The old login token died with the reset; the new password works.
    const dead = await request(app())
      .get("/api/v1/auth/me")
      .set({ Authorization: `Bearer ${token}` });
    expect(dead.status).toBe(401);
    const relogin = await request(app()).post("/api/v1/auth/login").send({
      email: "ada@example.com",
      password: "reset-pass-0005",
    });
    expect(relogin.status).toBe(200);

    // Reset links are single-use.
    const reuse = await request(app())
      .post("/api/v1/auth/password/reset")
      .send({ token: resetToken, new_password: "another-pass-0006" });
    expect(reuse.status).toBe(400);
  });
});
