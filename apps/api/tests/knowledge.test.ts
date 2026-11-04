import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { Kysely } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminUploadMetadataSchema,
  apiErrorSchema,
  knowledgeSearchResponseSchema,
} from "@fieldfix/contracts";
import { createApp } from "../src/app.js";
import type { AppEnv } from "../src/env.js";
import type { Database } from "../src/db/database.js";
import { LocalStorageAdapter } from "../src/storage/local-adapter.js";
import type { StorageAdapter } from "../src/storage/types.js";
import { IngestionService } from "../src/ingestion/pipeline.js";
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

describe("POST /api/v1/knowledge/search", () => {
  let db: Kysely<Database>;
  let storageDir: string;
  let storage: StorageAdapter;

  function app() {
    return createApp(TEST_ENV, { db, storage });
  }

  async function ingest(
    fixture: string,
    mediaType: string,
    overrides: Record<string, unknown>,
  ): Promise<void> {
    const pipeline = new IngestionService({ db, storage, env: {} });
    const outcome = await pipeline.ingestFile({
      bytes: readFileSync(path.join(__dirname, "ingestion", "fixtures", fixture)),
      mediaType,
      metadata: adminUploadMetadataSchema.parse({
        title: fixture,
        document_type: "service_manual",
        ...overrides,
      }),
      sourceId: "admin_upload",
    });
    if (outcome.status !== "indexed") {
      throw new Error(`fixture ingest failed: ${fixture}`);
    }
  }

  beforeAll(async () => {
    db = await setupTestDb();
    storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-knowledge-"));
    storage = new LocalStorageAdapter(storageDir);
  });

  afterAll(async () => {
    await teardownTestDb(db);
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAll(db);
    await ingest("sample-generic.json", "application/json", {
      title: "Approved manual",
      manufacturer: "Acme",
      model_numbers: ["AcmeBook Pro 14"],
      permission_status: "approved",
    });
    await ingest("sample.md", "text/markdown", {
      title: "Pending manual",
      manufacturer: "Acme",
      permission_status: "pending",
    });
  });

  it("returns contract-valid hits with real excerpts and references", async () => {
    const res = await request(app()).post("/api/v1/knowledge/search").send({
      query: "adapter LED",
    });
    expect(res.status).toBe(200);
    const parsed = knowledgeSearchResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    expect(res.body.hits).toHaveLength(1);
    expect(res.body.hits[0]).toMatchObject({
      document_title: "Approved manual",
      page_number: 4,
      heading: "No power",
    });
    expect(res.body.hits[0].excerpt).toContain("adapter");
    expect(typeof res.body.hits[0].rank).toBe("number");
  });

  it("applies manufacturer and model filters", async () => {
    const manufacturer = await request(app()).post("/api/v1/knowledge/search").send({
      query: "adapter LED",
      manufacturer: "Other",
    });
    expect(manufacturer.status).toBe(200);
    expect(manufacturer.body.hits).toHaveLength(0);

    const model = await request(app()).post("/api/v1/knowledge/search").send({
      query: "adapter LED",
      model: "Acme Phone 12",
    });
    expect(model.status).toBe(200);
    expect(model.body.hits).toHaveLength(0);

    const match = await request(app()).post("/api/v1/knowledge/search").send({
      query: "adapter LED",
      manufacturer: "Acme",
      model: "AcmeBook Pro 14",
    });
    expect(match.body.hits).toHaveLength(1);
  });

  it("never serves pending documents", async () => {
    // "Swollen battery" exists in both fixtures; only approved is served.
    const res = await request(app()).post("/api/v1/knowledge/search").send({
      query: "swollen battery",
    });
    expect(res.status).toBe(200);
    expect(res.body.hits).toHaveLength(1);
    expect(res.body.hits[0].document_title).toBe("Approved manual");
  });

  it("returns empty hits without matches and 400 without a query", async () => {
    const empty = await request(app()).post("/api/v1/knowledge/search").send({
      query: "quantum flux capacitor alignment",
    });
    expect(empty.status).toBe(200);
    expect(empty.body.hits).toEqual([]);

    for (const body of [{}, { query: "" }, { query: 42 }]) {
      const res = await request(app()).post("/api/v1/knowledge/search").send(body);
      expect(res.status).toBe(400);
      expect(apiErrorSchema.safeParse(res.body).success).toBe(true);
    }
  });
});
