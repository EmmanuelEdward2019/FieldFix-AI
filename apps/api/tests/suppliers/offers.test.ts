import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Kysely } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createHypothesisSchema,
  createSessionResponseSchema,
  partOffersResponseSchema,
} from "@fieldfix/contracts";
import { createApp } from "../../src/app.js";
import type { Database } from "../../src/db/database.js";
import { HypothesisRepository } from "../../src/db/repositories/hypotheses.js";
import { SuppliersRepository } from "../../src/db/repositories/suppliers.js";
import type { AppEnv } from "../../src/env.js";
import { LocalStorageAdapter } from "../../src/storage/local-adapter.js";
import type { StorageAdapter } from "../../src/storage/types.js";
import { setupTestDb, teardownTestDb, truncateAll } from "../db/setup.js";

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

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  db = await setupTestDb();
  storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-offers-"));
  storage = new LocalStorageAdapter(storageDir);
});

afterAll(async () => {
  await teardownTestDb(db);
  await rm(storageDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await truncateAll(db);
});

async function createSession() {
  const res = await request(app()).post("/api/v1/sessions").send({
    device_type: "laptop",
    symptoms: "Will not power on.",
    user_mode: "everyday",
  });
  expect(res.status).toBe(201);
  const parsed = createSessionResponseSchema.safeParse(res.body);
  expect(parsed.success).toBe(true);
  if (!parsed.success) {
    throw new Error("create session response failed contract validation");
  }
  return parsed.data;
}

async function createPart(
  sessionId: string,
  token: string,
  partName: string,
  partNumber?: string,
): Promise<string> {
  const hypothesis = await new HypothesisRepository(db).create(
    sessionId,
    createHypothesisSchema.parse({ title: "Dead adapter", confidence_label: "medium" }),
  );
  const res = await request(app())
    .post(`/api/v1/sessions/${sessionId}/parts/recommendations`)
    .set(auth(token))
    .send({
      hypothesis_id: hypothesis.id,
      part_name: partName,
      ...(partNumber ? { part_number: partNumber } : {}),
    });
  expect(res.status).toBe(201);
  return res.body.recommendation.id as string;
}

async function seedStore() {
  const repo = new SuppliersRepository(db);
  const live = await repo.create({
    name: "Live Store",
    website_url: "https://live.example",
    feed_type: "woocommerce_store",
    feed_base_url: "https://live.example",
    search_url_template: null,
    sync_enabled: true,
  });
  await repo.upsertFeedProduct({
    supplier_id: live.id,
    external_id: "101",
    name: "HP Laptop Charger 65W Power Adapter",
    part_number: "HP-65W",
    price_cents: 1200000,
    currency: "NGN",
    stock_status: "in_stock",
    product_url: "https://live.example/charger",
    image_url: null,
    last_seen_at: new Date(),
  });
  const manual = await repo.create({
    name: "Manual Store",
    website_url: "https://manual.example",
    feed_type: "manual",
    feed_base_url: null,
    search_url_template: null,
    sync_enabled: false,
  });
  await repo.createManualProduct(manual.id, "manual-1", {
    name: "Generic Laptop Battery 56Wh",
    part_number: "BAT-56",
    price_cents: 4500000,
    currency: "NGN",
    stock_status: "unknown",
    product_url: "https://manual.example/battery",
    image_url: null,
  });
  await repo.create({
    name: "Link Store",
    website_url: "https://link.example/shop",
    feed_type: "link_only",
    feed_base_url: null,
    search_url_template: "https://link.example/catalog/?q={q}",
    sync_enabled: false,
  });
}

describe("part offers", () => {
  it("matches by part number first and validates the contract", async () => {
    await seedStore();
    const session = await createSession();
    const recId = await createPart(session.session.id, session.accessToken, "AC adapter", "hp 65w");
    const res = await request(app())
      .get(`/api/v1/sessions/${session.session.id}/parts/recommendations/${recId}/offers`)
      .set(auth(session.accessToken));
    expect(res.status).toBe(200);
    const parsed = partOffersResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error("offers response failed contract validation");
    }
    expect(parsed.data.offers).toHaveLength(1);
    expect(parsed.data.offers[0]).toMatchObject({
      supplier_name: "Live Store",
      match_kind: "part_number",
      score: 1,
    });
    expect(parsed.data.offers[0]?.product.price_cents).toBe(1200000);
  });

  it("falls back to keyword matching and ranks by score", async () => {
    await seedStore();
    const session = await createSession();
    const recId = await createPart(session.session.id, session.accessToken, "Laptop battery");
    const res = await request(app())
      .get(`/api/v1/sessions/${session.session.id}/parts/recommendations/${recId}/offers`)
      .set(auth(session.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.offers).toHaveLength(2);
    expect(res.body.offers[0]).toMatchObject({
      supplier_name: "Manual Store",
      match_kind: "keywords",
      score: 1,
    });
    expect(res.body.offers[1]).toMatchObject({
      supplier_name: "Live Store",
      match_kind: "keywords",
      score: 0.5,
    });
  });

  it("always returns outbound links, templated where configured", async () => {
    await seedStore();
    const session = await createSession();
    const recId = await createPart(session.session.id, session.accessToken, "Unobtanium widget");
    const res = await request(app())
      .get(`/api/v1/sessions/${session.session.id}/parts/recommendations/${recId}/offers`)
      .set(auth(session.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.offers).toHaveLength(0);
    const links = res.body.outbound_links as Array<{
      supplier_name: string;
      search_url: string;
      has_live_prices: boolean;
    }>;
    expect(links).toHaveLength(3);
    const linkStore = links.find((l) => l.supplier_name === "Link Store");
    expect(linkStore?.search_url).toBe("https://link.example/catalog/?q=Unobtanium%20widget");
    expect(linkStore?.has_live_prices).toBe(false);
    const liveStore = links.find((l) => l.supplier_name === "Live Store");
    expect(liveStore?.has_live_prices).toBe(true);
  });

  it("404s for unknown recommendations and enforces session access", async () => {
    await seedStore();
    const session = await createSession();
    const missing = await request(app())
      .get(`/api/v1/sessions/${session.session.id}/parts/recommendations/${UNKNOWN_ID}/offers`)
      .set(auth(session.accessToken));
    expect(missing.status).toBe(404);

    const other = await createSession();
    const recId = await createPart(other.session.id, other.accessToken, "AC adapter");
    const stranger = await request(app())
      .get(`/api/v1/sessions/${other.session.id}/parts/recommendations/${recId}/offers`)
      .set(auth(session.accessToken));
    expect(stranger.status).toBe(403);
  });
});
