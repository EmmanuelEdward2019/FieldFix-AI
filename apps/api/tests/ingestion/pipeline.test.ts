import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminUploadMetadataSchema,
  type AdminUploadMetadata,
} from "@fieldfix/contracts";
import type { Database } from "../../src/db/database.js";
import {
  ChunkRepository,
  searchChunks,
} from "../../src/db/repositories/documents.js";
import { IngestionJobRepository } from "../../src/db/repositories/ingestion-jobs.js";
import { LocalStorageAdapter } from "../../src/storage/local-adapter.js";
import type { StorageAdapter } from "../../src/storage/types.js";
import { FakeOcrService } from "../../src/ingestion/ocr.js";
import { IngestionService } from "../../src/ingestion/pipeline.js";
import { makePdf, makeBlankPagePdf } from "./pdf-fixture.js";
import { setupTestDb, teardownTestDb, truncateAll } from "../db/setup.js";

const FIXTURES = path.join(__dirname, "fixtures");
const load = (name: string): Buffer => readFileSync(path.join(FIXTURES, name));

function metadata(overrides: Partial<AdminUploadMetadata> = {}): AdminUploadMetadata {
  return adminUploadMetadataSchema.parse({
    title: "Test manual",
    document_type: "service_manual",
    ...overrides,
  });
}

