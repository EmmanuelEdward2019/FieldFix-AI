import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/**
 * 010 — email verification state. New accounts register unconfirmed
 * and must click the emailed link; pre-existing rows are grandfathered
 * as confirmed. Single-use token hashes live in `user_email_tokens`
 * (confirmation 24h, password reset 1h); raw tokens are only ever
 * inside the emailed links, never in the database.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table users
      add column email_confirmed_at timestamptz;
  `.execute(db);
  await sql`update users set email_confirmed_at = now() where email_confirmed_at is null;`.execute(
    db,
  );
  await sql`
    create table user_email_tokens (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users (id) on delete cascade,
      kind text not null check (kind in ('email_confirmation', 'password_reset')),
      token_hash text not null unique,
      expires_at timestamptz not null,
      used_at timestamptz,
      created_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index user_email_tokens_user_kind_idx on user_email_tokens (user_id, kind);`.execute(
    db,
  );
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists user_email_tokens;`.execute(db);
  await sql`alter table users drop column if exists email_confirmed_at;`.execute(db);
}
