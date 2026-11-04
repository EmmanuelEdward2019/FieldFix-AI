import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Kysely } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  contactRequestResponseSchema,
  handoffDetailResponseSchema,
  handoffResponseSchema,
  listContactRequestsResponseSchema,
  listTechniciansResponseSchema,
  reportDataSchema,
  technicianResponseSchema,
} from "@fieldfix/contracts";
import { createApp } from "../src/app.js";
import type { Database } from "../src/db/database.js";
import { ReportRepository } from "../src/db/repositories/reports.js";
import { TechnicianProfileRepository } from "../src/db/repositories/technicians.js";
import type { AppEnv } from "../src/env.js";
import { testEmailOutbox } from "../src/email/resend.js";
import { LocalStorageAdapter } from "../src/storage/local-adapter.js";
import type { StorageAdapter } from "../src/storage/types.js";
import { setupTestDb, teardownTestDb, truncateAll } from "./db/setup.js";
import { sessionWithRole } from "./helpers/admin-auth.js";

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

const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";
// Austin ~ Dallas is ~300km; the near tech sits ~8km from downtown Austin.
const AUSTIN = { lat: 30.2672, lng: -97.7431 };
const NEAR_AUSTIN = { lat: 30.32, lng: -97.78 };
const DALLAS = { lat: 32.7767, lng: -96.797 };

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
  name = "Tech User",
): Promise<{ id: string; token: string }> {
  const reg = await request(app())
    .post("/api/v1/auth/register")
    .send({ name, email, password: "tech-pass-01" });
  expect(reg.status).toBe(201);
  const token = emailedToken(email, "/verify-email");
  const verify = await request(app()).post("/api/v1/auth/verify-email").send({ token });
  expect(verify.status).toBe(200);
  return { id: verify.body.user.id as string, token: verify.body.token as string };
}

async function seedProfile(
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await new TechnicianProfileRepository(db).upsert({
    user_id: userId,
    display_name: "Sam Rivera",
    city: "Austin",
    region: "TX",
    ...overrides,
  } as Parameters<TechnicianProfileRepository["upsert"]>[0]);
}

async function createOwnedSession(token: string, symptoms = "Will not power on.") {
  const res = await request(app())
    .post("/api/v1/sessions")
    .set(auth(token))
    .send({ device_type: "laptop", symptoms, user_mode: "everyday" });
  expect(res.status).toBe(201);
  return res.body.session as { id: string };
}

async function uploadEvidence(
  token: string,
  sessionId: string,
  filename = "front.png",
): Promise<string> {
  const res = await request(app())
    .post(`/api/v1/sessions/${sessionId}/evidence`)
    .set(auth(token))
    .attach("file", PNG, { filename, contentType: "image/png" });
  expect(res.status).toBe(201);
  return (res.body.file as { id: string }).id;
}

beforeAll(async () => {
  db = await setupTestDb();
  storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-techs-"));
  storage = new LocalStorageAdapter(storageDir);
});

afterAll(async () => {
  await teardownTestDb(db);
  await rm(storageDir, { recursive: true, force: true });
});

let adminSession: { id: string; token: string };

beforeEach(async () => {
  await truncateAll(db);
  adminSession = await sessionWithRole(app(), db, "tech-admin@example.com", "admin");
});

