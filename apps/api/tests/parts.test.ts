import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Kysely } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChunkSchema,
  createDiagnosticTestSchema,
  createDocumentSchema,
  createHypothesisSchema,
  createSessionResponseSchema,
  listPartRecommendationsResponseSchema,
  listToolRecommendationsResponseSchema,
  partRecommendationResponseSchema,
  toolRecommendationResponseSchema,
} from "@fieldfix/contracts";
import { createApp } from "../src/app.js";
import type { Database } from "../src/db/database.js";
import { PartsAdvisorService } from "../src/parts/service.js";
import {
  ChunkRepository,
  DocumentRepository,
} from "../src/db/repositories/documents.js";
import { HypothesisRepository } from "../src/db/repositories/hypotheses.js";
import { DiagnosticTestRepository } from "../src/db/repositories/tests.js";
import type { AppEnv } from "../src/env.js";
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
const CHUNK_CONTENT =
  "Unplug the AC adapter. Remove the bottom cover with a Torx T5 screwdriver, then lift out the battery pack.";

let db: Kysely<Database>;
let storageDir: string;
let storage: StorageAdapter;

function app() {
  return createApp(TEST_ENV, { db, storage });
}

const auth = (t: string) => ({ Authorization: "Bearer " + t });

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

async function makeHypothesis(sessionId: string): Promise<string> {
  const row = await new HypothesisRepository(db).create(
    sessionId,
    createHypothesisSchema.parse({
      title: "Dead adapter",
      confidence_label: "medium",
    }),
  );
  return row.id;
}

async function makeTest(sessionId: string): Promise<string> {
  const row = await new DiagnosticTestRepository(db).create(
    sessionId,
    createDiagnosticTestSchema.parse({
      name: "Adapter LED check",
      objective: "Confirm the adapter delivers power.",
      skill_level: "beginner",
      instructions: [{ step: 1, text: "Plug the adapter into a known-good outlet." }],
      result_options: [
        { value: "led-on", label: "LED on" },
        { value: "led-off", label: "LED off" },
      ],
    }),
  );
  return row.id;
}

async function makeCitableChunk(): Promise<string> {
  const doc = await new DocumentRepository(db).create(
    createDocumentSchema.parse({
      title: "Service manual",
      document_type: "service_manual",
      source_name: "parts-test",
      permission_status: "approved",
    }),
  );
  await new DocumentRepository(db).updateIngestion(doc.id, {
    ingestion_status: "indexed",
  });
  const chunk = await new ChunkRepository(db).create(
    doc.id,
    createChunkSchema.parse({ chunk_index: 0, content: CHUNK_CONTENT }),
  );
  return chunk.id;
}

async function makeUnapprovedChunk(): Promise<string> {
  const doc = await new DocumentRepository(db).create(
    createDocumentSchema.parse({
      title: "Draft manual",
      document_type: "service_manual",
      source_name: "parts-test",
      permission_status: "pending",
    }),
  );
  await new DocumentRepository(db).updateIngestion(doc.id, {
    ingestion_status: "indexed",
  });
  const chunk = await new ChunkRepository(db).create(
    doc.id,
    createChunkSchema.parse({ chunk_index: 0, content: CHUNK_CONTENT }),
  );
  return chunk.id;
}

async function citationCount(): Promise<number> {
  const rows = await db.selectFrom("source_citations").selectAll().execute();
  return rows.length;
}

beforeAll(async () => {
  db = await setupTestDb();
  storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-parts-"));
  storage = new LocalStorageAdapter(storageDir);
});

