import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Kysely } from "kysely";
import express from "express";
import request from "supertest";
import { generateSync } from "otplib";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminMeSchema,
  listUsersResponseSchema,
  overviewStatsSchema,
  qualityStatsSchema,
} from "@fieldfix/contracts";
import { createApp } from "../src/app.js";
import { createConsoleRouter } from "../src/routes/console.js";
import type { MetaModelAdapter } from "../src/models/meta/client.js";
import { ModelError } from "../src/models/types.js";
import type { AppEnv } from "../src/env.js";
import type { Database } from "../src/db/database.js";
import { clearTestEmailOutbox, testEmailOutbox } from "../src/email/resend.js";
import { LocalStorageAdapter } from "../src/storage/local-adapter.js";
import type { StorageAdapter } from "../src/storage/types.js";
import { SafetyEventRepository } from "../src/db/repositories/safety.js";
import { EvidenceFileRepository } from "../src/db/repositories/evidence.js";
import { SafetyController } from "../src/safety/controller.js";
import { DiagnosticEngineService } from "../src/diagnostics/engine.js";
import { DiagnosticReasoningService } from "../src/models/diagnostic-reasoning.js";
import { ModelProviderRegistry } from "../src/models/registry.js";
import type {
  CallModality,
  ModelProvider,
  ProviderPrompt,
  ProviderTextResult,
} from "../src/models/types.js";
import type { MetaAdapterConfig } from "../src/models/meta/config.js";
import { setupTestDb, teardownTestDb, truncateAll } from "./db/setup.js";
import {
  adminBearer,
  registerConfirmedSession,
  sessionWithRole,
} from "./helpers/admin-auth.js";

class FakeProvider implements ModelProvider {
  readonly id = "fake-meta";
  readonly modalities: readonly CallModality[] = ["text", "image"];
  async complete(_prompt: ProviderPrompt): Promise<ProviderTextResult> {
    return { text: "{}", model: "fake-meta-1", latencyMs: 5, attempts: 1 };
  }
}

const META: MetaAdapterConfig = {
  apiKey: "test-key",
  baseUrl: "https://api.meta.ai/v1",
  modelId: "muse-spark-1.3",
  timeoutMs: 5000,
  maxRetries: 0,
  reasoningEffort: "medium",
  maxOutputTokens: 4000,
  maxImagesPerRequest: 8,
  maxImageBytes: 1024 * 1024,
};

