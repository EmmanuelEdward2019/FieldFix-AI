import { describe, expect, it } from "vitest";
import {
  adminUploadMetadataSchema,
  createChunkSchema,
  createCitationSchema,
  createDocumentSchema,
  createIngestionJobSchema,
  ingestionJobDetailSchema,
  ingestionJobStatusSchema,
  knowledgeSearchSchema,
  registerDocumentSchema,
} from "../src/index.js";

describe("createDocumentSchema", () => {
  it("defaults permission and language", () => {
    const parsed = createDocumentSchema.safeParse({
      title: "AcmeBook Service Manual",
      document_type: "service_manual",
      source_name: "demo seed",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.permission_status).toBe("pending");
      expect(parsed.data.language).toBe("en");
      expect(parsed.data.model_numbers).toEqual([]);
    }
  });

  it("rejects a malformed checksum", () => {
    expect(
      createDocumentSchema.safeParse({
        title: "Doc",
        document_type: "other",
        source_name: "demo seed",
        checksum_sha256: "not-a-sha256",
      }).success,
    ).toBe(false);
  });
});

describe("createChunkSchema", () => {
  it("requires non-empty content", () => {
    expect(
      createChunkSchema.safeParse({ chunk_index: 0, content: "" }).success,
    ).toBe(false);
    expect(
      createChunkSchema.safeParse({
        chunk_index: 0,
        page_number: 42,
        heading: "Power",
        content: "Check the adapter LED.",
      }).success,
    ).toBe(true);
  });
});

describe("createCitationSchema", () => {
  const chunkId = "55555555-5555-4555-8555-555555555555";

  it("requires a hypothesis or test link", () => {
    expect(
      createCitationSchema.safeParse({
        hypothesis_id: "66666666-6666-4666-8666-666666666666",
        chunk_id: chunkId,
        excerpt: "Check the adapter LED.",
      }).success,
    ).toBe(true);
    expect(
      createCitationSchema.safeParse({
        chunk_id: chunkId,
        excerpt: "Orphan excerpt.",
      }).success,
    ).toBe(false);
  });
});

describe("knowledgeSearchSchema", () => {
  it("bounds the result limit", () => {
    expect(
      knowledgeSearchSchema.safeParse({ query: "adapter", limit: 100 }).success,
    ).toBe(false);
    const parsed = knowledgeSearchSchema.safeParse({ query: "adapter" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.limit).toBe(10);
    }
  });
});

describe("adminUploadMetadataSchema", () => {
  it("defaults the source name and forbids client checksums", () => {
    const parsed = adminUploadMetadataSchema.safeParse({
      title: "Manual",
      document_type: "service_manual",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.source_name).toBe("Admin upload");
      expect("checksum_sha256" in parsed.data).toBe(false);
      expect("storage_key" in parsed.data).toBe(false);
    }
  });
});

describe("registerDocumentSchema", () => {
  it("accepts connector refs with a bounded default limit", () => {
    const parsed = registerDocumentSchema.safeParse({
      connector: "myfixit_dataset",
      ref: "/data/MyFixit-Dataset/jsons/Phone.json",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.limit).toBe(25);
    }
    expect(
      registerDocumentSchema.safeParse({
        connector: "random-blog",
        ref: "x",
      }).success,
    ).toBe(false);
    expect(
      registerDocumentSchema.safeParse({
        connector: "ifixit_api",
        ref: "1220",
        limit: 5000,
      }).success,
    ).toBe(false);
  });
});

describe("ingestion job schemas", () => {
  it("covers queued/running/succeeded/failed and validates job details", () => {
    expect(ingestionJobStatusSchema.options).toEqual([
      "queued",
      "running",
      "succeeded",
      "failed",
    ]);
    const detail = ingestionJobDetailSchema.safeParse({
      format: "pdf",
      pages_needing_ocr: [2],
    });
    expect(detail.success).toBe(true);
    if (detail.success) {
      expect(detail.data.ocr_pages_filled).toEqual([]);
      expect(detail.data.warnings).toEqual([]);
    }
    expect(
      createIngestionJobSchema.safeParse({
        document_id: "77777777-7777-4777-8777-777777777777",
      }).success,
    ).toBe(true);
    expect(
      createIngestionJobSchema.safeParse({ document_id: "nope" }).success,
    ).toBe(false);
  });
});