describe("IngestionService (real DB + storage)", () => {
  let db: Kysely<Database>;
  let storageDir: string;
  let storage: StorageAdapter;
  let pipeline: IngestionService;

  beforeAll(async () => {
    db = await setupTestDb();
    storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-ingest-"));
    storage = new LocalStorageAdapter(storageDir);
    pipeline = new IngestionService({ db, storage, env: {} });
  });

  afterAll(async () => {
    await teardownTestDb(db);
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  it("ingests markdown, preserving headings and metadata", async () => {
    const bytes = load("sample.md");
    const outcome = await pipeline.ingestFile({
      bytes,
      mediaType: "text/markdown",
      filename: "sample.md",
      metadata: metadata({
        title: "Acme Field Notes",
        manufacturer: "Acme",
        model_numbers: ["AcmeBook Pro 14"],
        version: "rev-3",
        licence_name: "Test licence",
        permission_status: "approved",
      }),
      sourceId: "admin_upload",
    });
    expect(outcome.status).toBe("indexed");
    if (outcome.status !== "indexed") {
      throw new Error("expected indexed");
    }
    expect(outcome.format).toBe("text");
    expect(outcome.document.ingestion_status).toBe("indexed");
    expect(outcome.document.checksum_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.document.licence_name).toBe("Test licence");
    expect(outcome.chunks.map((c) => c.heading)).toEqual([
      "Acme Field Troubleshooting Notes",
      "No power",
      "Swollen battery",
    ]);
    expect(outcome.chunks[1]?.model_applicability).toEqual(["AcmeBook Pro 14"]);
    expect(outcome.chunks[2]?.safety_tags).toContain("battery");

    // Bytes retained privately under the storage key.
    const retained = await storage.get(outcome.document.storage_key as string);
    expect(retained.equals(bytes)).toBe(true);

    const jobs = new IngestionJobRepository(db);
    const job = await jobs.getById(outcome.jobId);
    expect(job?.status).toBe("succeeded");
    expect(job?.chunks_created).toBe(3);
    expect(job?.detail?.format).toBe("text");
  });

  it("ingests generic JSON, CSV, and PDF with pages", async () => {
    const json = await pipeline.ingestFile({
      bytes: load("sample-generic.json"),
      mediaType: "application/json",
      metadata: metadata({ title: "Generic JSON" }),
      sourceId: "admin_upload",
    });
    expect(json.status).toBe("indexed");
    if (json.status !== "indexed") {
      throw new Error("expected indexed");
    }
    expect(json.chunks.map((c) => c.page_number)).toEqual([4, 9]);

    const csv = await pipeline.ingestFile({
      bytes: load("sample.csv"),
      mediaType: "text/csv",
      metadata: metadata({ title: "CSV rows" }),
      sourceId: "admin_upload",
    });
    expect(csv.status).toBe("indexed");
    if (csv.status !== "indexed") {
      throw new Error("expected indexed");
    }
    expect(csv.chunks).toHaveLength(2);
    expect(csv.warnings).toEqual(["1 empty row(s) skipped."]);

    const pdf = await pipeline.ingestFile({
      bytes: makePdf([
        [
          { text: "Power Troubleshooting", size: 20 },
          { text: "Verify the AC adapter LED glows steadily on a known-good outlet.", size: 11 },
        ],
        [
          { text: "Battery Safety", size: 20 },
          { text: "If the battery is deformed or unusually hot, stop immediately.", size: 11 },
        ],
      ]),
      mediaType: "application/pdf",
      metadata: metadata({ title: "PDF manual" }),
      sourceId: "manufacturer_docs",
      sourceName: "Acme support site",
    });
    expect(pdf.status).toBe("indexed");
    if (pdf.status !== "indexed") {
      throw new Error("expected indexed");
    }
    expect(pdf.format).toBe("pdf");
    expect(pdf.chunks.map((c) => [c.heading, c.page_number])).toEqual([
      ["Power Troubleshooting", 1],
      ["Battery Safety", 2],
    ]);
    expect(pdf.document.source_name).toBe("Acme support site");
  });

  it("detects duplicates by checksum without storing new chunks", async () => {
    const input = {
      bytes: load("sample.md"),
      mediaType: "text/markdown",
      metadata: metadata({ title: "Original" }),
      sourceId: "admin_upload" as const,
    };
    const first = await pipeline.ingestFile(input);
    expect(first.status).toBe("indexed");
    if (first.status !== "indexed") {
      throw new Error("expected indexed");
    }
    const second = await pipeline.ingestFile({
      ...input,
      metadata: metadata({ title: "Same bytes, different title" }),
    });
    expect(second.status).toBe("duplicate");
    if (second.status !== "duplicate") {
      throw new Error("expected duplicate");
    }
    expect(second.duplicateOf).toBe(first.document.id);
    expect(second.document.id).toBe(first.document.id);

    const jobs = new IngestionJobRepository(db);
    const job = await jobs.getById(second.jobId);
    expect(job?.status).toBe("succeeded");
    expect(job?.detail?.duplicate_of).toBe(first.document.id);

    const chunks = new ChunkRepository(db);
    expect(await chunks.listByDocument(first.document.id)).toHaveLength(3);
  });

  it("refuses documents with rejected permission", async () => {
    const outcome = await pipeline.ingestFile({
      bytes: load("sample.md"),
      mediaType: "text/markdown",
      metadata: metadata({ permission_status: "rejected" }),
      sourceId: "admin_upload",
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") {
      throw new Error("expected failed");
    }
    expect(outcome.code).toBe("permission_rejected");
    expect(outcome.document).toBeNull();
    const jobs = new IngestionJobRepository(db);
    expect((await jobs.getById(outcome.jobId))?.status).toBe("failed");
  });

  it("records parse failures on the document and the job", async () => {
    const badPdf = await pipeline.ingestFile({
      bytes: Buffer.from("%PDF-1.4\nthis is not a real pdf body"),
      mediaType: "application/pdf",
      metadata: metadata({ title: "Corrupt PDF" }),
      sourceId: "admin_upload",
    });
    expect(badPdf.status).toBe("failed");
    if (badPdf.status !== "failed") {
      throw new Error("expected failed");
    }
    expect(badPdf.code).toBe("parse_failed");
    expect(badPdf.document?.ingestion_status).toBe("failed");
    expect(badPdf.document?.ingestion_error).toContain("PDF");

    const badJson = await pipeline.ingestFile({
      bytes: Buffer.from('{"Title": "x", "Steps": "not-an-array"}'),
      mediaType: "application/json",
      metadata: metadata({ title: "Bad JSON" }),
      sourceId: "admin_upload",
    });
    expect(badJson.status).toBe("failed");
    if (badJson.status !== "failed") {
      throw new Error("expected failed");
    }
    expect(badJson.document?.ingestion_status).toBe("failed");

    const jobs = new IngestionJobRepository(db);
    expect((await jobs.getById(badPdf.jobId))?.status).toBe("failed");
    expect((await jobs.getById(badPdf.jobId))?.error).toContain("PDF");
  });

  it("rejects undeclared media types and content mismatches", async () => {
    const png = await pipeline.ingestFile({
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      mediaType: "image/png",
      metadata: metadata(),
      sourceId: "admin_upload",
    });
    expect(png.status).toBe("failed");
    if (png.status !== "failed") {
      throw new Error("expected failed");
    }
    expect(png.code).toBe("unsupported_format");
    expect(png.document).toBeNull();

    const renamed = await pipeline.ingestFile({
      bytes: Buffer.from("just text, not a pdf"),
      mediaType: "application/pdf",
      metadata: metadata(),
      sourceId: "admin_upload",
    });
    expect(renamed.status).toBe("failed");
    if (renamed.status !== "failed") {
      throw new Error("expected failed");
    }
    expect(renamed.code).toBe("unsupported_format");
  });

  it("records pages needing OCR and fills them when OCR is available", async () => {
    const mixed = makePdf([
      [{ text: "Text layer with enough characters to pass the threshold here.", size: 11 }],
      [],
    ]);
    // Default pipeline OCR (tesseract CLI) is unavailable in this
    // environment: the text page still indexes, the blank page is
    // reported, and nothing is silently invented.
    const withoutOcr = await pipeline.ingestFile({
      bytes: mixed,
      mediaType: "application/pdf",
      metadata: metadata({ title: "Half scanned" }),
      sourceId: "admin_upload",
    });
    expect(withoutOcr.status).toBe("indexed");
    if (withoutOcr.status !== "indexed") {
      throw new Error("expected indexed");
    }
    expect(withoutOcr.pagesNeedingOcr).toEqual([2]);
    expect(withoutOcr.ocrPagesFilled).toEqual([]);
    expect(withoutOcr.chunks).toHaveLength(1);

    const ocrPipeline = new IngestionService({
      db,
      storage,
      env: {},
      ocr: new FakeOcrService(true, new Map([[2, "Recognized scanned line."]])),
    });
    const withOcr = await ocrPipeline.ingestFile({
      bytes: mixed,
      mediaType: "application/pdf",
      metadata: metadata({ title: "Half scanned, OCR pass" }),
      sourceId: "admin_upload",
    });
    // Same bytes as above -> duplicate, regardless of OCR config.
    expect(withOcr.status).toBe("duplicate");
  });

  it("fills OCR pages into chunks with an available OCR service", async () => {
    const ocrPipeline = new IngestionService({
      db,
      storage,
      env: {},
      ocr: new FakeOcrService(true, new Map([[1, "Recognized scanned line."]])),
    });
    const outcome = await ocrPipeline.ingestFile({
      bytes: makeBlankPagePdf(),
      mediaType: "application/pdf",
      metadata: metadata({ title: "Scanned page" }),
      sourceId: "admin_upload",
    });
    expect(outcome.status).toBe("indexed");
    if (outcome.status !== "indexed") {
      throw new Error("expected indexed");
    }
    expect(outcome.ocrPagesFilled).toEqual([1]);
    expect(outcome.chunks).toHaveLength(1);
    expect(outcome.chunks[0]?.content).toBe("Recognized scanned line.");
    expect(outcome.chunks[0]?.page_number).toBe(1);
  });

  it("re-ingests from retained bytes and reports missing bytes", async () => {
    const first = await pipeline.ingestFile({
      bytes: load("sample-generic.json"),
      mediaType: "application/json",
      metadata: metadata({ title: "Reingest me" }),
      sourceId: "admin_upload",
    });
    expect(first.status).toBe("indexed");
    if (first.status !== "indexed") {
      throw new Error("expected indexed");
    }
    const again = await pipeline.reingestDocument(first.document.id);
    expect(again.status).toBe("indexed");
    if (again.status !== "indexed") {
      throw new Error("expected indexed");
    }
    expect(again.chunks).toHaveLength(2);
    expect(again.jobId).not.toBe(first.jobId);

    const jobs = new IngestionJobRepository(db);
    const listed = await jobs.listByDocument(first.document.id);
    expect(listed).toHaveLength(2);

    await storage.delete(first.document.storage_key as string);
    const missing = await pipeline.reingestDocument(first.document.id);
    expect(missing.status).toBe("failed");
    if (missing.status !== "failed") {
      throw new Error("expected failed");
    }
    expect(missing.code).toBe("no_stored_bytes");

    await expect(
      pipeline.reingestDocument("12345678-1234-4123-8123-123456789012"),
    ).rejects.toMatchObject({ code: "parse_failed" });
  });

  it("makes indexed, approved chunks searchable with real excerpts", async () => {
    const outcome = await pipeline.ingestFile({
      bytes: load("sample-generic.json"),
      mediaType: "application/json",
      metadata: metadata({
        title: "Searchable manual",
        manufacturer: "Acme",
        model_numbers: ["AcmeBook Pro 14"],
        permission_status: "approved",
      }),
      sourceId: "admin_upload",
    });
    expect(outcome.status).toBe("indexed");

    const hits = await searchChunks(db, {
      query: "adapter LED",
      manufacturer: "Acme",
      model: "AcmeBook Pro 14",
      limit: 10,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.page_number).toBe(4);
    expect(hits[0]?.heading).toBe("No power");
    expect(hits[0]?.excerpt).toContain("adapter");
    expect(hits[0]?.document_title).toBe("Searchable manual");
  });
});
