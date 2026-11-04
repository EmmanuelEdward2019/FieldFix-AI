import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql, type Kysely } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  inventoryItemResponseSchema,
  inventoryMovementResponseSchema,
  listCustomerDevicesResponseSchema,
  listInventoryMovementsResponseSchema,
  listInventoryResponseSchema,
  listRepairEstimatesResponseSchema,
  listRepairJobEventsResponseSchema,
  listRepairJobsResponseSchema,
  listShopCustomersResponseSchema,
  listShopMembersResponseSchema,
  listShopsResponseSchema,
  repairEstimateResponseSchema,
  repairJobDetailResponseSchema,
  repairJobResponseSchema,
  shopCustomerResponseSchema,
  shopReportSummaryResponseSchema,
  shopResponseSchema,
} from "@fieldfix/contracts";
import { createApp } from "../src/app.js";
import type { Database } from "../src/db/database.js";
import { recordSafetyTransition } from "../src/db/workflows.js";
import type { AppEnv } from "../src/env.js";
import { testEmailOutbox } from "../src/email/resend.js";
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

const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";

let db: Kysely<Database>;
let storageDir: string;
let storage: StorageAdapter;

function app() {
  return createApp(TEST_ENV, { db, storage });
}

const auth = (t: string) => ({ Authorization: "Bearer " + t });

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
  name = "Shop User",
): Promise<{ id: string; token: string }> {
  const reg = await request(app())
    .post("/api/v1/auth/register")
    .send({ name, email, password: "shop-pass-01" });
  expect(reg.status).toBe(201);
  const token = emailedToken(email, "/verify-email");
  const verify = await request(app()).post("/api/v1/auth/verify-email").send({ token });
  expect(verify.status).toBe(200);
  return { id: verify.body.user.id as string, token: verify.body.token as string };
}

async function createShop(token: string, body: Record<string, unknown> = {}) {
  const res = await request(app())
    .post("/api/v1/shops")
    .set(auth(token))
    .send({ name: "Main St Repair", ...body });
  expect(res.status).toBe(201);
  return res.body.shop as { id: string };
}

async function createCustomer(token: string, shopId: string, body: Record<string, unknown> = {}) {
  const res = await request(app())
    .post(`/api/v1/shops/${shopId}/customers`)
    .set(auth(token))
    .send({ name: "Jane Doe", ...body });
  expect(res.status).toBe(201);
  return res.body.customer as { id: string; reference: string };
}

async function createJob(
  token: string,
  shopId: string,
  body: Record<string, unknown>,
) {
  const res = await request(app())
    .post(`/api/v1/shops/${shopId}/jobs`)
    .set(auth(token))
    .send(body);
  expect(res.status).toBe(201);
  return res.body.job as { id: string; job_reference: string };
}

async function createOwnedSession(token: string) {
  const res = await request(app())
    .post("/api/v1/sessions")
    .set(auth(token))
    .send({ device_type: "laptop", symptoms: "Will not power on.", user_mode: "everyday" });
  expect(res.status).toBe(201);
  return res.body.session as { id: string };
}

beforeAll(async () => {
  db = await setupTestDb();
  storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-shop-"));
  storage = new LocalStorageAdapter(storageDir);
});