describe("GET /api/v1/technicians (public search)", () => {
  it("lists accepting profiles without contact PII", async () => {
    const tech = await registerUser("tech-list@example.com");
    await seedProfile(tech.id, {
      phone: "+1-555-0100",
      contact_email: "sam@example.com",
      whatsapp: "+1-555-0100",
    });
    const res = await request(app()).get("/api/v1/technicians");
    expect(res.status).toBe(200);
    expect(listTechniciansResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.technicians).toHaveLength(1);
    const item = res.body.technicians[0] as Record<string, unknown>;
    expect(item.display_name).toBe("Sam Rivera");
    expect(item.verified).toBe(false);
    expect(item.distance_km).toBeNull();
    expect(item).not.toHaveProperty("phone");
    expect(item).not.toHaveProperty("contact_email");
    expect(item).not.toHaveProperty("whatsapp");
  });

  it("excludes non-accepting profiles and filters by text", async () => {
    const open = await registerUser("tech-open@example.com");
    const closed = await registerUser("tech-closed@example.com");
    const dallas = await registerUser("tech-dallas@example.com");
    await seedProfile(open.id, {
      display_name: "Open Tech",
      specialties: ["board-repair"],
      device_types: ["laptop"],
    });
    await seedProfile(closed.id, {
      display_name: "Closed Tech",
      accepting_requests: false,
    });
    await seedProfile(dallas.id, {
      display_name: "Dallas Tech",
      city: "Dallas",
      specialties: ["screen-repair"],
      device_types: ["smartphone"],
    });

    const all = await request(app()).get("/api/v1/technicians");
    expect(all.body.technicians.map((t: { display_name: string }) => t.display_name).sort()).toEqual(
      ["Dallas Tech", "Open Tech"],
    );

    const city = await request(app()).get("/api/v1/technicians").query({ city: "austin" });
    expect(city.body.technicians).toHaveLength(1);
    expect(city.body.technicians[0].display_name).toBe("Open Tech");

    const specialty = await request(app())
      .get("/api/v1/technicians")
      .query({ specialty: "SCREEN-REPAIR" });
    expect(specialty.body.technicians).toHaveLength(1);
    expect(specialty.body.technicians[0].display_name).toBe("Dallas Tech");

    const device = await request(app())
      .get("/api/v1/technicians")
      .query({ device_type: "Laptop" });
    expect(device.body.technicians).toHaveLength(1);
    expect(device.body.technicians[0].display_name).toBe("Open Tech");

    const none = await request(app())
      .get("/api/v1/technicians")
      .query({ city: "Nowhere" });
    expect(none.body.technicians).toHaveLength(0);
  });

  it("radius search returns nearby techs with distance, sorted", async () => {
    const near = await registerUser("tech-near@example.com");
    const mid = await registerUser("tech-mid@example.com");
    const far = await registerUser("tech-far@example.com");
    const nongeo = await registerUser("tech-nongeo@example.com");
    await seedProfile(near.id, {
      display_name: "Near Tech",
      latitude: NEAR_AUSTIN.lat,
      longitude: NEAR_AUSTIN.lng,
    });
    await seedProfile(mid.id, {
      display_name: "Mid Tech",
      latitude: 30.45,
      longitude: -97.75,
    });
    await seedProfile(far.id, {
      display_name: "Far Tech",
      city: "Dallas",
      region: "TX",
      latitude: DALLAS.lat,
      longitude: DALLAS.lng,
    });
    await seedProfile(nongeo.id, { display_name: "No Geo Tech" });

    const res = await request(app())
      .get("/api/v1/technicians")
      .query({ lat: String(AUSTIN.lat), lng: String(AUSTIN.lng), radius_km: "50" });
    expect(res.status).toBe(200);
    expect(res.body.technicians).toHaveLength(2);
    // Nearest first: ~8km then ~20km from downtown Austin.
    expect(res.body.technicians[0].display_name).toBe("Near Tech");
    expect(res.body.technicians[1].display_name).toBe("Mid Tech");
    expect(res.body.technicians[0].distance_km).toBeGreaterThan(1);
    expect(res.body.technicians[0].distance_km).toBeLessThan(
      res.body.technicians[1].distance_km,
    );
    expect(res.body.technicians[1].distance_km).toBeLessThan(50);

    // Dallas (~300km) stays out even at max radius; the opt-out never matches geo.
    const maxed = await request(app())
      .get("/api/v1/technicians")
      .query({ lat: String(AUSTIN.lat), lng: String(AUSTIN.lng), radius_km: "200" });
    expect(maxed.status).toBe(200);
    expect(maxed.body.technicians.map((t: { display_name: string }) => t.display_name)).toEqual([
      "Near Tech",
      "Mid Tech",
    ]);

    // Without coordinates every accepting tech lists (distance null).
    const plain = await request(app()).get("/api/v1/technicians");
    expect(plain.body.technicians).toHaveLength(4);
  });

  it("rejects half-specified geo queries and out-of-range params", async () => {
    await request(app()).get("/api/v1/technicians").query({ lat: "30" }).expect(400);
    await request(app())
      .get("/api/v1/technicians")
      .query({ lat: "30", lng: "-97", radius_km: "0" })
      .expect(400);
    await request(app()).get("/api/v1/technicians").query({ limit: "51" }).expect(400);
  });
});

