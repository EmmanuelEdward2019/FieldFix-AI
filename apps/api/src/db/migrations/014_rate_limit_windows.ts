import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/**
 * 014 — shared rate-limit counters. Fixed-window buckets keyed by
 * scope + client, so every API process enforces the same budget.
 * Stale buckets are deleted opportunistically on each check.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table rate_limit_windows (
      route_key text not null,
      window_start timestamptz not null,
      count integer not null default 1,
      primary key (route_key, window_start)
    );
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists rate_limit_windows;`.execute(db);
}
