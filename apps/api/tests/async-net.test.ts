import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Kysely } from "kysely";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { Database } from "../src/db/database.js";
import type { AppEnv } from "../src/env.js";
import { ASYNC_SAFE_MARK, hardenRouter } from "../src/http/async-net.js";
import { lastResortErrorHandler } from "../src/http/error-middleware.js";
import { LocalStorageAdapter } from "../src/storage/local-adapter.js";
import type { StorageAdapter } from "../src/storage/types.js";
import { setupTestDb, teardownTestDb } from "./db/setup.js";

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

function behaviorApp() {
  const app = express();
  const router = express.Router();
  router.get("/reject", async () => {
    await Promise.resolve();
    throw new Error("async boom");
  });
  router.get("/ok", (_req, res) => {
    res.json({ ok: true });
  });
  router.get("/sync-throw", () => {
    throw new Error("sync boom");
  });
  router.get("/send-then-boom", async (_req, res) => {
    res.json({ ok: true });
    await Promise.resolve();
    throw new Error("late boom");
  });
  app.use(hardenRouter(router));
  app.use(lastResortErrorHandler);
  return app;
}

describe("async safety net", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("converts an async rejection into the 500 envelope and logs it", async () => {
    const res = await request(behaviorApp()).get("/reject");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: "internal_error", message: "Unexpected server error." },
    });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("leaves healthy routes untouched", async () => {
    const res = await request(behaviorApp()).get("/ok");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("leaves the native sync-throw path intact", async () => {
    const res = await request(behaviorApp()).get("/sync-throw");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("internal_error");
  });

  it("keeps an already-sent response intact when a handler rejects late", async () => {
    const res = await request(behaviorApp()).get("/send-then-boom");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

interface WalkCounts {
  routers: number;
  asyncTotal: number;
  asyncMarked: number;
}

function constructorName(handle: unknown): unknown {
  return (handle as { constructor?: { name?: unknown } } | null)?.constructor?.name;
}

function collectAsyncHandlers(layer: unknown, acc: WalkCounts): void {
  const typed = layer as { handle?: unknown; route?: { stack?: unknown[] } } | null;
  const handle = typed?.handle;
  const nested = (handle as { stack?: unknown } | null)?.stack;
  if (typeof handle === "function" && Array.isArray(nested)) {
    acc.routers += 1;
    for (const child of nested) collectAsyncHandlers(child, acc);
    return;
  }
  // Wrapped handlers are plain functions carrying the mark; unwrapped async
  // handlers still show their AsyncFunction constructor. Count both, so this
  // fails when any async handler escapes the net.
  const marked = (handle as unknown as Record<string, unknown> | null)?.[ASYNC_SAFE_MARK] === true;
  if (constructorName(handle) === "AsyncFunction" || marked) {
    acc.asyncTotal += 1;
    if (marked) acc.asyncMarked += 1;
    return;
  }
  const routeStack = typed?.route?.stack;
  if (Array.isArray(routeStack)) {
    for (const child of routeStack) collectAsyncHandlers(child, acc);
  }
}

describe("production async-net coverage", () => {
  let db: Kysely<Database>;
  let storageDir: string;
  let storage: StorageAdapter;

  beforeAll(async () => {
    db = await setupTestDb();
    storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-async-net-"));
    storage = new LocalStorageAdapter(storageDir);
  });

  afterAll(async () => {
    await teardownTestDb(db);
    await rm(storageDir, { recursive: true, force: true });
  });

  it("hardens every async handler mounted by createApp", () => {
    const app = createApp(TEST_ENV, { db, storage });
    const stack = (app as unknown as { _router?: { stack?: unknown[] } })._router?.stack;
    expect(Array.isArray(stack)).toBe(true);
    const acc: WalkCounts = { routers: 0, asyncTotal: 0, asyncMarked: 0 };
    for (const layer of stack as unknown[]) collectAsyncHandlers(layer, acc);
    // Non-vacuous guards: the walk must actually find the production wiring.
    expect(acc.routers).toBeGreaterThanOrEqual(10);
    expect(acc.asyncTotal).toBeGreaterThan(0);
    expect(acc.asyncMarked).toBe(acc.asyncTotal);
  });
});
