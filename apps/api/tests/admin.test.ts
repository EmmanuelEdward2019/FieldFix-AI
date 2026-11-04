import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { Kysely } from "kysely";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminDocumentListResponseSchema,
  adminDocumentResponseSchema,
  apiErrorSchema,
  bulkImportResponseSchema,
  ingestionJobDetailResponseSchema,
} from "@fieldfix/contracts";
import { createApp } from "../src/app.js";
import type { AppEnv } from "../src/env.js";
import type { Database } from "../src/db/database.js";
import { createAdminRouter } from "../src/routes/admin.js";
import { IngestionService } from "../src/ingestion/pipeline.js";
import { LocalStorageAdapter } from "../src/storage/local-adapter.js";
import type { StorageAdapter } from "../src/storage/types.js";
import { makePdf } from "./ingestion/pdf-fixture.js";
import { setupTestDb, teardownTestDb, truncateAll } from "./db/setup.js";
import { sessionWithRole } from "./helpers/admin-auth.js";

const FIXTURES = path.join(__dirname, "ingestion", "fixtures");
const ACK = { MYFIXIT_LICENCE_ACK: "CC-BY-NC-SA-3.0", IFIXIT_INGEST_ACK: "CC-BY-NC-SA-3.0" };

const GUIDE_JSON = {
  guideid: 1220,
  title: "AcmeBook Pro 14 Battery Replacement",
  subject: "Battery",
  category: "AcmeBook Pro 14",
  url: "https://www.ifixit.com/Guide/acmebook-battery/1220",
  revisionid: 55,
  steps: [
    { stepid: 1, orderby: 1, title: "Disconnect power", lines: [{ text_raw: "Unplug the AC adapter." }] },
  ],
};

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

