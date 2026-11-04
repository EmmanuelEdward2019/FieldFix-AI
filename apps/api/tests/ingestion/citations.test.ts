import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminUploadMetadataSchema,
  createHypothesisSchema,
} from "@fieldfix/contracts";
import type { Database } from "../../src/db/database.js";
import { SessionRepository } from "../../src/db/repositories/sessions.js";
import { HypothesisRepository } from "../../src/db/repositories/hypotheses.js";
import { ChunkRepository } from "../../src/db/repositories/documents.js";
import { CitationService } from "../../src/knowledge/citations.js";
import { LocalStorageAdapter } from "../../src/storage/local-adapter.js";
import type { StorageAdapter } from "../../src/storage/types.js";
import { IngestionService } from "../../src/ingestion/pipeline.js";
import { setupTestDb, teardownTestDb, truncateAll } from "../db/setup.js";

const FIXTURES = path.join(__dirname, "fixtures");

/**
 * Proves citations resolve to real passages: ingest -> cite an exact
 * excerpt -> resolve shows the live chunk, page, heading, and owning
 * approved document. Fabrications are refused at write time.
 */
describe("CitationService", () => {
  let db: Kysely<Database>;
  let storageDir: string;
  let storage: StorageAdapter;
  let pipeline: IngestionService;
  let citations: CitationService;

  beforeAll(async () => {
    db = await setupTestDb();
    storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-citations-"));
    storage = new LocalStorageAdapter(storageDir);
    pipeline = new IngestionService({ db, storage, env: {} });
    citations = new CitationService(db);
  });

  afterAll(async () => {
    await teardownTestDb(db);
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  async function ingestApproved(): Promise<string> {
    const outcome = await pipeline.ingestFile({
      bytes: readFileSync(path.join(FIXTURES, "sample-generic.json")),
      mediaType: "application/json",
      metadata: adminUploadMetadataSchema.parse({
        title: "Citable manual",
        manufacturer: "Acme",
        document_type: "service_manual",
        permission_status: "approved",
      }),
      sourceId: "admin_upload",
    });
    if (outcome.status !== "indexed") {
      throw new Error("expected indexed fixture document");
    }
    return outcome.document.id;
  }

  async function makeSession(): Promise<string> {
    const session = await new SessionRepository(db).create({
      device_type: "laptop",
      symptoms: "No power.",
      user_mode: "everyday",
      access_token_hash: "citation-test-hash",
    });
    return session.id;
  }

  async function makeHypothesis(sessionId: string): Promise<string> {
    const hypothesis = await new HypothesisRepository(db).create(
      sessionId,
      createHypothesisSchema.parse({
        title: "Dead adapter",
        confidence_label: "medium",
      }),
    );
    return hypothesis.id;
  }

  it("stores and resolves a citation to its real passage", async () => {
    const documentId = await ingestApproved();
    const sessionId = await makeSession();
    const hypothesisId = await makeHypothesis(sessionId);
    const chunks = await new ChunkRepository(db).listByDocument(documentId);
    const target = chunks.find((c) => c.heading === "No power");
    expect(target).toBeDefined();
    if (!target) {
      throw new Error("fixture chunk missing");
    }

    const excerpt = "Verify the AC adapter LED glows steadily on a known-good outlet";
    const citation = await citations.create(sessionId, {
      hypothesis_id: hypothesisId,
      chunk_id: target.id,
      excerpt,
    });
    expect(citation.excerpt).toBe(excerpt);

    const resolved = await citations.resolve(citation.id);
    expect(resolved).not.toBeNull();
    expect(resolved?.chunk.id).toBe(target.id);
    expect(resolved?.chunk.content).toContain(excerpt);
    expect(resolved?.chunk.heading).toBe("No power");
    expect(resolved?.chunk.page_number).toBe(4);
    expect(resolved?.document.id).toBe(documentId);
    expect(resolved?.document.title).toBe("Citable manual");
    expect(resolved?.document.permission_status).toBe("approved");
    expect(resolved?.citation.hypothesis_id).toBe(hypothesisId);
  });

  it("refuses excerpts that are not in the cited passage", async () => {
    const documentId = await ingestApproved();
    const sessionId = await makeSession();
    const hypothesisId = await makeHypothesis(sessionId);
    const chunks = await new ChunkRepository(db).listByDocument(documentId);

    await expect(
      citations.create(sessionId, {
        hypothesis_id: hypothesisId,
        chunk_id: chunks[0]?.id as string,
        excerpt: "The manual guarantees this exact fault is confirmed.",
      }),
    ).rejects.toMatchObject({ code: "excerpt_not_found" });
  });

  it("refuses citations to unapproved or missing passages", async () => {
    const outcome = await pipeline.ingestFile({
      bytes: readFileSync(path.join(FIXTURES, "sample-generic.json")),
      mediaType: "application/json",
      metadata: adminUploadMetadataSchema.parse({
        title: "Pending manual",
        document_type: "service_manual",
        permission_status: "pending",
      }),
      sourceId: "admin_upload",
    });
    if (outcome.status !== "indexed") {
      throw new Error("expected indexed fixture document");
    }
    const sessionId = await makeSession();
    const hypothesisId = await makeHypothesis(sessionId);

    await expect(
      citations.create(sessionId, {
        hypothesis_id: hypothesisId,
        chunk_id: outcome.chunks[0]?.id as string,
        excerpt: "Verify the AC adapter LED",
      }),
    ).rejects.toMatchObject({ code: "document_not_citable" });

    await expect(
      citations.create(sessionId, {
        hypothesis_id: hypothesisId,
        chunk_id: "12345678-1234-4123-8123-123456789012",
        excerpt: "anything",
      }),
    ).rejects.toMatchObject({ code: "chunk_not_found" });
  });

  it("refuses links outside the session and resolves null when gone", async () => {
    const documentId = await ingestApproved();
    const sessionId = await makeSession();
    const otherSessionId = await new SessionRepository(db).create({
      device_type: "smartphone",
      symptoms: "Black screen.",
      user_mode: "technician",
      access_token_hash: "other-hash",
    }).then((s) => s.id);
    const foreignHypothesisId = await makeHypothesis(otherSessionId);
    const chunks = await new ChunkRepository(db).listByDocument(documentId);

    await expect(
      citations.create(sessionId, {
        hypothesis_id: foreignHypothesisId,
        chunk_id: chunks[0]?.id as string,
        excerpt: "Verify the AC adapter LED",
      }),
    ).rejects.toMatchObject({ code: "link_not_found" });

    await expect(
      citations.resolve("12345678-1234-4123-8123-123456789012"),
    ).resolves.toBeNull();
  });

  it("lists a session's citations with their passages", async () => {
    const documentId = await ingestApproved();
    const sessionId = await makeSession();
    const hypothesisId = await makeHypothesis(sessionId);
    const chunks = await new ChunkRepository(db).listByDocument(documentId);
    await citations.create(sessionId, {
      hypothesis_id: hypothesisId,
      chunk_id: chunks[0]?.id as string,
      excerpt: "Verify the AC adapter LED",
    });
    await citations.create(sessionId, {
      hypothesis_id: hypothesisId,
      chunk_id: chunks[1]?.id as string,
      excerpt: "the battery may be swelling",
    });

    const listed = await citations.listSessionResolved(sessionId);
    expect(listed).toHaveLength(2);
    expect(listed.map((r) => r.chunk.heading)).toEqual([
      "No power",
      "Swollen battery",
    ]);
    expect(listed.every((r) => r.document.id === documentId)).toBe(true);
  });
});
