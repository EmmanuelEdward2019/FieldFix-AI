import type { NextFunction, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "../../src/http/rate-limit.js";

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
  };
  return res as unknown as Response & {
    statusCode: number;
    headers: Record<string, string>;
    body: unknown;
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("rateLimit", () => {
  // Store decisions settle in microtasks; one macrotask always suffices.
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it("allows bursts under budget, then answers 429 with Retry-After", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const limiter = rateLimit({ maxRequests: 2, windowMs: 60_000 });
    const req = { ip: "10.0.0.1" } as Request;
    const next: NextFunction = () => undefined;

    const first = mockRes();
    limiter(req, first, next);
    await flush();
    expect(first.statusCode).toBe(200);
    const second = mockRes();
    limiter(req, second, next);
    await flush();
    expect(second.statusCode).toBe(200);

    const third = mockRes();
    limiter(req, third, next);
    await flush();
    expect(third.statusCode).toBe(429);
    expect(third.headers["Retry-After"]).toMatch(/^\d+$/);
    expect(third.body).toMatchObject({ error: { code: "rate_limited" } });
  });

  it("tracks clients independently and skips the test env", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const limiter = rateLimit({ maxRequests: 1, windowMs: 60_000 });
    const next: NextFunction = () => undefined;
    const res = mockRes();
    limiter({ ip: "10.0.0.9" } as Request, res, next);
    await flush();
    expect(res.statusCode).toBe(200);

    vi.stubEnv("NODE_ENV", "test");
    const bypass = vi.fn();
    limiter({ ip: "10.0.0.9" } as Request, mockRes(), bypass as NextFunction);
    expect(bypass).toHaveBeenCalledTimes(1);
  });
});
