import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/db/database.js";
import { DocumentRepository } from "../../src/db/repositories/documents.js";
import { LocalStorageAdapter } from "../../src/storage/local-adapter.js";
import type { StorageAdapter } from "../../src/storage/types.js";
import { IfixitClient, importIfixitGuide } from "../../src/ingestion/connectors/ifixit.js";
import { importMyFixitFile } from "../../src/ingestion/connectors/myfixit.js";
import { IngestionService } from "../../src/ingestion/pipeline.js";
import { setupTestDb, teardownTestDb, truncateAll } from "../db/setup.js";

const FIXTURES = path.join(__dirname, "fixtures");
const ACK = { MYFIXIT_LICENCE_ACK: "CC-BY-NC-SA-3.0", IFIXIT_INGEST_ACK: "CC-BY-NC-SA-3.0" };

const GUIDE_JSON = {
  guideid: 1220,
  title: "AcmeBook Pro 14 Battery Replacement",
  subject: "Battery",
  category: "AcmeBook Pro 14",
  type: "replacement",
  url: "https://www.ifixit.com/Guide/acmebook-battery/1220",
  revisionid: 55,
  steps: [
    {
      stepid: 1,
      orderby: 1,
      title: "Disconnect power",
      lines: [
        { text_raw: "Power off the laptop." },
        { text_raw: "Unplug the AC adapter." },
      ],
    },
    {
      stepid: 2,
      orderby: 2,
      title: "",
      lines: [{ text_raw: "Remove the bottom panel screws." }],
    },
  ],
};

function mockFetch(handler: (url: string) => Response): typeof fetch {
  return ((url: string | URL | Request) => Promise.resolve(handler(String(url)))) as typeof fetch;
}

describe("source connectors (real DB, mocked network)", () => {
  let db: Kysely<Database>;
  let storageDir: string;
  let storage: StorageAdapter;
  let pipeline: IngestionService;

  beforeAll(async () => {
    db = await setupTestDb();
    storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-connectors-"));
    storage = new LocalStorageAdapter(storageDir);
    // The pipeline re-checks source permission with its own env.
    pipeline = new IngestionService({ db, storage, env: { ...ACK } });
  });

  afterAll(async () => {
    await teardownTestDb(db);
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  it("refuses the MyFixit connector without a licence ack", async () => {
    await expect(
      importMyFixitFile(pipeline, {
        filePath: path.join(FIXTURES, "sample-myfixit.json"),
        env: {},
      }),
    ).rejects.toMatchObject({ code: "source_disabled" });
  });

  it("imports MyFixit manuals as individual pending documents", async () => {
    const result = await importMyFixitFile(pipeline, {
      filePath: path.join(FIXTURES, "sample-myfixit.json"),
      env: ACK,
    });
    expect(result.recordsSeen).toBe(2);
    expect(result.imported).toHaveLength(2);
    expect(result.duplicates).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(result.imported[0]?.chunks).toBe(2);

    const documents = new DocumentRepository(db);
    const doc = await documents.getById(result.imported[0]?.documentId as string);
    expect(doc?.title).toBe("AcmeBook Pro 14 Battery Replacement");
    expect(doc?.source_name).toBe("MyFixit Dataset");
    expect(doc?.licence_name).toBe("CC BY-NC-SA 3.0");
    expect(doc?.permission_status).toBe("pending");
    expect(doc?.version).toBe("guide-9001");
    expect(doc?.ingestion_status).toBe("indexed");

    // Re-importing the same file yields duplicates, not new documents.
    const again = await importMyFixitFile(pipeline, {
      filePath: path.join(FIXTURES, "sample-myfixit.json"),
      env: ACK,
    });
    expect(again.imported).toHaveLength(0);
    expect(again.duplicates).toHaveLength(2);
  });

  it("imports JSONL with a record limit and reports invalid lines", async () => {
    const result = await importMyFixitFile(pipeline, {
      filePath: path.join(FIXTURES, "sample-myfixit.jsonl"),
      limit: 1,
      env: ACK,
    });
    expect(result.recordsSeen).toBe(3);
    expect(result.imported).toHaveLength(1);

    const full = await importMyFixitFile(pipeline, {
      filePath: path.join(FIXTURES, "sample-myfixit.jsonl"),
      env: { ...ACK },
    });
    // One record already imported above -> duplicate; one invalid.
    expect(full.duplicates).toHaveLength(1);
    expect(full.imported).toHaveLength(1);
    expect(full.failed).toHaveLength(1);
    expect(full.failed[0]?.error).toContain("Invalid MyFixit record");
  });

  it("reports a missing dataset file", async () => {
    await expect(
      importMyFixitFile(pipeline, {
        filePath: path.join(FIXTURES, "does-not-exist.json"),
        env: ACK,
      }),
    ).rejects.toMatchObject({ code: "ref_not_found" });
  });

  it("refuses the iFixit connector without a licence ack", async () => {
    const fetchFn = mockFetch(() => new Response("{}", { status: 200 }));
    await expect(
      importIfixitGuide(pipeline, {
        guideId: 1220,
        client: new IfixitClient({ fetchFn }),
        env: {},
      }),
    ).rejects.toMatchObject({ code: "source_disabled" });
  });

  it("imports one explicit iFixit guide with steps and provenance", async () => {
    const seen: string[] = [];
    const fetchFn = mockFetch((url) => {
      seen.push(url);
      return new Response(JSON.stringify(GUIDE_JSON), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const outcome = await importIfixitGuide(pipeline, {
      guideId: 1220,
      client: new IfixitClient({ baseUrl: "https://example.invalid/api/2.0", fetchFn }),
      env: ACK,
    });
    expect(seen).toEqual(["https://example.invalid/api/2.0/guides/1220"]);
    expect(outcome.status).toBe("indexed");
    if (outcome.status !== "indexed") {
      throw new Error("expected indexed");
    }
    expect(outcome.document.title).toBe("AcmeBook Pro 14 Battery Replacement");
    expect(outcome.document.source_url).toBe("https://www.ifixit.com/Guide/acmebook-battery/1220");
    expect(outcome.document.version).toBe("guide-1220-rev-55");
    expect(outcome.document.licence_name).toBe("CC BY-NC-SA 3.0");
    expect(outcome.document.permission_status).toBe("pending");
    expect(outcome.chunks.map((c) => c.heading)).toEqual([
      "Step 1: Disconnect power",
      "Step 2",
    ]);
    expect(outcome.chunks[0]?.content).toContain("Unplug the AC adapter.");
    expect(outcome.chunks[0]?.component_tags).toEqual(["Battery"]);
  });

  it("maps iFixit 404s, bad ids, and bad shapes to fetch failures", async () => {
    const notFound = mockFetch(() => new Response("nope", { status: 404 }));
    await expect(
      importIfixitGuide(pipeline, {
        guideId: 999999,
        client: new IfixitClient({ fetchFn: notFound }),
        env: ACK,
      }),
    ).rejects.toMatchObject({ code: "ref_not_found" });

    const ok = mockFetch(() => new Response("{}", { status: 200 }));
    await expect(
      importIfixitGuide(pipeline, {
        guideId: -3,
        client: new IfixitClient({ fetchFn: ok }),
        env: ACK,
      }),
    ).rejects.toMatchObject({ code: "fetch_failed" });
    await expect(
      importIfixitGuide(pipeline, {
        guideId: 1220,
        client: new IfixitClient({ fetchFn: ok }),
        env: ACK,
      }),
    ).rejects.toMatchObject({ code: "fetch_failed" });
  });
});
