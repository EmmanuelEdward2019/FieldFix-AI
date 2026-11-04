import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/**
 * 013 — TOTP multi-factor authentication. Secrets are stored encrypted
 * (AES-256-GCM, key from MFA_ENCRYPTION_KEY); backup codes are
 * scrypt-hashed and single-use; login challenges are short-lived and
 * single-use. Verified MFA is enforced for super_admin accounts.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table user_mfa (
      user_id uuid primary key references users (id) on delete cascade,
      secret_enc text not null,
      verified_at timestamptz null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`
    create table user_mfa_backup_codes (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users (id) on delete cascade,
      code_hash text not null,
      used_at timestamptz null,
      created_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`
    create index user_mfa_backup_codes_user_idx
      on user_mfa_backup_codes (user_id);
  `.execute(db);
  await sql`
    create table user_mfa_challenges (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users (id) on delete cascade,
      token_hash text not null unique,
      expires_at timestamptz not null,
      used_at timestamptz null,
      created_at timestamptz not null default now()
    );
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists user_mfa_challenges;`.execute(db);
  await sql`drop index if exists user_mfa_backup_codes_user_idx;`.execute(db);
  await sql`drop table if exists user_mfa_backup_codes;`.execute(db);
  await sql`drop table if exists user_mfa;`.execute(db);
}