describe("GET /api/v1/technicians/:userId (public card)", () => {
  it("includes contact details only when the profile exposes them", async () => {
    const tech = await registerUser("tech-card@example.com");
    const bare = await registerUser("tech-bare@example.com");
    await seedProfile(tech.id, {
      phone: "+1-555-0100",
      contact_email: "sam@example.com",
      whatsapp: null,
    });
    await seedProfile(bare.id, { display_name: "Bare Tech" });

    const full = await request(app()).get(`/api/v1/technicians/${tech.id}`);
    expect(full.status).toBe(200);
    expect(technicianResponseSchema.safeParse(full.body).success).toBe(true);
    expect(full.body.technician).toMatchObject({
      phone: "+1-555-0100",
      contact_email: "sam@example.com",
      whatsapp: null,
    });

    const empty = await request(app()).get(`/api/v1/technicians/${bare.id}`);
    expect(empty.body.technician.phone).toBeNull();
  });

  it("404s unknown and malformed ids", async () => {
    await request(app()).get(`/api/v1/technicians/${UNKNOWN_ID}`).expect(404);
    await request(app()).get("/api/v1/technicians/not-a-uuid").expect(404);
    // A user without a profile is not a technician.
    const plain = await registerUser("tech-plain@example.com");
    await request(app()).get(`/api/v1/technicians/${plain.id}`).expect(404);
  });
});

describe("POST /api/v1/technicians/:userId/contact", () => {
  it("requires login", async () => {
    const tech = await registerUser("tech-nologin@example.com");
    await seedProfile(tech.id);
    await request(app())
      .post(`/api/v1/technicians/${tech.id}/contact`)
      .send({ message: "Help." })
      .expect(401);
  });

  it("creates a request and notifies the technician", async () => {
    const tech = await registerUser("tech-notify@example.com");
    const customer = await registerUser("cust-notify@example.com");
    await seedProfile(tech.id);
    const res = await request(app())
      .post(`/api/v1/technicians/${tech.id}/contact`)
      .set(auth(customer.token))
      .send({ message: "My laptop will not power on.", contact_method: "email" });
    expect(res.status).toBe(201);
    expect(contactRequestResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.request).toMatchObject({
      requester_user_id: customer.id,
      technician_user_id: tech.id,
      status: "submitted",
    });

    const feed = await request(app())
      .get("/api/v1/users/me/notifications")
      .set(auth(tech.token));
    const kinds = feed.body.notifications.map((n: { kind: string }) => n.kind);
    expect(kinds).toContain("contact_request");

    // The requester is not notified about their own request.
    const own = await request(app())
      .get("/api/v1/users/me/notifications")
      .set(auth(customer.token));
    expect(
      own.body.notifications.some((n: { kind: string }) => n.kind === "contact_request"),
    ).toBe(false);
  });

  it("validates target, message, and session ownership", async () => {
    const tech = await registerUser("tech-validate@example.com");
    const closed = await registerUser("tech-closed2@example.com");
    const customer = await registerUser("cust-validate@example.com");
    const other = await registerUser("other-validate@example.com");
    await seedProfile(tech.id);
    await seedProfile(closed.id, { accepting_requests: false });
    const ownSession = await createOwnedSession(customer.token);
    const otherSession = await createOwnedSession(other.token);

    const url = `/api/v1/technicians/${tech.id}/contact`;
    await request(app()).post(url).set(auth(customer.token)).send({}).expect(400);
    await request(app())
      .post(url)
      .set(auth(customer.token))
      .send({ message: "x".repeat(2001) })
      .expect(400);
    await request(app())
      .post(`/api/v1/technicians/${UNKNOWN_ID}/contact`)
      .set(auth(customer.token))
      .send({ message: "Help." })
      .expect(404);
    await request(app())
      .post(`/api/v1/technicians/${closed.id}/contact`)
      .set(auth(customer.token))
      .send({ message: "Help." })
      .expect(422);
    await request(app())
      .post(`/api/v1/technicians/${customer.id}/contact`)
      .set(auth(customer.token))
      .send({ message: "Help." })
      .expect(404); // no profile: not a technician at all
    await seedProfile(customer.id, { display_name: "Self Tech" });
    await request(app())
      .post(`/api/v1/technicians/${customer.id}/contact`)
      .set(auth(customer.token))
      .send({ message: "Help." })
      .expect(422);

    // Session links: own ok, unknown 404, someone else's 403.
    const linked = await request(app())
      .post(url)
      .set(auth(customer.token))
      .send({ message: "Linked.", session_id: ownSession.id });
    expect(linked.status).toBe(201);
    expect(linked.body.request.session_id).toBe(ownSession.id);
    await request(app())
      .post(url)
      .set(auth(customer.token))
      .send({ message: "Ghost.", session_id: UNKNOWN_ID })
      .expect(404);
    await request(app())
      .post(url)
      .set(auth(customer.token))
      .send({ message: "Theirs.", session_id: otherSession.id })
      .expect(403);
  });
});