const TEST_ENV: AppEnv = {
  NODE_ENV: "test",
  PORT: 3001,
  CORS_ORIGIN: "http://localhost:3000",
  API_VERSION: "0.1.0-test",
  STORAGE_DRIVER: "local",
  MAX_UPLOAD_MB: 10,
  MFA_ENCRYPTION_KEY:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  SUPER_ADMIN_EMAILS: "owner@example.com",
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
  const providers = new ModelProviderRegistry();
  providers.register(new FakeProvider(), { isDefault: true });
  const reasoning = new DiagnosticReasoningService({
    db,
    storage,
    providers,
    defaultProviderId: "fake-meta",
    meta: META,
  });
  const engine = new DiagnosticEngineService({
    db,
    reasoning,
    safety: new SafetyController(db),
  });
  return createApp(TEST_ENV, { db, storage, engine });
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
let root: { id: string; token: string };
const asRoot = (req: request.Test) => req.set(adminBearer(root.token));

async function registerAndConfirm(
  email: string,
  name = "Console User",
): Promise<{ id: string; token: string }> {
  return registerConfirmedSession(app(), email, name);
}

async function makeRole(
  email: string,
  role: "super_admin" | "admin" | "operator" | "technician",
): Promise<{ id: string; token: string }> {
  return sessionWithRole(app(), db, email, role);
}

beforeAll(async () => {
  db = await setupTestDb();
  storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-console-"));
  storage = new LocalStorageAdapter(storageDir);
});

afterAll(async () => {
  await teardownTestDb(db);
  await rm(storageDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await truncateAll(db);
  clearTestEmailOutbox();
  root = await sessionWithRole(app(), db, "console-root@example.com", "super_admin");
});

describe("console RBAC matrix", () => {
  it("rejects anonymous callers and plain technicians", async () => {
    const anon = await request(app()).get("/api/v1/admin/overview");
    expect(anon.status).toBe(403);
    const tech = await makeRole("tech@example.com", "technician");
    for (const target of ["/api/v1/admin/overview", "/api/v1/admin/users", "/api/v1/admin/me"]) {
      const res = await request(app()).get(target).set(bearer(tech.token));
      expect(res.status).toBe(403);
    }
  });

  it("gives operators read-only access", async () => {
    const operator = await makeRole("op@example.com", "operator");
    const me = await request(app()).get("/api/v1/admin/me").set(bearer(operator.token));
    expect(me.status).toBe(200);
    expect(adminMeSchema.safeParse(me.body).success).toBe(true);
    expect(me.body.role).toBe("operator");
    expect(me.body.capabilities).toContain("overview:view");
    expect(me.body.capabilities).not.toContain("users:manage");

    const users = await request(app()).get("/api/v1/admin/users").set(bearer(operator.token));
    expect(users.status).toBe(200);
    const denied = await request(app())
      .patch("/api/v1/admin/users/00000000-0000-4000-8000-000000000000")
      .set(bearer(operator.token))
      .send({ status: "suspended" });
    expect(denied.status).toBe(403);
    const settings = await request(app()).get("/api/v1/admin/settings").set(bearer(operator.token));
    expect(settings.status).toBe(403);
    const audit = await request(app()).get("/api/v1/admin/audit-logs").set(bearer(operator.token));
    expect(audit.status).toBe(403);
  });

  it("lets admins manage users but not roles or settings", async () => {
    const admin = await makeRole("admin@example.com", "admin");
    const tech = await makeRole("victim@example.com", "technician");

    const suspended = await request(app())
      .patch(`/api/v1/admin/users/${tech.id}`)
      .set(bearer(admin.token))
      .send({ status: "suspended" });
    expect(suspended.status).toBe(200);
    expect(suspended.body.user.status).toBe("suspended");

    const roleChange = await request(app())
      .patch(`/api/v1/admin/users/${tech.id}`)
      .set(bearer(admin.token))
      .send({ role: "operator" });
    expect(roleChange.status).toBe(403);

    const settingsWrite = await request(app())
      .patch("/api/v1/admin/settings")
      .set(bearer(admin.token))
      .send({ platform_name: "Hacked" });
    expect(settingsWrite.status).toBe(403);
    const settingsRead = await request(app())
      .get("/api/v1/admin/settings")
      .set(bearer(admin.token));
    expect(settingsRead.status).toBe(200);
  });

  it("lets super-admins manage roles and settings", async () => {
    const owner = await makeRole("root@example.com", "super_admin");
    const tech = await makeRole("promoted@example.com", "technician");

    const promoted = await request(app())
      .patch(`/api/v1/admin/users/${tech.id}`)
      .set(bearer(owner.token))
      .send({ role: "operator" });
    expect(promoted.status).toBe(200);
    expect(promoted.body.user.role).toBe("operator");

    const settings = await request(app())
      .patch("/api/v1/admin/settings")
      .set(bearer(owner.token))
      .send({ platform_name: "FieldFix EU" });
    expect(settings.status).toBe(200);
    expect(settings.body.platform_name).toBe("FieldFix EU");
  });

  it("identifies the super-admin user session with full capabilities", async () => {
    const me = await asRoot(request(app()).get("/api/v1/admin/me"));
    expect(me.status).toBe(200);
    expect(me.body.role).toBe("super_admin");
    expect(me.body.actor_type).toBe("user");
    expect(me.body.actor_id).toBe(root.id);
    expect(me.body.capabilities).toContain("roles:manage");
    const overview = await asRoot(request(app()).get("/api/v1/admin/overview"));
    expect(overview.status).toBe(200);
  });

  it("guards self-edits and the last super-admin", async () => {
    const owner = await makeRole("solo@example.com", "super_admin");
    // Demote the shared root first so `owner` is the only super-admin left.
    const demoteRoot = await request(app())
      .patch(`/api/v1/admin/users/${root.id}`)
      .set(bearer(owner.token))
      .send({ role: "admin" });
    expect(demoteRoot.status).toBe(200);

    // The last super-admin cannot demote or suspend itself.
    const selfDemote = await request(app())
      .patch(`/api/v1/admin/users/${owner.id}`)
      .set(bearer(owner.token))
      .send({ role: "technician" });
    expect(selfDemote.status).toBe(422);
    const selfSuspend = await request(app())
      .patch(`/api/v1/admin/users/${owner.id}`)
      .set(bearer(owner.token))
      .send({ status: "suspended" });
    expect(selfSuspend.status).toBe(422);
    // Note: only super-admins hold roles:manage, so a distinct actor
    // attempting the sole super-admin is impossible over HTTP — the
    // self-change guard above is the reachable last line, while the
    // last-super-admin count check still defends the concurrent race.
  });
});

describe("console accounts", () => {
  it("bootstraps super-admins from SUPER_ADMIN_EMAILS", async () => {
    const owner = await registerAndConfirm("owner@example.com", "Owner");
    // Bootstrap grants the role; console access still needs verified MFA.
    const gated = await request(app()).get("/api/v1/admin/me").set(bearer(owner.token));
    expect(gated.status).toBe(403);
    expect(gated.body.error.code).toBe("mfa_required");
    const enroll = await request(app())
      .post("/api/v1/auth/mfa/enroll")
      .set(bearer(owner.token));
    expect(enroll.status).toBe(200);
    const verify = await request(app())
      .post("/api/v1/auth/mfa/verify")
      .set(bearer(owner.token))
      .send({ code: generateSync({ secret: enroll.body.secret as string }) });
    expect(verify.status).toBe(200);
    const me = await request(app()).get("/api/v1/admin/me").set(bearer(owner.token));
    expect(me.status).toBe(200);
    expect(me.body.role).toBe("super_admin");
    const logs = await asRoot(request(app()).get("/api/v1/admin/audit-logs?action=user.role.bootstrap"));
    expect(logs.status).toBe(200);
    expect(logs.body.total).toBe(1);
  });

  it("suspension locks logins and owned sessions until reinstated", async () => {
    const admin = await makeRole("locker@example.com", "admin");
    const tech = await makeRole("locked@example.com", "technician");

    const created = await request(app())
      .post("/api/v1/sessions")
      .set(bearer(tech.token))
      .send({ device_type: "laptop", symptoms: "Overheats under load.", user_mode: "everyday" });
    expect(created.status).toBe(201);
    const sessionId = created.body.session.id as string;
    const sessionToken = created.body.accessToken as string;

    await request(app())
      .patch(`/api/v1/admin/users/${tech.id}`)
      .set(bearer(admin.token))
      .send({ status: "suspended" })
      .expect(200);

    // Suspension revokes login tokens (401) and blocks fresh logins
    // (403) — and even the shareable session token stops working.
    await request(app()).get("/api/v1/auth/me").set(bearer(tech.token)).expect(401);
    const blocked = await request(app())
      .post("/api/v1/auth/login")
      .send({ email: "locked@example.com", password: "admin-pass-01" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("account_suspended");
    await request(app())
      .get(`/api/v1/sessions/${sessionId}`)
      .set(bearer(sessionToken))
      .expect(403);

    await request(app())
      .patch(`/api/v1/admin/users/${tech.id}`)
      .set(bearer(admin.token))
      .send({ status: "active" })
      .expect(200);
    // Suspension rotated login tokens, so sign in again.
    const relogin = await request(app())
      .post("/api/v1/auth/login")
      .send({ email: "locked@example.com", password: "admin-pass-01" });
    expect(relogin.status).toBe(200);
    await request(app())
      .get(`/api/v1/sessions/${sessionId}`)
      .set(bearer(relogin.body.token))
      .expect(200);
  });

  it("lists users with search, filters, and detail", async () => {
    await makeRole("alice@example.com", "technician");
    await makeRole("bob-operator@example.com", "operator");
    const list = await asRoot(request(app()).get("/api/v1/admin/users"));
    expect(list.status).toBe(200);
    expect(listUsersResponseSchema.safeParse(list.body).success).toBe(true);
    // alice + bob + the calling root session.
    expect(list.body.total).toBe(3);

    const search = await asRoot(request(app()).get("/api/v1/admin/users?q=alice"));
    expect(search.body.total).toBe(1);
    const filtered = await asRoot(request(app()).get("/api/v1/admin/users?role=operator"));
    expect(filtered.body.total).toBe(1);

    const id = search.body.users[0].id as string;
    const detail = await asRoot(request(app()).get(`/api/v1/admin/users/${id}`));
    expect(detail.status).toBe(200);
    expect(detail.body.user.email).toBe("alice@example.com");
    expect(detail.body.sessions).toEqual([]);
  });

  it("sends admin-initiated password resets", async () => {
    const admin = await makeRole("reset-admin@example.com", "admin");
    const tech = await makeRole("reset-me@example.com", "technician");
    const res = await request(app())
      .post(`/api/v1/admin/users/${tech.id}/password-reset`)
      .set(bearer(admin.token));
    expect(res.status).toBe(200);
    const found = testEmailOutbox.find(
      (email) => email.to === "reset-me@example.com" && email.text.includes("/reset-password"),
    );
    expect(found).toBeDefined();
  });
});

describe("console operations", () => {
  it("serves overview, quality, health, providers, and meta", async () => {
    const tech = await makeRole("stats@example.com", "technician");
    await request(app())
      .post("/api/v1/sessions")
      .set(bearer(tech.token))
      .send({ device_type: "smartphone", symptoms: "Screen flickers.", user_mode: "everyday" })
      .expect(201);

    const overview = await asRoot(request(app()).get("/api/v1/admin/overview?days=7"));
    expect(overview.status).toBe(200);
    expect(overviewStatsSchema.safeParse(overview.body).success).toBe(true);
    // tech + the calling root session.
    expect(overview.body.users.total).toBe(2);
    expect(overview.body.sessions.total).toBe(1);

    const quality = await asRoot(request(app()).get("/api/v1/admin/quality"));
    expect(quality.status).toBe(200);
    expect(qualityStatsSchema.safeParse(quality.body).success).toBe(true);

    const health = await asRoot(request(app()).get("/api/v1/admin/health"));
    expect(health.status).toBe(200);
    const services = (health.body.checks as { service: string }[]).map((c) => c.service);
    expect(services).toContain("PostgreSQL");
    expect(services).toContain("Object storage");

    const providers = await asRoot(request(app()).get("/api/v1/admin/providers"));
    expect(providers.status).toBe(200);
    expect(providers.body.providers).toHaveLength(3);
    expect(providers.body.providers[0].configured).toBe(false);
    const voice = providers.body.providers.find(
      (p: { id: string }) => p.id === "meta-voice",
    );
    expect(voice.configured).toBe(false);
    expect(voice.model_id).toBe("muse-voice-transcribe-1.0");
    expect(voice.enabled).toBe(true);

    const meta = await request(app()).get("/api/v1/meta");
    expect(meta.status).toBe(200);
    expect(meta.body.platform_name).toBe("FieldFix AI");
    expect(meta.body.demo_enabled).toBe(true);
  });

  it("inspects sessions read-only and audits the access", async () => {
    const tech = await makeRole("inspect@example.com", "technician");
    const created = await request(app())
      .post("/api/v1/sessions")
      .set(bearer(tech.token))
      .send({ device_type: "laptop", symptoms: "No power.", user_mode: "everyday" });
    const sessionId = created.body.session.id as string;

    const list = await asRoot(request(app()).get("/api/v1/admin/sessions?device=laptop"));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.sessions[0].user_email).toBe("inspect@example.com");

    const detail = await asRoot(request(app()).get(`/api/v1/admin/sessions/${sessionId}`));
    expect(detail.status).toBe(200);
    expect(detail.body.session.id).toBe(sessionId);

    const logs = await asRoot(request(app()).get("/api/v1/admin/audit-logs?action=session.inspect"));
    expect(logs.body.total).toBe(1);
    expect(logs.body.logs[0].target_id).toBe(sessionId);
  });

  it("reviews safety incidents without touching session state", async () => {
    const tech = await makeRole("hazard@example.com", "technician");
    const created = await request(app())
      .post("/api/v1/sessions")
      .set(bearer(tech.token))
      .send({ device_type: "smartphone", symptoms: "Battery swollen, screen lifting.", user_mode: "everyday" });
    const sessionId = created.body.session.id as string;

    // Seed a critical event deterministically, then review it by API.
    const events = new SafetyEventRepository(db);
    const seeded = await events.append(sessionId, {
      previous_state: "normal",
      new_state: "critical_stop",
      trigger_type: "user_report",
      trigger_detail: "Swollen battery reported.",
      blocked_action: "analyze,record_result",
      safe_next_steps: "Unplug. Do not charge.",
    });

    const list = await asRoot(request(app()).get("/api/v1/admin/safety-events?reviewed=no"));
    expect(list.status).toBe(200);
    expect(list.body.events.some((e: { id: string }) => e.id === seeded.id)).toBe(true);

    const review = await asRoot(
      request(app()).post(`/api/v1/admin/safety-events/${seeded.id}/review`).send({ note: "Called the user; device isolated." }),
    );
    expect(review.status).toBe(200);

    const reviewed = await asRoot(request(app()).get("/api/v1/admin/safety-events?reviewed=yes"));
    expect(reviewed.body.events.some((e: { id: string }) => e.id === seeded.id)).toBe(true);

    // The session itself is untouched: still open, history intact.
    const detail = await request(app())
      .get(`/api/v1/sessions/${sessionId}`)
      .set(bearer(tech.token));
    expect(detail.status).toBe(200);
    expect(detail.body.session.status).toBe("open");
  });

  it("toggles providers and records provider audits", async () => {
    const off = await asRoot(request(app()).patch("/api/v1/admin/providers/meta").send({ enabled: false }));
    expect(off.status).toBe(200);
    expect(off.body.enabled).toBe(false);
    const providers = await asRoot(request(app()).get("/api/v1/admin/providers"));
    const meta = (providers.body.providers as { id: string; enabled: boolean }[]).find(
      (p) => p.id === "meta",
    );
    expect(meta?.enabled).toBe(false);

    const unknown = await asRoot(
      request(app()).patch("/api/v1/admin/providers/eve").send({ enabled: true }),
    );
    expect(unknown.status).toBe(400);

    const logs = await asRoot(request(app()).get("/api/v1/admin/audit-logs?action=provider.toggle"));
    expect(logs.body.total).toBe(1);
  });

  it("manages documents, permissions, and jobs", async () => {
    const uploaded = await asRoot(
      request(app())
        .post("/api/v1/admin/documents")
        .attach("file", Buffer.from("# Guide\n\nbody text"), {
          filename: "g.md",
          contentType: "text/markdown",
        })
        .field("metadata", JSON.stringify({ title: "Console guide", document_type: "repair_guide" })),
    );
    expect(uploaded.status).toBe(201);
    const documentId = uploaded.body.document.id as string;

    const perm = await asRoot(
      request(app()).patch(`/api/v1/admin/documents/${documentId}`).send({ permission_status: "approved" }),
    );
    expect(perm.status).toBe(200);

    const jobs = await asRoot(request(app()).get("/api/v1/admin/ingestion-jobs"));
    expect(jobs.status).toBe(200);
    expect(jobs.body.total).toBeGreaterThanOrEqual(1);
  });

  it("returns 500 instead of crashing when a download read fails", async () => {
    const tech = await makeRole("console-500@example.com", "technician");
    const created = await request(app())
      .post("/api/v1/sessions")
      .set(bearer(tech.token))
      .send({ device_type: "laptop", symptoms: "Cracked hinge.", user_mode: "everyday" });
    const sessionId = created.body.session.id as string;
    const key = `evidence/${sessionId}/console-500.png`;
    await storage.put(key, Buffer.from("fake-png-bytes"), "image/png");
    const file = await new EvidenceFileRepository(db).create(sessionId, {
      storage_key: key,
      media_type: "image/png",
      byte_size: 14,
      original_filename: "hinge.png",
      kind: "image",
    });
    const spy = vi
      .spyOn(storage, "get")
      .mockRejectedValueOnce(new Error("simulated storage failure"));
    try {
      const res = await asRoot(
        request(app()).get(`/api/v1/admin/evidence/${file.id}/download`),
      );
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("internal_error");
    } finally {
      spy.mockRestore();
    }
  });

  it("serves evidence metadata and audited downloads", async () => {
    const tech = await makeRole("photo@example.com", "technician");
    const created = await request(app())
      .post("/api/v1/sessions")
      .set(bearer(tech.token))
      .send({ device_type: "laptop", symptoms: "Cracked hinge.", user_mode: "everyday" });
    const sessionId = created.body.session.id as string;

    const key = `evidence/${sessionId}/console.png`;
    await storage.put(key, Buffer.from("fake-png-bytes"), "image/png");
    const file = await new EvidenceFileRepository(db).create(sessionId, {
      storage_key: key,
      media_type: "image/png",
      byte_size: 14,
      original_filename: "hinge.png",
      kind: "image",
    });

    const list = await asRoot(request(app()).get("/api/v1/admin/evidence?device=laptop"));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);

    const download = await asRoot(
      request(app()).get(`/api/v1/admin/evidence/${file.id}/download`),
    );
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toContain("image/png");

    const logs = await asRoot(request(app()).get("/api/v1/admin/audit-logs?action=evidence.access"));
    expect(logs.body.total).toBe(1);
  });

  it("records notifications and manages announcements", async () => {
    await makeRole("notify@example.com", "technician");
    const list = await asRoot(request(app()).get("/api/v1/admin/notifications"));
    expect(list.status).toBe(200);
    expect(list.body.notifications.some((n: { kind: string }) => n.kind === "registration")).toBe(true);
    expect(list.body.unread).toBeGreaterThanOrEqual(1);

    const firstId = list.body.notifications[0].id as string;
    await asRoot(request(app()).post(`/api/v1/admin/notifications/${firstId}/read`)).expect(200);

    const operator = await makeRole("ann-op@example.com", "operator");
    const denied = await request(app())
      .post("/api/v1/admin/notifications")
      .set(bearer(operator.token))
      .send({ title: "Hi", body: "Nope." });
    expect(denied.status).toBe(403);

    const created = await asRoot(
      request(app())
        .post("/api/v1/admin/notifications")
        .send({ title: "Maintenance", body: "Sunday 02:00 UTC." }),
    );
    expect(created.status).toBe(201);
    expect(created.body.notification.kind).toBe("announcement");
  });

  it("updates settings with validation and audit", async () => {
    const bad = await asRoot(
      request(app()).patch("/api/v1/admin/settings").send({ platform_name: "" }),
    );
    expect(bad.status).toBe(400);

    const ok = await asRoot(
      request(app())
        .patch("/api/v1/admin/settings")
        .send({ demo_enabled: false, support_contact: "help@example.com" }),
    );
    expect(ok.status).toBe(200);
    expect(ok.body.demo_enabled).toBe(false);

    const meta = await request(app()).get("/api/v1/meta");
    expect(meta.body.demo_enabled).toBe(false);

    const logs = await asRoot(request(app()).get("/api/v1/admin/audit-logs?action=settings.update"));
    expect(logs.body.total).toBe(1);
  });

  it("denies audit-log access to operators but allows admins", async () => {
    const operator = await makeRole("audit-op@example.com", "operator");
    await request(app()).get("/api/v1/admin/audit-logs").set(bearer(operator.token)).expect(403);
    const admin = await makeRole("audit-admin@example.com", "admin");
    const res = await request(app()).get("/api/v1/admin/audit-logs").set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
  });

  it("blocks reasoning when the provider is disabled", async () => {
    await asRoot(request(app()).patch("/api/v1/admin/providers/meta").send({ enabled: false }));
    const tech = await makeRole("blocked-ai@example.com", "technician");
    const created = await request(app())
      .post("/api/v1/sessions")
      .set(bearer(tech.token))
      .send({ device_type: "laptop", symptoms: "No power.", user_mode: "everyday" });
    const sessionId = created.body.session.id as string;
    const analyzed = await request(app())
      .post(`/api/v1/sessions/${sessionId}/analyze`)
      .set(bearer(tech.token));
    expect(analyzed.status).toBe(502);
    expect(String(analyzed.body.error.message)).toMatch(/disabled/);
  });
});

describe("POST /api/v1/admin/providers/:id/test", () => {
  function testAppWith(ping: () => Promise<ProviderTextResult>) {
    const app = express();
    app.use(express.json());
    app.use(
      "/api/v1/admin",
      createConsoleRouter({
        db,
        storage,
        env: TEST_ENV,
        metaProvider: { ping } as unknown as MetaModelAdapter,
        metaConfig: META,
        samModelId: TEST_ENV.SAM_MODEL_ID,
      }),
    );
    return app;
  }

  it("reports connected with a note when the ping reply is cut off", async () => {
    const app = testAppWith(async () => ({
      text: "",
      model: "muse-spark-1.3",
      latencyMs: 12,
      attempts: 1,
      truncated: true,
    }));
    const res = await asRoot(request(app).post("/api/v1/admin/providers/meta/test"));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(String(res.body.detail)).toContain("Connected");
    expect(String(res.body.detail)).toContain("cut off");
    expect(typeof res.body.latency_ms).toBe("number");
  });

  it("reports failure when ping throws", async () => {
    const app = testAppWith(async () => {
      throw new ModelError("auth", "Provider authentication failed. Check META_API_KEY.");
    });
    const res = await asRoot(request(app).post("/api/v1/admin/providers/meta/test"));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(String(res.body.detail)).toContain("auth");
  });
});
