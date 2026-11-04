import { sql } from "kysely";
import type { NextFunction, Request, Response } from "express";
import type { Db } from "../db/database.js";
import { sendError } from "./errors.js";

export interface RateLimitOptions {
  /** Max requests per window per client key. Default 300. */
  maxRequests?: number;
  /** Window length in ms. Default 60_000. */
  windowMs?: number;
  /** Budget namespace (e.g. "global", "auth"). Default "global". */
  scope?: string;
  /**
   * Counter backend. PostgreSQL-backed in the app (shared across
   * processes); in-memory when no database is wired (tests, fallback).
   */
  store?: RateLimitStore;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the window rolls (meaningful when denied). */
  retryAfterSec: number;
}

export interface RateLimitStore {
  check(key: string, windowMs: number, maxRequests: number): Promise<RateLimitDecision>;
}

/** Process-local fixed-window counters (fallback, no cross-talk). */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { start: number; count: number }>();

  async check(key: string, windowMs: number, maxRequests: number): Promise<RateLimitDecision> {
    const now = Date.now();
    const start = Math.floor(now / windowMs) * windowMs;
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.start !== start) {
      this.buckets.set(key, { start, count: 1 });
      this.prune(now, windowMs);
      return { allowed: true, retryAfterSec: 0 };
    }
    if (bucket.count >= maxRequests) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((bucket.start + windowMs - now) / 1000)),
      };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterSec: 0 };
  }

  private prune(now: number, windowMs: number): void {
    if (this.buckets.size < 10_000) {
      return;
    }
    for (const [key, bucket] of this.buckets) {
      if (bucket.start + windowMs <= now) {
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * Shared fixed-window counters in PostgreSQL. The upsert is atomic,
 * so concurrent processes enforce one budget. Stale buckets for the
 * key's scope are deleted opportunistically (best-effort).
 */
export class PostgresRateLimitStore implements RateLimitStore {
  constructor(private readonly db: Db) {}

  async check(key: string, windowMs: number, maxRequests: number): Promise<RateLimitDecision> {
    const now = Date.now();
    const start = new Date(Math.floor(now / windowMs) * windowMs);
    const row = await this.db
      .insertInto("rate_limit_windows")
      .values({ route_key: key, window_start: start, count: 1 })
      .onConflict((oc) =>
        oc.columns(["route_key", "window_start"]).doUpdateSet({
          count: sql`rate_limit_windows.count + 1`,
        }),
      )
      .returning("count")
      .executeTakeFirstOrThrow();
    // Opportunistic cleanup; a failure here must never fail the request.
    this.db
      .deleteFrom("rate_limit_windows")
      .where("window_start", "<", new Date(now - windowMs))
      .execute()
      .catch(() => undefined);
    const count = Number(row.count);
    if (count > maxRequests) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((start.getTime() + windowMs - now) / 1000)),
      };
    }
    return { allowed: true, retryAfterSec: 0 };
  }
}

const sharedMemory = new MemoryRateLimitStore();

/**
 * Fixed-window rate limiter for the JSON API. Keyed by scope + client
 * IP; responds with the standard 429 envelope when the window budget
 * is exhausted. Skipped when NODE_ENV is "test" so suites can exercise
 * the API without tripping the budget (stores are tested directly).
 */
export function rateLimit(options: RateLimitOptions = {}) {
  const maxRequests = options.maxRequests ?? 300;
  const windowMs = options.windowMs ?? 60_000;
  const scope = options.scope ?? "global";
  const store = options.store ?? sharedMemory;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (process.env.NODE_ENV === "test") {
      next();
      return;
    }
    const key = `${scope}:${req.ip ?? "unknown"}`;
    void store
      .check(key, windowMs, maxRequests)
      .then(
        (decision) => {
          if (!decision.allowed) {
            res.setHeader("Retry-After", String(decision.retryAfterSec));
            sendError(res, 429, "rate_limited", "Too many requests; slow down and retry.");
            return;
          }
          next();
        },
        () => {
          // A store outage must not take the API down: fail open.
          next();
        },
      )
      .catch(() => next());
  };
}