describe("admin routes", () => {
  let db: Kysely<Database>;
  let storageDir: string;
  let storage: StorageAdapter;
  let admin: { id: string; token: string };

  /** Full app wiring (default router deps, real process.env acks). */
  function wiredApp(env: AppEnv = TEST_ENV) {
    return createApp(env, { db, storage });
  }

  /** Direct router with injectable fetch/env for connector tests. */
  function adminApp(options: {
    maxUploadBytes?: number;
    fetchFn?: typeof fetch;
    env?: NodeJS.ProcessEnv;
  } = {}) {
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use(
      "/api/v1/admin",
      createAdminRouter({
        db,
        storage,
        maxUploadBytes: options.maxUploadBytes ?? 10 * 1024 * 1024,
        fetchFn: options.fetchFn,
        env: options.env,
      }),
    );
    return app;
  }

  const auth = (req: request.Test) =>
    req.set("Authorization", `Bearer ${admin.token}`);

  beforeAll(async () => {
    db = await setupTestDb();
    storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-admin-"));
    storage = new LocalStorageAdapter(storageDir);
  });

  afterAll(async () => {
    await teardownTestDb(db);
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAll(db);
    admin = await sessionWithRole(wiredApp(), db, "admin@example.com", "admin");
  });

  it("requires admin authentication and reports 503 without a database", async () => {
    const pdf = makePdf([[{ text: "Enough text here to pass the per-page threshold.", size: 11 }]]);
    const noToken = await request(adminApp())
      .post("/api/v1/admin/documents")
      .attach("file", pdf, { filename: "a.pdf", contentType: "application/pdf" });
    expect(noToken.status).toBe(403);

    const wrong = await request(adminApp())
      .post("/api/v1/admin/documents")
      .set("Authorization", "Bearer wrong-token")
      .attach("file", pdf, { filename: "a.pdf", contentType: "application/pdf" });
    expect(wrong.status).toBe(403);
    expect(apiErrorSchema.safeParse(wrong.body).success).toBe(true);

    const noDb = await request(createApp(TEST_ENV, {}))
      .post("/api/v1/admin/documents")
      .set("Authorization", "Bearer [REDACTED]")
      .send({});
    expect(noDb.status).toBe(503);
  });

  it("ingests an uploaded PDF with metadata", async () => {
    const pdf = makePdf([
      [
        { text: "Power Troubleshooting", size: 20 },
        { text: "Verify the AC adapter LED glows steadily on a known-good outlet.", size: 11 },
      ],
    ]);
    const res = await auth(
      request(adminApp())
        .post("/api/v1/admin/documents")
        .attach("file", pdf, { filename: "manual.pdf", contentType: "application/pdf" })
        .field("source", "manufacturer_docs")
        .field(
          "metadata",
          JSON.stringify({
            title: "Acme power notes",
            manufacturer: "Acme",
            document_type: "service_manual",
            source_name: "Acme support",
            permission_status: "approved",
          }),
        ),
    );
    expect(res.status).toBe(201);
    expect(adminDocumentResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.document.title).toBe("Acme power notes");
    expect(res.body.document.source_name).toBe("Acme support");
    expect(res.body.document.ingestion_status).toBe("indexed");
    expect(res.body.document.chunk_count).toBe(1);
    expect(res.body.job.status).toBe("succeeded");
    expect(res.body.duplicate_of).toBeNull();
  });

  it("reports duplicates on re-upload", async () => {
    const body = readFileSync(path.join(FIXTURES, "sample.md"));
    const metadata = JSON.stringify({ title: "Notes", document_type: "other" });
    const first = await auth(
      request(adminApp())
        .post("/api/v1/admin/documents")
        .attach("file", body, { filename: "n.md", contentType: "text/markdown" })
        .field("metadata", metadata),
    );
    expect(first.status).toBe(201);
    const second = await auth(
      request(adminApp())
        .post("/api/v1/admin/documents")
        .attach("file", body, { filename: "n.md", contentType: "text/markdown" })
        .field("metadata", metadata),
    );
    expect(second.status).toBe(200);
    expect(second.body.duplicate_of).toBe(first.body.document.id);
    expect(second.body.document.id).toBe(first.body.document.id);
  });

  it("validates upload input: file, metadata, source, size", async () => {
    const missing = await auth(request(adminApp()).post("/api/v1/admin/documents"));
    expect(missing.status).toBe(400);

    const badMeta = await auth(
      request(adminApp())
        .post("/api/v1/admin/documents")
        .attach("file", Buffer.from("# hi\n\nbody"), {
          filename: "n.md",
          contentType: "text/markdown",
        })
        .field("metadata", "{not json"),
    );
    expect(badMeta.status).toBe(400);

    const badSource = await auth(
      request(adminApp())
        .post("/api/v1/admin/documents")
        .attach("file", Buffer.from("# hi\n\nbody"), {
          filename: "n.md",
          contentType: "text/markdown",
        })
        .field("source", "random-blog"),
    );
    expect(badSource.status).toBe(400);

    const tiny = await auth(
      request(adminApp({ maxUploadBytes: 16 }))
        .post("/api/v1/admin/documents")
        .attach("file", Buffer.alloc(64, 7), {
          filename: "n.md",
          contentType: "text/markdown",
        }),
    );
    expect(tiny.status).toBe(413);
  });

  it("maps ingest failures to honest statuses with job reports", async () => {
    const png = await auth(
      request(adminApp())
        .post("/api/v1/admin/documents")
        .attach("file", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
          filename: "x.png",
          contentType: "image/png",
        })
        .field("metadata", JSON.stringify({ title: "x", document_type: "other" })),
    );
    expect(png.status).toBe(415);
    expect(adminDocumentResponseSchema.safeParse(png.body).success).toBe(true);
    expect(png.body.document).toBeNull();
    expect(png.body.job.status).toBe("failed");

    const rejected = await auth(
      request(adminApp())
        .post("/api/v1/admin/documents")
        .attach("file", Buffer.from("# hi\n\nbody"), {
          filename: "n.md",
          contentType: "text/markdown",
        })
        .field(
          "metadata",
          JSON.stringify({ title: "x", document_type: "other", permission_status: "rejected" }),
        ),
    );
    expect(rejected.status).toBe(403);

    const corrupt = await auth(
      request(adminApp())
        .post("/api/v1/admin/documents")
        .attach("file", Buffer.from("%PDF-1.4\nnot a real body"), {
          filename: "bad.pdf",
          contentType: "application/pdf",
        })
        .field("metadata", JSON.stringify({ title: "bad", document_type: "other" })),
    );
    expect(corrupt.status).toBe(422);
    expect(corrupt.body.document.ingestion_status).toBe("failed");
    expect(corrupt.body.document.ingestion_error).toContain("PDF");
  });

  it("registers MyFixit files through the connector", async () => {
    const gated = await auth(
      request(adminApp({ env: {} }))
        .post("/api/v1/admin/documents")
        .send({ connector: "myfixit_dataset", ref: path.join(FIXTURES, "sample-myfixit.json") }),
    );
    expect(gated.status).toBe(403);

    const res = await auth(
      request(adminApp({ env: { ...ACK } }))
        .post("/api/v1/admin/documents")
        .send({ connector: "myfixit_dataset", ref: path.join(FIXTURES, "sample-myfixit.json") }),
    );
    expect(res.status).toBe(201);
    expect(bulkImportResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.records_seen).toBe(2);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.every((i: { status: string }) => i.status === "indexed")).toBe(true);

    const badRef = await auth(
      request(adminApp({ env: { ...ACK } }))
        .post("/api/v1/admin/documents")
        .send({ connector: "myfixit_dataset", ref: path.join(FIXTURES, "missing.json") }),
    );
    expect(badRef.status).toBe(404);

    const badBody = await auth(
      request(adminApp({ env: { ...ACK } }))
        .post("/api/v1/admin/documents")
        .send({ connector: "myfixit_dataset" }),
    );
    expect(badBody.status).toBe(400);
  });

  it("registers a single iFixit guide with mocked fetch", async () => {
    const fetchFn = (async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://www.ifixit.com/api/2.0/guides/1220");
      return new Response(JSON.stringify(GUIDE_JSON), { status: 200 });
    }) as typeof fetch;
    const res = await auth(
      request(adminApp({ env: { ...ACK }, fetchFn }))
        .post("/api/v1/admin/documents")
        .send({ connector: "ifixit_api", ref: "1220" }),
    );
    expect(res.status).toBe(201);
    expect(adminDocumentResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.document.source_name).toBe("iFixit API");
    expect(res.body.document.chunk_count).toBe(1);

    const badRef = await auth(
      request(adminApp({ env: { ...ACK }, fetchFn }))
        .post("/api/v1/admin/documents")
        .send({ connector: "ifixit_api", ref: "not-a-number" }),
    );
    expect(badRef.status).toBe(400);

    const missing = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    const gone = await auth(
      request(adminApp({ env: { ...ACK }, fetchFn: missing }))
        .post("/api/v1/admin/documents")
        .send({ connector: "ifixit_api", ref: "999999" }),
    );
    expect(gone.status).toBe(404);
  });

  it("returns 500 instead of crashing when reingest fails", async () => {
    const created = await auth(
      request(adminApp())
        .post("/api/v1/admin/documents")
        .attach("file", readFileSync(path.join(FIXTURES, "sample.csv")), {
          filename: "s.csv",
          contentType: "text/csv",
        })
        .field("metadata", JSON.stringify({ title: "csv", document_type: "other" })),
    );
    expect(created.status).toBe(201);
    const documentId = created.body.document.id as string;
    const spy = vi
      .spyOn(IngestionService.prototype, "reingestDocument")
      .mockRejectedValueOnce(new Error("simulated pipeline failure"));
    try {
      const res = await auth(
        request(adminApp()).post("/api/v1/admin/ingestion-jobs").send({ document_id: documentId }),
      );
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("internal_error");
    } finally {
      spy.mockRestore();
    }
  });

  it("retries ingestion jobs and reports their status", async () => {
    const created = await auth(
      request(adminApp())
        .post("/api/v1/admin/documents")
        .attach("file", readFileSync(path.join(FIXTURES, "sample.csv")), {
          filename: "s.csv",
          contentType: "text/csv",
        })
        .field("metadata", JSON.stringify({ title: "csv", document_type: "other" })),
    );
    expect(created.status).toBe(201);
    const documentId = created.body.document.id as string;
    const firstJobId = created.body.job.id as string;

    const retry = await auth(
      request(adminApp()).post("/api/v1/admin/ingestion-jobs").send({ document_id: documentId }),
    );
    expect(retry.status).toBe(201);
    expect(retry.body.job.id).not.toBe(firstJobId);
    expect(retry.body.job.status).toBe("succeeded");

    const detail = await auth(
      request(adminApp()).get(`/api/v1/admin/ingestion-jobs/${retry.body.job.id}`),
    );
    expect(detail.status).toBe(200);
    expect(ingestionJobDetailResponseSchema.safeParse(detail.body).success).toBe(true);
    expect(detail.body.job.document_id).toBe(documentId);
    expect(detail.body.document.chunk_count).toBe(2);

    const unknownDoc = await auth(
      request(adminApp())
        .post("/api/v1/admin/ingestion-jobs")
        .send({ document_id: "12345678-1234-4123-8123-123456789012" }),
    );
    expect(unknownDoc.status).toBe(404);

    const badBody = await auth(
      request(adminApp()).post("/api/v1/admin/ingestion-jobs").send({ document_id: "nope" }),
    );
    expect(badBody.status).toBe(400);

    const unknownJob = await auth(
      request(adminApp()).get("/api/v1/admin/ingestion-jobs/12345678-1234-4123-8123-123456789012"),
    );
    expect(unknownJob.status).toBe(404);

    const malformed = await auth(request(adminApp()).get("/api/v1/admin/ingestion-jobs/nope"));
    expect(malformed.status).toBe(404);
  });

  it("lists ingested documents newest-first behind the admin token", async () => {
    const anon = await request(adminApp()).get("/api/v1/admin/documents");
    expect(anon.status).toBe(403);

    const empty = await auth(request(adminApp()).get("/api/v1/admin/documents"));
    expect(empty.status).toBe(200);
    expect(empty.body.documents).toEqual([]);

    for (const title of ["first doc", "second doc"]) {
      const created = await auth(
        request(adminApp())
          .post("/api/v1/admin/documents")
          .attach("file", Buffer.from(`# ${title}\n\nbody text`), {
            filename: "n.md",
            contentType: "text/markdown",
          })
          .field("metadata", JSON.stringify({ title, document_type: "other" })),
      );
      expect(created.status).toBe(201);
    }

    const list = await auth(request(adminApp()).get("/api/v1/admin/documents"));
    expect(list.status).toBe(200);
    expect(adminDocumentListResponseSchema.safeParse(list.body).success).toBe(true);
    expect(list.body.documents.map((d: { title: string }) => d.title)).toEqual([
      "second doc",
      "first doc",
    ]);
  });

  it("serves admin and knowledge routes through the wired app", async () => {
    const res = await request(wiredApp())
      .post("/api/v1/admin/documents")
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("file", Buffer.from("# hi\n\nwired body"), {
        filename: "n.md",
        contentType: "text/markdown",
      })
      .field("metadata", JSON.stringify({ title: "wired", document_type: "other" }));
    expect(res.status).toBe(201);

    const search = await request(wiredApp()).post("/api/v1/knowledge/search").send({
      query: "wired body",
    });
    // The uploaded doc is pending, so retrieval stays empty by design.
    expect(search.status).toBe(200);
    expect(search.body.hits).toEqual([]);
  });
});