describe("GET /api/v1/technicians/requests (inbox)", () => {
  it("returns owner-only rows per role", async () => {
    const tech = await registerUser("tech-inbox@example.com");
    const customer = await registerUser("cust-inbox@example.com");
    const stranger = await registerUser("stranger-inbox@example.com");
    await seedProfile(tech.id);
    await request(app())
      .post(`/api/v1/technicians/${tech.id}/contact`)
      .set(auth(customer.token))
      .send({ message: "Help." })
      .expect(201);

    const received = await request(app())
      .get("/api/v1/technicians/requests")
      .set(auth(tech.token));
    expect(received.status).toBe(200);
    expect(listContactRequestsResponseSchema.safeParse(received.body).success).toBe(true);
    expect(received.body.requests).toHaveLength(1);

    const explicit = await request(app())
      .get("/api/v1/technicians/requests")
      .query({ role: "received" })
      .set(auth(tech.token));
    expect(explicit.body.requests).toHaveLength(1);

    const sent = await request(app())
      .get("/api/v1/technicians/requests")
      .query({ role: "sent" })
      .set(auth(customer.token));
    expect(sent.body.requests).toHaveLength(1);

    // Cross-role and stranger views are empty, not errors.
    const empty = await request(app())
      .get("/api/v1/technicians/requests")
      .query({ role: "sent" })
      .set(auth(tech.token));
    expect(empty.body.requests).toHaveLength(0);
    const strangerView = await request(app())
      .get("/api/v1/technicians/requests")
      .set(auth(stranger.token));
    expect(strangerView.body.requests).toHaveLength(0);

    await request(app()).get("/api/v1/technicians/requests").expect(401);
    await request(app())
      .get("/api/v1/technicians/requests")
      .query({ role: "both" })
      .set(auth(tech.token))
      .expect(400);
  });
});

describe("PATCH /api/v1/technicians/requests/:reqId (transitions)", () => {
  async function makeRequest() {
    const tech = await registerUser("tech-trans@example.com");
    const customer = await registerUser("cust-trans@example.com");
    const stranger = await registerUser("stranger-trans@example.com");
    await seedProfile(tech.id);
    const res = await request(app())
      .post(`/api/v1/technicians/${tech.id}/contact`)
      .set(auth(customer.token))
      .send({ message: "Help." });
    expect(res.status).toBe(201);
    return { tech, customer, stranger, id: res.body.request.id as string };
  }

  it("lets the technician progress and the requester cancel", async () => {
    const { tech, customer, id } = await makeRequest();
    const accept = await request(app())
      .patch(`/api/v1/technicians/requests/${id}`)
      .set(auth(tech.token))
      .send({ status: "accepted" });
    expect(accept.status).toBe(200);
    expect(accept.body.request.status).toBe("accepted");

    const progress = await request(app())
      .patch(`/api/v1/technicians/requests/${id}`)
      .set(auth(tech.token))
      .send({ status: "in_progress" });
    expect(progress.status).toBe(200);

    const done = await request(app())
      .patch(`/api/v1/technicians/requests/${id}`)
      .set(auth(tech.token))
      .send({ status: "completed" });
    expect(done.status).toBe(200);

    // Terminal: even cancel is refused after completion.
    await request(app())
      .patch(`/api/v1/technicians/requests/${id}`)
      .set(auth(customer.token))
      .send({ status: "cancelled" })
      .expect(422);
  });

  it("enforces sides with 403 and rejects bad transitions", async () => {
    const { tech, customer, stranger, id } = await makeRequest();
    const url = `/api/v1/technicians/requests/${id}`;

    // Requester cannot accept their own request; technician cannot cancel.
    await request(app()).patch(url).set(auth(customer.token)).send({ status: "accepted" }).expect(403);
    await request(app()).patch(url).set(auth(tech.token)).send({ status: "cancelled" }).expect(403);
    // Strangers see nothing to act on.
    await request(app()).patch(url).set(auth(stranger.token)).send({ status: "cancelled" }).expect(403);
    await request(app()).patch(url).send({ status: "cancelled" }).expect(401);
    // Unknown ids 404; bad statuses 400.
    await request(app())
      .patch(`/api/v1/technicians/requests/${UNKNOWN_ID}`)
      .set(auth(tech.token))
      .send({ status: "accepted" })
      .expect(404);
    await request(app()).patch(url).set(auth(tech.token)).send({ status: "shipped" }).expect(400);

    // Requester cancel works and is terminal.
    await request(app()).patch(url).set(auth(customer.token)).send({ status: "cancelled" }).expect(200);
    await request(app()).patch(url).set(auth(tech.token)).send({ status: "accepted" }).expect(422);

    // Same-status writes are idempotent.
    const again = await request(app())
      .patch(url)
      .set(auth(customer.token))
      .send({ status: "cancelled" });
    expect(again.status).toBe(200);
    expect(again.body.request.status).toBe("cancelled");
  });
});