afterAll(async () => {
  await teardownTestDb(db);
  await rm(storageDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await truncateAll(db);
});

describe("parts recommendations", () => {
  it("lists empty when nothing was recommended", async () => {
    const session = await createSession();
    const res = await request(app())
      .get(`/api/v1/sessions/${session.session.id}/parts/recommendations`)
      .set(auth(session.accessToken));
    expect(res.status).toBe(200);
    const parsed = listPartRecommendationsResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.recommendations).toHaveLength(0);
  });

  it("returns 500 instead of crashing when parts listing fails", async () => {
    const session = await createSession();
    const spy = vi
      .spyOn(PartsAdvisorService.prototype, "listParts")
      .mockRejectedValueOnce(new Error("simulated database failure"));
    try {
      const res = await request(app())
        .get(`/api/v1/sessions/${session.session.id}/parts/recommendations`)
        .set(auth(session.accessToken));
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("internal_error");
    } finally {
      spy.mockRestore();
    }
  });

  it("creates a hypothesis-linked part and round-trips accept", async () => {
    const session = await createSession();
    const hypothesisId = await makeHypothesis(session.session.id);
    const create = await request(app())
      .post(`/api/v1/sessions/${session.session.id}/parts/recommendations`)
      .set(auth(session.accessToken))
      .send({
        hypothesis_id: hypothesisId,
        part_name: "AC adapter 65W",
        part_number: "AD-65W-19V",
        manufacturer: "Acme",
        model_compat: "FieldBook 14",
      });
    expect(create.status).toBe(201);
    const created = partRecommendationResponseSchema.safeParse(create.body);
    expect(created.success).toBe(true);
    if (!created.success) {
      throw new Error("part response failed contract validation");
    }
    expect(created.data.recommendation).toMatchObject({
      session_id: session.session.id,
      hypothesis_id: hypothesisId,
      test_id: null,
      part_name: "AC adapter 65W",
      status: "proposed",
    });
    // Advisory schema: no commerce fields anywhere in the response.
    expect(created.data.recommendation).not.toHaveProperty("price");
    expect(created.data.recommendation).not.toHaveProperty("stock");

    const patch = await request(app())
      .patch(
        `/api/v1/sessions/${session.session.id}/parts/recommendations/${created.data.recommendation.id}`,
      )
      .set(auth(session.accessToken))
      .send({ status: "accepted" });
    expect(patch.status).toBe(200);
    expect(patch.body.recommendation.status).toBe("accepted");

    const list = await request(app())
      .get(`/api/v1/sessions/${session.session.id}/parts/recommendations`)
      .set(auth(session.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.recommendations).toHaveLength(1);
    expect(list.body.recommendations[0].status).toBe("accepted");
  });

  it("creates a test-linked part and round-trips dismiss", async () => {
    const session = await createSession();
    const testId = await makeTest(session.session.id);
    const create = await request(app())
      .post(`/api/v1/sessions/${session.session.id}/parts/recommendations`)
      .set(auth(session.accessToken))
      .send({ test_id: testId, part_name: "CMOS battery CR2032" });
    expect(create.status).toBe(201);

    const recId = (create.body as { recommendation: { id: string } })
      .recommendation.id;
    const patch = await request(app())
      .patch(
        `/api/v1/sessions/${session.session.id}/parts/recommendations/${recId}`,
      )
      .set(auth(session.accessToken))
      .send({ status: "dismissed" });
    expect(patch.status).toBe(200);
    expect(patch.body.recommendation.status).toBe("dismissed");
  });

  it("rejects zero or two links (400, xor constraint)", async () => {
    const session = await createSession();
    const hypothesisId = await makeHypothesis(session.session.id);
    const testId = await makeTest(session.session.id);
    const url = `/api/v1/sessions/${session.session.id}/parts/recommendations`;

    const neither = await request(app())
      .post(url)
      .set(auth(session.accessToken))
      .send({ part_name: "Fan" });
    expect(neither.status).toBe(400);

    const both = await request(app())
      .post(url)
      .set(auth(session.accessToken))
      .send({
        hypothesis_id: hypothesisId,
        test_id: testId,
        part_name: "Fan",
      });
    expect(both.status).toBe(400);
  });

  it("stores verbatim excerpts and refuses fabrications (422)", async () => {
    const session = await createSession();
    const hypothesisId = await makeHypothesis(session.session.id);
    const chunkId = await makeCitableChunk();
    const url = `/api/v1/sessions/${session.session.id}/parts/recommendations`;

    const excerpt = "Remove the bottom cover with a Torx T5 screwdriver";
    const ok = await request(app())
      .post(url)
      .set(auth(session.accessToken))
      .send({
        hypothesis_id: hypothesisId,
        part_name: "Battery pack",
        chunk_id: chunkId,
        excerpt,
      });
    expect(ok.status).toBe(201);
    expect(ok.body.recommendation.excerpt).toBe(excerpt);

    const fabricated = await request(app())
      .post(url)
      .set(auth(session.accessToken))
      .send({
        hypothesis_id: hypothesisId,
        part_name: "Battery pack",
        chunk_id: chunkId,
        excerpt: "The manual guarantees this exact fault is confirmed.",
      });
    expect(fabricated.status).toBe(422);

    // Recommendations never write citation rows (no CitationService.create).
    expect(await citationCount()).toBe(0);
  });

  it("refuses provenance from unapproved documents (422) and unknown chunks (404)", async () => {
    const session = await createSession();
    const hypothesisId = await makeHypothesis(session.session.id);
    const badChunk = await makeUnapprovedChunk();
    const url = `/api/v1/sessions/${session.session.id}/parts/recommendations`;

    const unapproved = await request(app())
      .post(url)
      .set(auth(session.accessToken))
      .send({
        hypothesis_id: hypothesisId,
        part_name: "Battery pack",
        chunk_id: badChunk,
        excerpt: "lift out the battery pack",
      });
    expect(unapproved.status).toBe(422);

    const missing = await request(app())
      .post(url)
      .set(auth(session.accessToken))
      .send({
        hypothesis_id: hypothesisId,
        part_name: "Battery pack",
        chunk_id: UNKNOWN_ID,
        excerpt: "lift out the battery pack",
      });
    expect(missing.status).toBe(404);
  });

  it("404s unknown links and recommendations", async () => {
    const session = await createSession();
    const url = `/api/v1/sessions/${session.session.id}/parts/recommendations`;

    const badLink = await request(app())
      .post(url)
      .set(auth(session.accessToken))
      .send({ hypothesis_id: UNKNOWN_ID, part_name: "Fan" });
    expect(badLink.status).toBe(404);

    const badPatch = await request(app())
      .patch(`${url}/${UNKNOWN_ID}`)
      .set(auth(session.accessToken))
      .send({ status: "accepted" });
    expect(badPatch.status).toBe(404);

    const malformed = await request(app())
      .patch(`${url}/not-a-uuid`)
      .set(auth(session.accessToken))
      .send({ status: "accepted" });
    expect(malformed.status).toBe(404);
  });

  it("enforces session ownership: 404 unknown session, 403 bad token", async () => {
    const session = await createSession();
    const hypothesisId = await makeHypothesis(session.session.id);
    const body = { hypothesis_id: hypothesisId, part_name: "Fan" };

    const unknown = await request(app())
      .post(`/api/v1/sessions/${UNKNOWN_ID}/parts/recommendations`)
      .set(auth(session.accessToken))
      .send(body);
    expect(unknown.status).toBe(404);

    const badToken = await request(app())
      .post(`/api/v1/sessions/${session.session.id}/parts/recommendations`)
      .set(auth("wrong-token"))
      .send(body);
    expect(badToken.status).toBe(403);

    const noToken = await request(app())
      .get(`/api/v1/sessions/${session.session.id}/parts/recommendations`);
    expect(noToken.status).toBe(403);
  });
});

describe("tool recommendations", () => {
  it("lists empty when nothing was recommended", async () => {
    const session = await createSession();
    const res = await request(app())
      .get(`/api/v1/sessions/${session.session.id}/tools/recommendations`)
      .set(auth(session.accessToken));
    expect(res.status).toBe(200);
    const parsed = listToolRecommendationsResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.recommendations).toHaveLength(0);
  });

  it("returns 500 instead of crashing when tools listing fails", async () => {
    const session = await createSession();
    const spy = vi
      .spyOn(PartsAdvisorService.prototype, "listTools")
      .mockRejectedValueOnce(new Error("simulated database failure"));
    try {
      const res = await request(app())
        .get(`/api/v1/sessions/${session.session.id}/tools/recommendations`)
        .set(auth(session.accessToken));
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("internal_error");
    } finally {
      spy.mockRestore();
    }
  });

  it("creates a test-linked tool and round-trips accept", async () => {
    const session = await createSession();
    const testId = await makeTest(session.session.id);
    const create = await request(app())
      .post(`/api/v1/sessions/${session.session.id}/tools/recommendations`)
      .set(auth(session.accessToken))
      .send({
        test_id: testId,
        tool_name: "Torx T5 screwdriver",
        spec: "Magnetic tip, ESD-safe handle",
      });
    expect(create.status).toBe(201);
    const parsed = toolRecommendationResponseSchema.safeParse(create.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error("tool response failed contract validation");
    }
    expect(parsed.data.recommendation).toMatchObject({
      session_id: session.session.id,
      test_id: testId,
      tool_name: "Torx T5 screwdriver",
      status: "proposed",
    });

    const patch = await request(app())
      .patch(
        `/api/v1/sessions/${session.session.id}/tools/recommendations/${parsed.data.recommendation.id}`,
      )
      .set(auth(session.accessToken))
      .send({ status: "accepted" });
    expect(patch.status).toBe(200);
    expect(patch.body.recommendation.status).toBe("accepted");

    const list = await request(app())
      .get(`/api/v1/sessions/${session.session.id}/tools/recommendations`)
      .set(auth(session.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.recommendations).toHaveLength(1);
  });

  it("creates an unlinked tool with manual provenance and round-trips dismiss", async () => {
    const session = await createSession();
    const chunkId = await makeCitableChunk();
    const create = await request(app())
      .post(`/api/v1/sessions/${session.session.id}/tools/recommendations`)
      .set(auth(session.accessToken))
      .send({ tool_name: "Spudger", chunk_id: chunkId });
    expect(create.status).toBe(201);
    const recId = (create.body as { recommendation: { id: string } })
      .recommendation.id;

    const patch = await request(app())
      .patch(
        `/api/v1/sessions/${session.session.id}/tools/recommendations/${recId}`,
      )
      .set(auth(session.accessToken))
      .send({ status: "dismissed" });
    expect(patch.status).toBe(200);
    expect(patch.body.recommendation.status).toBe("dismissed");
    expect(await citationCount()).toBe(0);
  });

  it("refuses chunk pointers to uncitable or unknown passages", async () => {
    const session = await createSession();
    const badChunk = await makeUnapprovedChunk();
    const url = `/api/v1/sessions/${session.session.id}/tools/recommendations`;

    const unapproved = await request(app())
      .post(url)
      .set(auth(session.accessToken))
      .send({ tool_name: "Spudger", chunk_id: badChunk });
    expect(unapproved.status).toBe(422);

    const missing = await request(app())
      .post(url)
      .set(auth(session.accessToken))
      .send({ tool_name: "Spudger", chunk_id: UNKNOWN_ID });
    expect(missing.status).toBe(404);
  });

  it("404s unknown test links and recommendations, 400s bad status", async () => {
    const session = await createSession();
    const url = `/api/v1/sessions/${session.session.id}/tools/recommendations`;

    const badLink = await request(app())
      .post(url)
      .set(auth(session.accessToken))
      .send({ test_id: UNKNOWN_ID, tool_name: "Spudger" });
    expect(badLink.status).toBe(404);

    const badPatch = await request(app())
      .patch(`${url}/${UNKNOWN_ID}`)
      .set(auth(session.accessToken))
      .send({ status: "accepted" });
    expect(badPatch.status).toBe(404);

    const created = await request(app())
      .post(url)
      .set(auth(session.accessToken))
      .send({ tool_name: "Spudger" });
    expect(created.status).toBe(201);
    const recId = (created.body as { recommendation: { id: string } })
      .recommendation.id;
    const badStatus = await request(app())
      .patch(`${url}/${recId}`)
      .set(auth(session.accessToken))
      .send({ status: "ordered" });
    expect(badStatus.status).toBe(400);
  });

  it("enforces session ownership: 404 unknown session, 403 bad token", async () => {
    const session = await createSession();

    const unknown = await request(app())
      .post(`/api/v1/sessions/${UNKNOWN_ID}/tools/recommendations`)
      .set(auth(session.accessToken))
      .send({ tool_name: "Spudger" });
    expect(unknown.status).toBe(404);

    const badToken = await request(app())
      .post(`/api/v1/sessions/${session.session.id}/tools/recommendations`)
      .set(auth("wrong-token"))
      .send({ tool_name: "Spudger" });
    expect(badToken.status).toBe(403);

    const noToken = await request(app())
      .get(`/api/v1/sessions/${session.session.id}/tools/recommendations`);
    expect(noToken.status).toBe(403);
  });
});
