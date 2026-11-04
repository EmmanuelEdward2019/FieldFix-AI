import type { Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db/database.js";
import { setupTestDb, teardownTestDb, truncateAll } from "./db/setup.js";
import {
  MemoryRateLimitStore,
  PostgresRateLimitStore,
  rateLimit,
} from "../src/http/rate-limit.js";

let db: Kysely<Database>;

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb(db);
});

beforeEach(async () => {
  await truncateAll(db);
});

describe("PostgresRateLimitStore", () => {
  it("allows a budget of hits, then denies until the window rolls", async () => {
    const store = new PostgresRateLimitStore(db);
    const key = "test:127.0.0.1";
    const windowMs = 120;
    for (let i = 0; i < 3; i += 1) {
      const result = await store.check(key, windowMs, 3);
      expect(result.allowed).toBe(true);
    }
    const denied = await store.check(key, windowMs, 3);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, windowMs + 30));
    const fresh = await store.check(key, windowMs, 3);
    expect(fresh.allowed).toBe(true);
  });

  it("shares the budget across store instances (multi-process safe)", async () => {
    const first = new PostgresRateLimitStore(db);
    const second = new PostgresRateLimitStore(db);
    const key = "shared:10.0.0.9";
    expect((await first.check(key, 60_000, 2)).allowed).toBe(true);
    expect((await second.check(key, 60_000, 2)).allowed).toBe(true);
    // Either instance now sees the combined count.
    expect((await first.check(key, 60_000, 2)).allowed).toBe(false);
    expect((await second.check(key, 60_000, 2)).allowed).toBe(false);
  });

  it("isolates budgets per key", async () => {
    const store = new PostgresRateLimitStore(db);
    expect((await store.check("a", 60_000, 1)).allowed).toBe(true);
    expect((await store.check("a", 60_000, 1)).allowed).toBe(false);
    expect((await store.check("b", 60_000, 1)).allowed).toBe(true);
  });
});

describe("rateLimit middleware", () => {
  it("denies with 429 + Retry-After once the store budget is spent", async () => {
    const store = new MemoryRateLimitStore();
    const middleware = rateLimit({ maxRequests: 2, windowMs: 60_000, store, scope: "probe" });
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      let status = 0;
      const headers: Record<string, string> = {};
      const req = { ip: "127.0.0.1" } as never;
      const res = {
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
        status: (code: number) => {
          status = code;
          return { json: () => undefined };
        },
      } as never;
      // next() and res.status() both settle in microtasks, so the
      // setImmediate fallback only fires on the deny path.
      const runOnce = (): Promise<boolean> =>
        new Promise((resolve) => {
          middleware(req, res, () => resolve(true));
          setImmediate(() => resolve(status === 0));
        });
      expect(await runOnce()).toBe(true);
      expect(await runOnce()).toBe(true);
      expect(await runOnce()).toBe(false);
      expect(status).toBe(429);
      expect(headers["Retry-After"]).toBeDefined();
    } finally {
      process.env.NODE_ENV = previousEnv;
    }
  });
});