describe("diagnostic handoffs (consent-scoped sharing)", () => {
  async function makeThread() {
    const tech = await registerUser("tech-hand@example.com");
    const customer = await registerUser("cust-hand@example.com");
    const stranger = await registerUser("stranger-hand@example.com");
    await seedProfile(tech.id);
    const session = await createOwnedSession(customer.token);
    const sharedFile = await uploadEvidence(customer.token, session.id, "shared.png");
    const privateFile = await uploadEvidence(customer.token, session.id, "private.png");
    const contact = await request(app())
      .post(`/api/v1/technicians/${tech.id}/contact`)
      .set(auth(customer.token))
      .send({ message: "Help.", session_id: session.id });
    expect(contact.status).toBe(201);
    return { tech, customer, stranger, session, sharedFile, privateFile, reqId: contact.body.request.id as string };
  }

  it("shares only allowlisted evidence, no report by default", async () => {
    const { tech, customer, session, sharedFile, privateFile, reqId } = await makeThread();
    const create = await request(app())
      .post(`/api/v1/technicians/requests/${reqId}/handoff`)
      .set(auth(customer.token))
      .send({ session_id: session.id, shared_evidence_ids: [sharedFile] });
    expect(create.status).toBe(201);
    expect(handoffResponseSchema.safeParse(create.body).success).toBe(true);
    expect(create.body.handoff.shared_report).toBe(false);

    const read = await request(app())
      .get(`/api/v1/technicians/requests/${reqId}/handoff`)
      .set(auth(tech.token));
    expect(read.status).toBe(200);
    expect(handoffDetailResponseSchema.safeParse(read.body).success).toBe(true);
    expect(read.body.session.id).toBe(session.id);
    expect(read.body.evidence.map((f: { id: string }) => f.id)).toEqual([sharedFile]);
    expect(read.body.evidence.some((f: { id: string }) => f.id === privateFile)).toBe(false);
    expect(read.body.report).toBeNull();
  });

  it("shares the latest report only with explicit consent", async () => {
    const { tech, customer, session, reqId } = await makeThread();
    await new ReportRepository(db).create(
      session.id,
      {
        status: "ready",
        report_data: reportDataSchema.parse({
          device: { device_type: "laptop", manufacturer: null, model: null, operating_system: null },
          symptoms: "Will not power on.",
          evidence_ids: [],
          observable_facts: [],
          hypotheses: [],
          tests_performed: [],
          sources: [],
          remaining_uncertainty: [],
          recommended_next_steps: [],
          safety_summary: [],
        }),
      },
    );

    await request(app())
      .post(`/api/v1/technicians/requests/${reqId}/handoff`)
      .set(auth(customer.token))
      .send({ session_id: session.id, shared_report: true })
      .expect(201);
    const read = await request(app())
      .get(`/api/v1/technicians/requests/${reqId}/handoff`)
      .set(auth(tech.token));
    expect(read.status).toBe(200);
    expect(read.body.report).not.toBeNull();
    expect(read.body.report.session_id).toBe(session.id);
  });

  it("enforces the evidence-id allowlist and reader/writer sides", async () => {
    const { tech, customer, stranger, session, reqId } = await makeThread();
    const otherSession = await createOwnedSession(customer.token, "Cracked screen.");
    const otherFile = await uploadEvidence(customer.token, otherSession.id, "other.png");
    const strangerSession = await createOwnedSession(stranger.token);
    const post = `/api/v1/technicians/requests/${reqId}/handoff`;

    // Evidence from another session is refused, not silently dropped.
    await request(app())
      .post(post)
      .set(auth(customer.token))
      .send({ session_id: session.id, shared_evidence_ids: [otherFile] })
      .expect(422);
    // Unknown file ids are refused too.
    await request(app())
      .post(post)
      .set(auth(customer.token))
      .send({ session_id: session.id, shared_evidence_ids: [UNKNOWN_ID] })
      .expect(422);
    // Only own sessions can be shared.
    await request(app())
      .post(post)
      .set(auth(customer.token))
      .send({ session_id: strangerSession.id })
      .expect(403);
    // Only the requester writes; only the technician reads.
    await request(app()).post(post).set(auth(tech.token)).send({ session_id: session.id }).expect(403);
    await request(app())
      .get(`/api/v1/technicians/requests/${reqId}/handoff`)
      .set(auth(customer.token))
      .expect(403);
    await request(app())
      .get(`/api/v1/technicians/requests/${reqId}/handoff`)
      .set(auth(stranger.token))
      .expect(403);
    // Nothing shared yet.
    await request(app())
      .get(`/api/v1/technicians/requests/${reqId}/handoff`)
      .set(auth(tech.token))
      .expect(404);
  });
});