afterAll(async () => {
  await teardownTestDb(db);
  await rm(storageDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await truncateAll(db);
});

describe("shops and membership", () => {
  it("creates a shop with the caller as owner", async () => {
    const owner = await registerUser("shop-owner@example.com");
    const res = await request(app())
      .post("/api/v1/shops")
      .set(auth(owner.token))
      .send({ name: "Main St Repair", city: "Austin" });
    expect(res.status).toBe(201);
    expect(shopResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.shop.name).toBe("Main St Repair");
    expect(res.body.my_role).toBe("owner");

    const mine = await request(app()).get("/api/v1/shops").set(auth(owner.token));
    expect(mine.status).toBe(200);
    expect(listShopsResponseSchema.safeParse(mine.body).success).toBe(true);
    expect(mine.body.shops).toHaveLength(1);

    await request(app()).post("/api/v1/shops").send({ name: "Anon" }).expect(401);
    await request(app())
      .post("/api/v1/shops")
      .set(auth(owner.token))
      .send({})
      .expect(400);
  });

  it("enforces tenant isolation with 403s across shops", async () => {
    const owner = await registerUser("shop-iso-a@example.com");
    const stranger = await registerUser("shop-iso-b@example.com");
    const shop = await createShop(owner.token);

    // Non-members get 403 on every shop-scoped route (not 404: the
    // shop exists, they just cannot enter it).
    await request(app()).get(`/api/v1/shops/${shop.id}`).set(auth(stranger.token)).expect(403);
    await request(app())
      .get(`/api/v1/shops/${shop.id}/customers`)
      .set(auth(stranger.token))
      .expect(403);
    await request(app())
      .post(`/api/v1/shops/${shop.id}/customers`)
      .set(auth(stranger.token))
      .send({ name: "Intruder" })
      .expect(403);
    await request(app())
      .get(`/api/v1/shops/${shop.id}/jobs`)
      .set(auth(stranger.token))
      .expect(403);
    await request(app())
      .get(`/api/v1/shops/${shop.id}/inventory`)
      .set(auth(stranger.token))
      .expect(403);
    await request(app())
      .get(`/api/v1/shops/${shop.id}/reports/summary`)
      .set(auth(stranger.token))
      .expect(403);

    // The stranger's own list is empty: no cross-shop leakage.
    const mine = await request(app()).get("/api/v1/shops").set(auth(stranger.token));
    expect(mine.body.shops).toHaveLength(0);

    // Unknown shops 404 without leaking membership.
    await request(app())
      .get(`/api/v1/shops/${UNKNOWN_ID}`)
      .set(auth(owner.token))
      .expect(404);
    await request(app()).get("/api/v1/shops/not-a-uuid").set(auth(owner.token)).expect(404);
  });

  it("scopes nested rows to their own shop", async () => {
    const owner = await registerUser("shop-scope-a@example.com");
    const other = await registerUser("shop-scope-b@example.com");
    const shopA = await createShop(owner.token, { name: "Shop A" });
    const shopB = await createShop(other.token, { name: "Shop B" });
    const customerB = await createCustomer(other.token, shopB.id, { name: "B Customer" });

    // A's member reads B's customer id under A's shop: 404, not B's row.
    await request(app())
      .get(`/api/v1/shops/${shopA.id}/customers/${customerB.id}`)
      .set(auth(owner.token))
      .expect(404);
    // And cannot file a job for B's customer under A's shop.
    await request(app())
      .post(`/api/v1/shops/${shopA.id}/jobs`)
      .set(auth(owner.token))
      .send({ customer_id: customerB.id, reported_fault: "Broken." })
      .expect(404);
  });

  it("invites, re-roles, and removes members", async () => {
    const owner = await registerUser("shop-mem-owner@example.com");
    const tech = await registerUser("shop-mem-tech@example.com");
    const shop = await createShop(owner.token);

    const invite = await request(app())
      .post(`/api/v1/shops/${shop.id}/members`)
      .set(auth(owner.token))
      .send({ email: "shop-mem-tech@example.com", role: "technician" });
    expect(invite.status).toBe(201);
    expect(invite.body.member).toMatchObject({ user_id: tech.id, role: "technician" });

    // Duplicate invite conflicts.
    await request(app())
      .post(`/api/v1/shops/${shop.id}/members`)
      .set(auth(owner.token))
      .send({ user_id: tech.id, role: "admin" })
      .expect(409);
    // Unknown accounts 404; bad bodies 400.
    await request(app())
      .post(`/api/v1/shops/${shop.id}/members`)
      .set(auth(owner.token))
      .send({ email: "ghost@example.com", role: "admin" })
      .expect(404);
    await request(app())
      .post(`/api/v1/shops/${shop.id}/members`)
      .set(auth(owner.token))
      .send({ role: "admin" })
      .expect(400);

    const list = await request(app())
      .get(`/api/v1/shops/${shop.id}/members`)
      .set(auth(tech.token));
    expect(list.status).toBe(200);
    expect(listShopMembersResponseSchema.safeParse(list.body).success).toBe(true);
    expect(list.body.members).toHaveLength(2);

    // Non-managers cannot manage members.
    await request(app())
      .post(`/api/v1/shops/${shop.id}/members`)
      .set(auth(tech.token))
      .send({ email: "x@example.com", role: "technician" })
      .expect(403);

    const rerole = await request(app())
      .patch(`/api/v1/shops/${shop.id}/members/${tech.id}`)
      .set(auth(owner.token))
      .send({ role: "front_desk" });
    expect(rerole.status).toBe(200);
    expect(rerole.body.member.role).toBe("front_desk");

    await request(app())
      .delete(`/api/v1/shops/${shop.id}/members/${tech.id}`)
      .set(auth(owner.token))
      .expect(204);
    // Removed members lose access immediately.
    await request(app())
      .get(`/api/v1/shops/${shop.id}/customers`)
      .set(auth(tech.token))
      .expect(403);
  });

  it("guards the owner role and the last owner", async () => {
    const owner = await registerUser("shop-own-a@example.com");
    const admin = await registerUser("shop-own-b@example.com");
    const shop = await createShop(owner.token);
    await request(app())
      .post(`/api/v1/shops/${shop.id}/members`)
      .set(auth(owner.token))
      .send({ user_id: admin.id, role: "admin" })
      .expect(201);

    // Admins cannot grant owner.
    const tech = await registerUser("shop-own-c@example.com");
    await request(app())
      .post(`/api/v1/shops/${shop.id}/members`)
      .set(auth(admin.token))
      .send({ user_id: tech.id, role: "owner" })
      .expect(403);
    // Owners can.
    await request(app())
      .post(`/api/v1/shops/${shop.id}/members`)
      .set(auth(owner.token))
      .send({ user_id: tech.id, role: "owner" })
      .expect(201);

    // The last owner cannot be removed or demoted.
    await request(app())
      .delete(`/api/v1/shops/${shop.id}/members/${owner.id}`)
      .set(auth(tech.token))
      .expect(204); // two owners: removal works
    await request(app())
      .delete(`/api/v1/shops/${shop.id}/members/${tech.id}`)
      .set(auth(admin.token))
      .expect(422); // last owner: removal refused
    await request(app())
      .patch(`/api/v1/shops/${shop.id}/members/${tech.id}`)
      .set(auth(admin.token))
      .send({ role: "admin" })
      .expect(422); // last owner: demotion refused
  });

  it("restricts shop edits to owners and admins", async () => {
    const owner = await registerUser("shop-edit-owner@example.com");
    const tech = await registerUser("shop-edit-tech@example.com");
    const admin = await registerUser("shop-edit-admin@example.com");
    const shop = await createShop(owner.token);
    await request(app())
      .post(`/api/v1/shops/${shop.id}/members`)
      .set(auth(owner.token))
      .send({ user_id: tech.id, role: "technician" })
      .expect(201);
    await request(app())
      .post(`/api/v1/shops/${shop.id}/members`)
      .set(auth(owner.token))
      .send({ user_id: admin.id, role: "admin" })
      .expect(201);

    await request(app())
      .patch(`/api/v1/shops/${shop.id}`)
      .set(auth(tech.token))
      .send({ city: "Dallas" })
      .expect(403);
    const updated = await request(app())
      .patch(`/api/v1/shops/${shop.id}`)
      .set(auth(admin.token))
      .send({ city: "Dallas" });
    expect(updated.status).toBe(200);
    expect(updated.body.shop.city).toBe("Dallas");
    await request(app())
      .patch(`/api/v1/shops/${shop.id}`)
      .set(auth(owner.token))
      .send({})
      .expect(400);
  });
});

describe("customers and devices", () => {
  it("creates customers with service-generated references and searches them", async () => {
    const owner = await registerUser("shop-cust@example.com");
    const shop = await createShop(owner.token);
    const alice = await createCustomer(owner.token, shop.id, {
      name: "Alice Anderson",
      phone: "+1-555-0101",
    });
    expect(alice.reference).toMatch(/^C-[0-9a-f]{8}$/);
    await createCustomer(owner.token, shop.id, { name: "Bob Baker" });

    // Client-supplied references are ignored (contract strips them).
    const forced = await request(app())
      .post(`/api/v1/shops/${shop.id}/customers`)
      .set(auth(owner.token))
      .send({ name: "Carol", reference: "C-deadbeef" });
    expect(forced.status).toBe(201);
    expect(forced.body.customer.reference).not.toBe("C-deadbeef");

    const byName = await request(app())
      .get(`/api/v1/shops/${shop.id}/customers`)
      .query({ search: "ali" })
      .set(auth(owner.token));
    expect(byName.status).toBe(200);
    expect(listShopCustomersResponseSchema.safeParse(byName.body).success).toBe(true);
    expect(byName.body.customers).toHaveLength(1);
    expect(byName.body.customers[0].name).toBe("Alice Anderson");

    const byRef = await request(app())
      .get(`/api/v1/shops/${shop.id}/customers`)
      .query({ search: alice.reference })
      .set(auth(owner.token));
    expect(byRef.body.customers).toHaveLength(1);

    const byPhone = await request(app())
      .get(`/api/v1/shops/${shop.id}/customers`)
      .query({ search: "555-0101" })
      .set(auth(owner.token));
    expect(byPhone.body.customers).toHaveLength(1);

    const missing = await request(app())
      .get(`/api/v1/shops/${shop.id}/customers`)
      .query({ search: "zzz-no-match" })
      .set(auth(owner.token));
    expect(missing.body.customers).toHaveLength(0);

    const one = await request(app())
      .get(`/api/v1/shops/${shop.id}/customers/${alice.id}`)
      .set(auth(owner.token));
    expect(one.status).toBe(200);
    expect(shopCustomerResponseSchema.safeParse(one.body).success).toBe(true);

    const patched = await request(app())
      .patch(`/api/v1/shops/${shop.id}/customers/${alice.id}`)
      .set(auth(owner.token))
      .send({ notes: "Prefers email contact." });
    expect(patched.status).toBe(200);
    expect(patched.body.customer.notes).toBe("Prefers email contact.");
  });

  it("manages devices under their customer", async () => {
    const owner = await registerUser("shop-dev@example.com");
    const shop = await createShop(owner.token);
    const customer = await createCustomer(owner.token, shop.id);

    const res = await request(app())
      .post(`/api/v1/shops/${shop.id}/customers/${customer.id}/devices`)
      .set(auth(owner.token))
      .send({ category: "laptop", manufacturer: "Acme", model: "X1" });
    expect(res.status).toBe(201);
    expect(res.body.device.category).toBe("laptop");

    const list = await request(app())
      .get(`/api/v1/shops/${shop.id}/customers/${customer.id}/devices`)
      .set(auth(owner.token));
    expect(list.status).toBe(200);
    expect(listCustomerDevicesResponseSchema.safeParse(list.body).success).toBe(true);
    expect(list.body.devices).toHaveLength(1);

    await request(app())
      .post(`/api/v1/shops/${shop.id}/customers/${customer.id}/devices`)
      .set(auth(owner.token))
      .send({ category: "tablet" })
      .expect(400);
    await request(app())
      .post(`/api/v1/shops/${shop.id}/customers/${UNKNOWN_ID}/devices`)
      .set(auth(owner.token))
      .send({ category: "laptop" })
      .expect(404);
  });
});

describe("repair jobs", () => {
  it("runs the job lifecycle with an event timeline", async () => {
    const owner = await registerUser("shop-job@example.com");
    const tech = await registerUser("shop-job-tech@example.com");
    const shop = await createShop(owner.token);
    await request(app())
      .post(`/api/v1/shops/${shop.id}/members`)
      .set(auth(owner.token))
      .send({ user_id: tech.id, role: "technician" })
      .expect(201);
    const customer = await createCustomer(owner.token, shop.id);
    const deviceRes = await request(app())
      .post(`/api/v1/shops/${shop.id}/customers/${customer.id}/devices`)
      .set(auth(owner.token))
      .send({ category: "smartphone" });
    const deviceId = deviceRes.body.device.id as string;

    const job = await createJob(owner.token, shop.id, {
      customer_id: customer.id,
      device_id: deviceId,
      reported_fault: "Screen flickers.",
      priority: "high",
      assignee_user_id: tech.id,
    });
    expect(job.job_reference).toMatch(/^J-[0-9a-f]{8}$/);

    // Non-members cannot be assigned.
    const outsider = await registerUser("shop-job-out@example.com");
    await request(app())
      .post(`/api/v1/shops/${shop.id}/jobs`)
      .set(auth(owner.token))
      .send({
        customer_id: customer.id,
        reported_fault: "x",
        assignee_user_id: outsider.id,
      })
      .expect(422);

    // Status changes append timestamped timeline events.
    await request(app())
      .patch(`/api/v1/shops/${shop.id}/jobs/${job.id}`)
      .set(auth(tech.token))
      .send({ status: "diagnosing" })
      .expect(200);
    await request(app())
      .patch(`/api/v1/shops/${shop.id}/jobs/${job.id}`)
      .set(auth(tech.token))
      .send({ status: "in_repair" })
      .expect(200);
    const note = await request(app())
      .post(`/api/v1/shops/${shop.id}/jobs/${job.id}/events`)
      .set(auth(tech.token))
      .send({ kind: "note", body: "Ordered replacement panel." });
    expect(note.status).toBe(201);

    const timeline = await request(app())
      .get(`/api/v1/shops/${shop.id}/jobs/${job.id}/events`)
      .set(auth(owner.token));
    expect(timeline.status).toBe(200);
    expect(listRepairJobEventsResponseSchema.safeParse(timeline.body).success).toBe(true);
    expect(timeline.body.events).toHaveLength(3);
    const [first, second, third] = timeline.body.events as Array<Record<string, unknown>>;
    expect(first).toMatchObject({
      kind: "status_change",
      from_status: "received",
      to_status: "diagnosing",
    });
    expect(second).toMatchObject({
      kind: "status_change",
      from_status: "diagnosing",
      to_status: "in_repair",
    });
    expect(third).toMatchObject({ kind: "note", body: "Ordered replacement panel." });
    // Oldest first.
    expect(
      new Date(first.created_at as string).getTime() <=
        new Date(third.created_at as string).getTime(),
    ).toBe(true);

    // Same-status writes are idempotent (no duplicate event).
    await request(app())
      .patch(`/api/v1/shops/${shop.id}/jobs/${job.id}`)
      .set(auth(tech.token))
      .send({ status: "in_repair" })
      .expect(200);
    const again = await request(app())
      .get(`/api/v1/shops/${shop.id}/jobs/${job.id}/events`)
      .set(auth(owner.token));
    expect(again.body.events).toHaveLength(3);
  });

  it("filters jobs by status, priority, assignee, customer, and date", async () => {
    const owner = await registerUser("shop-filter@example.com");
    const tech = await registerUser("shop-filter-tech@example.com");
    const shop = await createShop(owner.token);
    await request(app())
      .post(`/api/v1/shops/${shop.id}/members`)
      .set(auth(owner.token))
      .send({ user_id: tech.id, role: "technician" })
      .expect(201);
    const alice = await createCustomer(owner.token, shop.id, { name: "Alice" });
    const bob = await createCustomer(owner.token, shop.id, { name: "Bob" });
    const urgent = await createJob(owner.token, shop.id, {
      customer_id: alice.id,
      reported_fault: "Urgent fault.",
      priority: "urgent",
      assignee_user_id: tech.id,
    });
    await request(app())
      .patch(`/api/v1/shops/${shop.id}/jobs/${urgent.id}`)
      .set(auth(owner.token))
      .send({ status: "diagnosing" })
      .expect(200);
    await createJob(owner.token, shop.id, {
      customer_id: bob.id,
      reported_fault: "Minor fault.",
    });

    const byStatus = await request(app())
      .get(`/api/v1/shops/${shop.id}/jobs`)
      .query({ status: "diagnosing" })
      .set(auth(owner.token));
    expect(byStatus.status).toBe(200);
    expect(listRepairJobsResponseSchema.safeParse(byStatus.body).success).toBe(true);
    expect(byStatus.body.jobs).toHaveLength(1);

    const byPriority = await request(app())
      .get(`/api/v1/shops/${shop.id}/jobs`)
      .query({ priority: "urgent" })
      .set(auth(owner.token));
    expect(byPriority.body.jobs).toHaveLength(1);

    const byAssignee = await request(app())
      .get(`/api/v1/shops/${shop.id}/jobs`)
      .query({ assignee: tech.id })
      .set(auth(owner.token));
    expect(byAssignee.body.jobs).toHaveLength(1);

    const byCustomer = await request(app())
      .get(`/api/v1/shops/${shop.id}/jobs`)
      .query({ customer: bob.id })
      .set(auth(owner.token));
    expect(byCustomer.body.jobs).toHaveLength(1);

    const future = await request(app())
      .get(`/api/v1/shops/${shop.id}/jobs`)
      .query({ from: new Date(Date.now() + 86400000).toISOString() })
      .set(auth(owner.token));
    expect(future.body.jobs).toHaveLength(0);

    await request(app())
      .get(`/api/v1/shops/${shop.id}/jobs`)
      .query({ status: "nope" })
      .set(auth(owner.token))
      .expect(400);
  });

  it("attaches only sessions the caller owns, and detaches", async () => {
    const owner = await registerUser("shop-sess-a@example.com");
    const other = await registerUser("shop-sess-b@example.com");
    const shop = await createShop(owner.token);
    const customer = await createCustomer(owner.token, shop.id);
    const job = await createJob(owner.token, shop.id, {
      customer_id: customer.id,
      reported_fault: "Fault.",
    });
    const mine = await createOwnedSession(owner.token);
    const theirs = await createOwnedSession(other.token);

    await request(app())
      .post(`/api/v1/shops/${shop.id}/jobs/${job.id}/session`)
      .set(auth(owner.token))
      .send({ session_id: theirs.id })
      .expect(403);
    await request(app())
      .post(`/api/v1/shops/${shop.id}/jobs/${job.id}/session`)
      .set(auth(owner.token))
      .send({ session_id: UNKNOWN_ID })
      .expect(404);

    const attach = await request(app())
      .post(`/api/v1/shops/${shop.id}/jobs/${job.id}/session`)
      .set(auth(owner.token))
      .send({ session_id: mine.id });
    expect(attach.status).toBe(200);
    expect(repairJobResponseSchema.safeParse(attach.body).success).toBe(true);
    expect(attach.body.job.session_id).toBe(mine.id);

    const detach = await request(app())
      .delete(`/api/v1/shops/${shop.id}/jobs/${job.id}/session`)
      .set(auth(owner.token));
    expect(detach.status).toBe(200);
    expect(detach.body.job.session_id).toBeNull();
  });

  it("exposes the linked session safety_state read-only in job detail", async () => {
    const owner = await registerUser("shop-haz@example.com");
    const shop = await createShop(owner.token);
    const customer = await createCustomer(owner.token, shop.id);
    const job = await createJob(owner.token, shop.id, {
      customer_id: customer.id,
      reported_fault: "Battery swollen?",
    });

    const bare = await request(app())
      .get(`/api/v1/shops/${shop.id}/jobs/${job.id}`)
      .set(auth(owner.token));
    expect(bare.status).toBe(200);
    expect(repairJobDetailResponseSchema.safeParse(bare.body).success).toBe(true);
    expect(bare.body.session_safety_state).toBeNull();

    const session = await createOwnedSession(owner.token);
    await request(app())
      .post(`/api/v1/shops/${shop.id}/jobs/${job.id}/session`)
      .set(auth(owner.token))
      .send({ session_id: session.id })
      .expect(200);

    await recordSafetyTransition(db, {
      session_id: session.id,
      event: {
        previous_state: "normal",
        new_state: "critical_stop",
        trigger_type: "user_report",
        trigger_detail: "Swollen battery.",
        safe_next_steps: "Stop; unplug; ventilate.",
      },
    });

    const hazard = await request(app())
      .get(`/api/v1/shops/${shop.id}/jobs/${job.id}`)
      .set(auth(owner.token));
    expect(hazard.status).toBe(200);
    expect(hazard.body.session_safety_state).toBe("critical_stop");
  });
});

describe("estimates", () => {
  async function setupJob(prefix: string) {
    const owner = await registerUser(`${prefix}@example.com`);
    const shop = await createShop(owner.token);
    const customer = await createCustomer(owner.token, shop.id);
    const job = await createJob(owner.token, shop.id, {
      customer_id: customer.id,
      reported_fault: "Fault.",
    });
    return { owner, shop, job };
  }

  it("creates, edits drafts, and walks the status lifecycle", async () => {
    const { owner, shop, job } = await setupJob("shop-est");

    const created = await request(app())
      .post(`/api/v1/shops/${shop.id}/jobs/${job.id}/estimates`)
      .set(auth(owner.token))
      .send({
        diagnosis_summary: "Board failure.",
        recommended_repair: "Replace DC jack.",
        labor_cents: 5000,
        currency: "USD",
        items: [
          { kind: "part", description: "DC jack", part_number: "DJ-1", quantity: 1, unit_cents: 1200 },
          { kind: "labor", description: "Board work", quantity: 1, unit_cents: 5000 },
        ],
      });
    expect(created.status).toBe(201);
    expect(repairEstimateResponseSchema.safeParse(created.body).success).toBe(true);
    expect(created.body.estimate.status).toBe("draft");
    expect(created.body.items).toHaveLength(2);
    const estId = created.body.estimate.id as string;

    // Draft items replace wholesale.
    const edited = await request(app())
      .patch(`/api/v1/shops/${shop.id}/jobs/${job.id}/estimates/${estId}`)
      .set(auth(owner.token))
      .send({
        labor_cents: 6000,
        items: [{ kind: "part", description: "DC jack v2", quantity: 2, unit_cents: 900 }],
      });
    expect(edited.status).toBe(200);
    expect(edited.body.estimate.labor_cents).toBe(6000);
    expect(edited.body.items).toHaveLength(1);
    expect(edited.body.items[0]).toMatchObject({ description: "DC jack v2", quantity: 2 });

    // draft -> sent locks the line items.
    await request(app())
      .patch(`/api/v1/shops/${shop.id}/jobs/${job.id}/estimates/${estId}`)
      .set(auth(owner.token))
      .send({ status: "sent" })
      .expect(200);
    await request(app())
      .patch(`/api/v1/shops/${shop.id}/jobs/${job.id}/estimates/${estId}`)
      .set(auth(owner.token))
      .send({ items: [] })
      .expect(422);

    // Converted-via-PATCH is refused: convert has its own endpoint.
    await request(app())
      .patch(`/api/v1/shops/${shop.id}/jobs/${job.id}/estimates/${estId}`)
      .set(auth(owner.token))
      .send({ status: "approved" })
      .expect(200);
    await request(app())
      .patch(`/api/v1/shops/${shop.id}/jobs/${job.id}/estimates/${estId}`)
      .set(auth(owner.token))
      .send({ status: "converted" })
      .expect(422);

    const list = await request(app())
      .get(`/api/v1/shops/${shop.id}/jobs/${job.id}/estimates`)
      .set(auth(owner.token));
    expect(list.status).toBe(200);
    expect(listRepairEstimatesResponseSchema.safeParse(list.body).success).toBe(true);
    expect(list.body.estimates).toHaveLength(1);
    expect(list.body.estimates[0].estimate.decided_at).not.toBeNull();
  });

  it("converts approved estimates and bumps awaiting_approval jobs", async () => {
    const { owner, shop, job } = await setupJob("shop-conv");
    await request(app())
      .patch(`/api/v1/shops/${shop.id}/jobs/${job.id}`)
      .set(auth(owner.token))
      .send({ status: "awaiting_approval" })
      .expect(200);

    const created = await request(app())
      .post(`/api/v1/shops/${shop.id}/jobs/${job.id}/estimates`)
      .set(auth(owner.token))
      .send({ diagnosis_summary: "Screen failure." });
    const estId = created.body.estimate.id as string;

    // Draft estimates cannot convert.
    await request(app())
      .post(`/api/v1/shops/${shop.id}/jobs/${job.id}/estimates/${estId}/convert`)
      .set(auth(owner.token))
      .expect(422);

    await request(app())
      .patch(`/api/v1/shops/${shop.id}/jobs/${job.id}/estimates/${estId}`)
      .set(auth(owner.token))
      .send({ status: "approved" })
      .expect(200);
    const converted = await request(app())
      .post(`/api/v1/shops/${shop.id}/jobs/${job.id}/estimates/${estId}/convert`)
      .set(auth(owner.token));
    expect(converted.status).toBe(200);
    expect(converted.body.estimate.status).toBe("converted");

    // The job moved into repair with a timeline entry.
    const detail = await request(app())
      .get(`/api/v1/shops/${shop.id}/jobs/${job.id}`)
      .set(auth(owner.token));
    expect(detail.body.job.status).toBe("in_repair");
    const timeline = await request(app())
      .get(`/api/v1/shops/${shop.id}/jobs/${job.id}/events`)
      .set(auth(owner.token));
    const bump = (timeline.body.events as Array<Record<string, unknown>>).find(
      (e) => e.to_status === "in_repair",
    );
    expect(bump).toMatchObject({
      kind: "status_change",
      from_status: "awaiting_approval",
      to_status: "in_repair",
    });

    // Converted is terminal.
    await request(app())
      .post(`/api/v1/shops/${shop.id}/jobs/${job.id}/estimates/${estId}/convert`)
      .set(auth(owner.token))
      .expect(422);
    await request(app())
      .patch(`/api/v1/shops/${shop.id}/jobs/${job.id}/estimates/${estId}`)
      .set(auth(owner.token))
      .send({ status: "draft" })
      .expect(422);
  });

  it("rejects unknown part-recommendation links", async () => {
    const { owner, shop, job } = await setupJob("shop-estlink");
    await request(app())
      .post(`/api/v1/shops/${shop.id}/jobs/${job.id}/estimates`)
      .set(auth(owner.token))
      .send({
        items: [
          { kind: "part", description: "Ghost part", source_part_rec_id: UNKNOWN_ID },
        ],
      })
      .expect(404);
  });
});

describe("inventory", () => {
  it("returns 500 instead of crashing when a movement fails", async () => {
    const owner = await registerUser("shop-500@example.com");
    const shop = await createShop(owner.token);
    const created = await request(app())
      .post(`/api/v1/shops/${shop.id}/inventory`)
      .set(auth(owner.token))
      .send({ name: "DC jack", quantity: 10 });
    expect(created.status).toBe(201);
    const itemId = created.body.item.id as string;
    const spy = vi.spyOn(db, "transaction").mockImplementationOnce(() => {
      throw new Error("simulated transaction failure");
    });
    try {
      const res = await request(app())
        .post(`/api/v1/shops/${shop.id}/inventory/${itemId}/movements`)
        .set(auth(owner.token))
        .send({ delta: -1, reason: "Used on repair." });
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("internal_error");
    } finally {
      spy.mockRestore();
    }
  });

  it("deducts transactionally and forbids negative stock", async () => {
    const owner = await registerUser("shop-inv@example.com");
    const shop = await createShop(owner.token);
    const customer = await createCustomer(owner.token, shop.id);
    const job = await createJob(owner.token, shop.id, {
      customer_id: customer.id,
      reported_fault: "Fault.",
    });

    const created = await request(app())
      .post(`/api/v1/shops/${shop.id}/inventory`)
      .set(auth(owner.token))
      .send({ name: "DC jack", part_number: "DJ-1", quantity: 10, low_threshold: 3 });
    expect(created.status).toBe(201);
    expect(inventoryItemResponseSchema.safeParse(created.body).success).toBe(true);
    const itemId = created.body.item.id as string;

    const restock = await request(app())
      .post(`/api/v1/shops/${shop.id}/inventory/${itemId}/movements`)
      .set(auth(owner.token))
      .send({ delta: 5, reason: "Supplier delivery." });
    expect(restock.status).toBe(201);
    expect(inventoryMovementResponseSchema.safeParse(restock.body).success).toBe(true);
    expect(restock.body.quantity).toBe(15);

    const use = await request(app())
      .post(`/api/v1/shops/${shop.id}/inventory/${itemId}/movements`)
      .set(auth(owner.token))
      .send({ delta: -13, job_id: job.id, reason: "Used on repair." });
    expect(use.status).toBe(201);
    expect(use.body.quantity).toBe(2);

    // Over-deduction fails WITHOUT changing stock or writing a row.
    await request(app())
      .post(`/api/v1/shops/${shop.id}/inventory/${itemId}/movements`)
      .set(auth(owner.token))
      .send({ delta: -3, reason: "Too many." })
      .expect(422);
    const after = await request(app())
      .get(`/api/v1/shops/${shop.id}/inventory/${itemId}`)
      .set(auth(owner.token));
    expect(after.body.item.quantity).toBe(2);
    const ledger = await request(app())
      .get(`/api/v1/shops/${shop.id}/inventory/${itemId}/movements`)
      .set(auth(owner.token));
    expect(listInventoryMovementsResponseSchema.safeParse(ledger.body).success).toBe(true);
    expect(ledger.body.movements).toHaveLength(2);

    // Zero deltas and foreign jobs are refused.
    await request(app())
      .post(`/api/v1/shops/${shop.id}/inventory/${itemId}/movements`)
      .set(auth(owner.token))
      .send({ delta: 0, reason: "No-op." })
      .expect(400);
    await request(app())
      .post(`/api/v1/shops/${shop.id}/inventory/${itemId}/movements`)
      .set(auth(owner.token))
      .send({ delta: -1, job_id: UNKNOWN_ID, reason: "Ghost job." })
      .expect(404);

    // Low-stock flag: 2 on hand against a threshold of 3.
    const low = await request(app())
      .get(`/api/v1/shops/${shop.id}/inventory`)
      .query({ low_stock: "true" })
      .set(auth(owner.token));
    expect(low.status).toBe(200);
    expect(listInventoryResponseSchema.safeParse(low.body).success).toBe(true);
    expect(low.body.items).toHaveLength(1);

    const patched = await request(app())
      .patch(`/api/v1/shops/${shop.id}/inventory/${itemId}`)
      .set(auth(owner.token))
      .send({ low_threshold: 1, price_cents: 1500 });
    expect(patched.status).toBe(200);
    expect(patched.body.item.low_threshold).toBe(1);
    const lowAgain = await request(app())
      .get(`/api/v1/shops/${shop.id}/inventory`)
      .query({ low_stock: "true" })
      .set(auth(owner.token));
    expect(lowAgain.body.items).toHaveLength(0);
  });
});

describe("reports", () => {
  it("summarizes counts, turnaround, consumption, and workload", async () => {
    const owner = await registerUser("shop-rep@example.com");
    const tech = await registerUser("shop-rep-tech@example.com");
    const shop = await createShop(owner.token);
    await request(app())
      .post(`/api/v1/shops/${shop.id}/members`)
      .set(auth(owner.token))
      .send({ user_id: tech.id, role: "technician" })
      .expect(201);
    const customer = await createCustomer(owner.token, shop.id);

    const mkJob = (fault: string) =>
      createJob(owner.token, shop.id, {
        customer_id: customer.id,
        reported_fault: fault,
        assignee_user_id: tech.id,
      });
    const waiting = await mkJob("Waiting on parts.");
    const wrench = await mkJob("On the bench.");
    const probe = await mkJob("Under test.");
    const done = await mkJob("Finished.");

    await request(app())
      .patch(`/api/v1/shops/${shop.id}/jobs/${waiting.id}`)
      .set(auth(tech.token))
      .send({ status: "awaiting_parts" })
      .expect(200);
    await request(app())
      .patch(`/api/v1/shops/${shop.id}/jobs/${wrench.id}`)
      .set(auth(tech.token))
      .send({ status: "in_repair" })
      .expect(200);
    await request(app())
      .patch(`/api/v1/shops/${shop.id}/jobs/${probe.id}`)
      .set(auth(tech.token))
      .send({ status: "testing" })
      .expect(200);
    await request(app())
      .patch(`/api/v1/shops/${shop.id}/jobs/${done.id}`)
      .set(auth(tech.token))
      .send({ status: "completed" })
      .expect(200);
    // Deterministic turnaround: received exactly 48h before completion.
    const completedAt = new Date("2026-06-10T12:00:00.000Z");
    const receivedAt = new Date(
      completedAt.getTime() - 48 * 3600 * 1000,
    ).toISOString();
    await db
      .updateTable("repair_jobs")
      .set({
        // Generated<Timestamp> only accepts expressions here; bind the ISO
        // value as a timestamptz parameter (codebase sql-fragment pattern).
        received_at: sql`${receivedAt}::timestamptz`,
        completed_at: completedAt.toISOString(),
      })
      .where("id", "=", done.id)
      .execute();

    const item = await request(app())
      .post(`/api/v1/shops/${shop.id}/inventory`)
      .set(auth(owner.token))
      .send({ name: "DC jack", quantity: 10 });
    const itemId = item.body.item.id as string;
    await request(app())
      .post(`/api/v1/shops/${shop.id}/inventory/${itemId}/movements`)
      .set(auth(tech.token))
      .send({ delta: -3, job_id: wrench.id, reason: "Used on repair." })
      .expect(201);
    await request(app())
      .post(`/api/v1/shops/${shop.id}/inventory/${itemId}/movements`)
      .set(auth(tech.token))
      .send({ delta: -2, job_id: probe.id, reason: "Used on repair." })
      .expect(201);

    const res = await request(app())
      .get(`/api/v1/shops/${shop.id}/reports/summary`)
      .set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(shopReportSummaryResponseSchema.safeParse(res.body).success).toBe(true);
    const summary = res.body.summary as Record<string, unknown>;
    expect(summary.jobs_total).toBe(4);
    expect(summary.jobs_by_status).toMatchObject({
      awaiting_parts: 1,
      in_repair: 1,
      testing: 1,
      completed: 1,
    });
    expect(summary.in_progress).toBe(2); // in_repair + testing
    expect(summary.avg_turnaround_hours).toBe(48);
    expect(summary.parts_consumption).toEqual([
      { item_id: itemId, item_name: "DC jack", quantity_used: 5 },
    ]);
    expect(summary.workload).toEqual([
      { user_id: tech.id, active_jobs: 3, completed_jobs: 1 },
    ]);
    // Actuals-only: no estimate-derived revenue anywhere.
    expect(summary).not.toHaveProperty("revenue");
    expect(summary).not.toHaveProperty("revenue_cents");
    expect(summary).not.toHaveProperty("estimate_total");

    // Date windows filter the whole summary.
    const empty = await request(app())
      .get(`/api/v1/shops/${shop.id}/reports/summary`)
      .query({ from: new Date(Date.now() + 86400000).toISOString() })
      .set(auth(owner.token));
    expect(empty.body.summary.jobs_total).toBe(0);
    expect(empty.body.summary.avg_turnaround_hours).toBeNull();

    await request(app())
      .get(`/api/v1/shops/${shop.id}/reports/summary`)
      .query({ from: "not-a-date" })
      .set(auth(owner.token))
      .expect(400);
  });
});
