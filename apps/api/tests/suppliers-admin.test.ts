import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Kysely } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Database, Supplier } from "../src/db/database.js";
import { SuppliersRepository } from "../src/db/repositories/suppliers.js";
import type { AppEnv } from "../src/env.js";
import { LocalStorageAdapter } from "../src/storage/local-adapter.js";
import type { StorageAdapter } from "../src/storage/types.js";
import { clearTestEmailOutbox } from "../src/email/resend.js";
import { setupTestDb, teardownTestDb, truncateAll } from "./db/setup.js";
import { adminBearer, sessionWithRole } from "./helpers/admin-auth.js";

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
let admin: { id: string; token: string };
let operator: { id: string; token: string };
let technician: { id: string; token: string };

function app() {
  return createApp(TEST_ENV, { db, storage });
}

function clearOutbox(): void {
  clearTestEmailOutbox();
}

async function makeSupplier(feedType: Supplier["feed_type"] = "manual"): Promise<Supplier> {
  return new SuppliersRepository(db).create({
    name: `${feedType} store`,
    website_url: "https://store.example",
    feed_type: feedType,
    feed_base_url: feedType === "woocommerce_store" ? "https://store.example" : null,
    search_url_template: null,
    sync_enabled: feedType === "woocommerce_store",
  });
}

beforeAll(async () => {
  db = await setupTestDb();
  storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-suppliers-"));
  storage = new LocalStorageAdapter(storageDir);
});

afterAll(async () => {
  await teardownTestDb(db);
  await rm(storageDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await truncateAll(db);
  clearOutbox();
  admin = await sessionWithRole(app(), db, "suppliers-admin@example.com", "admin");
  operator = await sessionWithRole(app(), db, "suppliers-operator@example.com", "operator");
  technician = await sessionWithRole(app(), db, "suppliers-tech@example.com", "technician");
});

describe("suppliers admin", () => {
  it("denies anonymous callers and plain technicians", async () => {
    const anon = await request(app()).get("/api/v1/admin/suppliers");
    expect(anon.status).toBe(403);
    const tech = await request(app())
      .get("/api/v1/admin/suppliers")
      .set(adminBearer(technician.token));
    expect(tech.status).toBe(403);
  });

  it("lets operators view but not manage", async () => {
    await makeSupplier();
    const list = await request(app())
      .get("/api/v1/admin/suppliers")
      .set(adminBearer(operator.token));
    expect(list.status).toBe(200);
    expect(list.body.suppliers).toHaveLength(1);
    expect(list.body.suppliers[0]).toMatchObject({ name: "manual store", product_count: 0 });

    const denied = await request(app())
      .post("/api/v1/admin/suppliers")
      .set(adminBearer(operator.token))
      .send({ name: "x", website_url: "https://x.example", feed_type: "link_only" });
    expect(denied.status).toBe(403);
  });

  it("creates, updates, and deletes suppliers", async () => {
    const created = await request(app())
      .post("/api/v1/admin/suppliers")
      .set(adminBearer(admin.token))
      .send({
        name: "New Store",
        website_url: "https://new.example",
        feed_type: "manual",
      });
    expect(created.status).toBe(201);
    const id = created.body.supplier.id as string;

    const bad = await request(app())
      .post("/api/v1/admin/suppliers")
      .set(adminBearer(admin.token))
      .send({ name: "Live Store", website_url: "https://live.example", feed_type: "woocommerce_store" });
    expect(bad.status).toBe(400);

    const badTemplate = await request(app())
      .post("/api/v1/admin/suppliers")
      .set(adminBearer(admin.token))
      .send({
        name: "Bad Template",
        website_url: "https://bad.example",
        feed_type: "link_only",
        search_url_template: "https://bad.example/search",
      });
    expect(badTemplate.status).toBe(400);

    const updated = await request(app())
      .patch(`/api/v1/admin/suppliers/${id}`)
      .set(adminBearer(admin.token))
      .send({ name: "Renamed Store", sync_enabled: false });
    expect(updated.status).toBe(200);
    expect(updated.body.supplier).toMatchObject({ name: "Renamed Store", sync_enabled: false });

    const missing = await request(app())
      .patch(`/api/v1/admin/suppliers/${UNKNOWN_ID}`)
      .set(adminBearer(admin.token))
      .send({ name: "x" });
    expect(missing.status).toBe(404);

    const deleted = await request(app())
      .delete(`/api/v1/admin/suppliers/${id}`)
      .set(adminBearer(admin.token));
    expect(deleted.status).toBe(200);
    const gone = await request(app())
      .delete(`/api/v1/admin/suppliers/${id}`)
      .set(adminBearer(admin.token));
    expect(gone.status).toBe(404);
  });

  it("refuses syncs that cannot run without touching the network", async () => {
    const manual = await makeSupplier("manual");
    const unsupported = await request(app())
      .post(`/api/v1/admin/suppliers/${manual.id}/sync`)
      .set(adminBearer(admin.token));
    expect(unsupported.status).toBe(422);

    const missing = await request(app())
      .post(`/api/v1/admin/suppliers/${UNKNOWN_ID}/sync`)
      .set(adminBearer(admin.token));
    expect(missing.status).toBe(404);
  });

  it("manages manual listings end to end", async () => {
    const manual = await makeSupplier("manual");
    const created = await request(app())
      .post(`/api/v1/admin/suppliers/${manual.id}/products`)
      .set(adminBearer(admin.token))
      .send({
        name: "Laptop Battery 56Wh",
        part_number: "BAT-56",
        price_cents: 4500000,
        currency: "NGN",
        stock_status: "in_stock",
        product_url: "https://store.example/battery",
      });
    expect(created.status).toBe(201);
    const productId = created.body.product.id as string;

    const list = await request(app())
      .get(`/api/v1/admin/suppliers/${manual.id}/products?q=battery`)
      .set(adminBearer(operator.token));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);

    const updated = await request(app())
      .patch(`/api/v1/admin/suppliers/${manual.id}/products/${productId}`)
      .set(adminBearer(admin.token))
      .send({ stock_status: "out_of_stock" });
    expect(updated.status).toBe(200);
    expect(updated.body.product.stock_status).toBe("out_of_stock");

    const deleted = await request(app())
      .delete(`/api/v1/admin/suppliers/${manual.id}/products/${productId}`)
      .set(adminBearer(admin.token));
    expect(deleted.status).toBe(200);
    const empty = await request(app())
      .get(`/api/v1/admin/suppliers/${manual.id}/products`)
      .set(adminBearer(operator.token));
    expect(empty.body.total).toBe(0);
  });

  it("rejects manual listings for live-feed suppliers", async () => {
    const live = await makeSupplier("woocommerce_store");
    const res = await request(app())
      .post(`/api/v1/admin/suppliers/${live.id}/products`)
      .set(adminBearer(admin.token))
      .send({ name: "x", product_url: "https://store.example/x" });
    expect(res.status).toBe(422);
  });

  it("scopes products to their supplier", async () => {
    const first = await makeSupplier("manual");
    const second = await makeSupplier("manual");
    const product = await new SuppliersRepository(db).createManualProduct(
      first.id,
      "manual-test-1",
      {
        name: "Charger",
        part_number: null,
        price_cents: null,
        currency: null,
        stock_status: "unknown",
        product_url: "https://store.example/charger",
        image_url: null,
      },
    );
    const cross = await request(app())
      .patch(`/api/v1/admin/suppliers/${second.id}/products/${product.id}`)
      .set(adminBearer(admin.token))
      .send({ stock_status: "in_stock" });
    expect(cross.status).toBe(404);
  });
});