describe("PUT /api/v1/technicians/me + GET /api/v1/technicians/me (own profile)", () => {
  const profile = {
    display_name: "Sam Rivera",
    city: "Austin",
    region: "TX",
    postal_code: "78701",
    latitude: NEAR_AUSTIN.lat,
    longitude: NEAR_AUSTIN.lng,
    specialties: ["board-repair"],
    device_types: ["laptop"],
    phone: "+1-555-0100",
    contact_email: "sam@example.com",
    whatsapp: "+1-555-0100",
    about: "Board-level repairs.",
    accepting_requests: true,
  };

  it("upserts the own profile and round-trips it with contacts", async () => {
    const tech = await registerUser("tech-me@example.com");
    await request(app()).get("/api/v1/technicians/me").set(auth(tech.token)).expect(404);
    await request(app()).get("/api/v1/technicians/me").expect(401);
    await request(app()).put("/api/v1/technicians/me").send(profile).expect(401);

    const created = await request(app())
      .put("/api/v1/technicians/me")
      .set(auth(tech.token))
      .send(profile);
    expect(created.status).toBe(201);
    expect(technicianResponseSchema.safeParse(created.body).success).toBe(true);
    expect(created.body.technician).toMatchObject({
      user_id: tech.id,
      display_name: "Sam Rivera",
      phone: "+1-555-0100",
      contact_email: "sam@example.com",
      verified: false,
    });

    const read = await request(app()).get("/api/v1/technicians/me").set(auth(tech.token));
    expect(read.status).toBe(200);
    expect(technicianResponseSchema.safeParse(read.body).success).toBe(true);
    expect(read.body.technician).toMatchObject({
      city: "Austin",
      latitude: NEAR_AUSTIN.lat,
      specialties: ["board-repair"],
      whatsapp: "+1-555-0100",
    });

    // Second write updates in place (200) and clears nulled fields.
    const updated = await request(app())
      .put("/api/v1/technicians/me")
      .set(auth(tech.token))
      .send({ ...profile, display_name: "Sam R.", phone: null, latitude: null, longitude: null });
    expect(updated.status).toBe(200);
    expect(updated.body.technician.display_name).toBe("Sam R.");
    expect(updated.body.technician.phone).toBeNull();
    expect(updated.body.technician.latitude).toBeNull();

    // The new profile feeds public discovery (no longer empty).
    const list = await request(app()).get("/api/v1/technicians");
    expect(list.body.technicians.map((t: { display_name: string }) => t.display_name)).toEqual([
      "Sam R.",
    ]);

    // The upsert is audited.
    const logs = await request(app())
      .get("/api/v1/admin/audit-logs?action=technician.profile.upsert")
      .set(auth(adminSession.token));
    expect(logs.status).toBe(200);
    expect(logs.body.total).toBe(2);
  });

  it("enforces the lat/lng pairing rule and required fields", async () => {
    const tech = await registerUser("tech-me-geo@example.com");
    const url = "/api/v1/technicians/me";
    await request(app())
      .put(url)
      .set(auth(tech.token))
      .send({ display_name: "G", city: "Austin", region: "TX", latitude: 30 })
      .expect(400);
    await request(app())
      .put(url)
      .set(auth(tech.token))
      .send({ display_name: "G", city: "Austin", region: "TX", longitude: -97 })
      .expect(400);
    await request(app())
      .put(url)
      .set(auth(tech.token))
      .send({ display_name: "G", city: "Austin", region: "TX", latitude: 91, longitude: 0 })
      .expect(400);
    await request(app())
      .put(url)
      .set(auth(tech.token))
      .send({ city: "Austin", region: "TX" })
      .expect(400);
    await request(app())
      .put(url)
      .set(auth(tech.token))
      .send({ display_name: "  ", city: "Austin", region: "TX" })
      .expect(400);
    // Nothing persisted after the rejected writes.
    await request(app()).get(url).set(auth(tech.token)).expect(404);
  });

  it("keeps verified immutable by the user, admin badge survives rewrites", async () => {
    const tech = await registerUser("tech-me-verified@example.com");
    const created = await request(app())
      .put("/api/v1/technicians/me")
      .set(auth(tech.token))
      .send({ ...profile, verified: true });
    expect(created.status).toBe(201);
    expect(created.body.technician.verified).toBe(false);

    await request(app())
      .patch(`/api/v1/admin/technicians/${tech.id}`)
      .set(auth(adminSession.token))
      .send({ verified: true })
      .expect(200);

    const rewritten = await request(app())
      .put("/api/v1/technicians/me")
      .set(auth(tech.token))
      .send({ ...profile, verified: false, display_name: "Still Verified" });
    expect(rewritten.status).toBe(200);
    expect(rewritten.body.technician.verified).toBe(true);
    expect(rewritten.body.technician.display_name).toBe("Still Verified");
  });

  it("never leaks contacts to other users' reads", async () => {
    const tech = await registerUser("tech-me-private@example.com");
    const other = await registerUser("other-me-private@example.com");
    await request(app())
      .put("/api/v1/technicians/me")
      .set(auth(tech.token))
      .send(profile)
      .expect(201);

    // Public list items carry no contact PII by construction.
    const list = await request(app()).get("/api/v1/technicians");
    expect(list.status).toBe(200);
    expect(list.body.technicians).toHaveLength(1);
    const item = list.body.technicians[0] as Record<string, unknown>;
    expect(item).not.toHaveProperty("phone");
    expect(item).not.toHaveProperty("contact_email");
    expect(item).not.toHaveProperty("whatsapp");

    // Another user's /me is their own (empty), never mine.
    await request(app()).get("/api/v1/technicians/me").set(auth(other.token)).expect(404);
  });
});

