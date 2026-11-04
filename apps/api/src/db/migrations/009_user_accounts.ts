import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/**
 * 009 — user accounts and login sessions. `diagnostic_sessions.user_id`
 * is nullable so pre-auth and anonymous demo sessions keep working;
 * new sessions created with a user token record their owner.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table users (
      id uuid primary key default gen_random_uuid(),
      email text not null,
      name text not null,
      password_hash text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create unique index users_email_unique on users (lower(email));`.execute(db);
  await sql`
    alter table diagnostic_sessions
      add column user_id uuid references users (id) on delete set null;
  `.execute(db);
  await sql`create index diagnostic_sessions_user_id_idx on diagnostic_sessions (user_id);`.execute(
    db,
  );
  await sql`
    create table user_sessions (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users (id) on delete cascade,
      token_hash text not null unique,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index user_sessions_user_id_idx on user_sessions (user_id);`.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists user_sessions;`.execute(db);
  await sql`alter table diagnostic_sessions drop column if exists user_id;`.execute(db);
  await sql`drop table if exists users;`.execute(db);
}