describe("PATCH /api/v1/admin/technicians/:userId (verified badge)", () => {
  it("toggles verified for admins only", async () => {
    const tech = await registerUser("tech-verify@example.com");
    const customer = await registerUser("cust-verify@example.com");
    await seedProfile(tech.id);

    const denied = await request(app())
      .patch(`/api/v1/admin/technicians/${tech.id}`)
      .set(auth(customer.token))
      .send({ verified: true });
    expect(denied.status).toBe(403);

    const missing = await request(app())
      .patch(`/api/v1/admin/technicians/${UNKNOWN_ID}`)
      .set(auth(adminSession.token))
      .send({ verified: true });
    expect(missing.status).toBe(404);

    const bad = await request(app())
      .patch(`/api/v1/admin/technicians/${tech.id}`)
      .set(auth(adminSession.token))
      .send({});
    expect(bad.status).toBe(400);

    const ok = await request(app())
      .patch(`/api/v1/admin/technicians/${tech.id}`)
      .set(auth(adminSession.token))
      .send({ verified: true });
    expect(ok.status).toBe(200);
    expect(ok.body.technician).toMatchObject({ user_id: tech.id, verified: true });

    const card = await request(app()).get(`/api/v1/technicians/${tech.id}`);
    expect(card.body.technician.verified).toBe(true);
  });
});
