import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/**
 * 001 — sessions and evidence metadata.
 *
 * Evidence files are metadata only (storage key, media type, checksum):
 * binaries live in private object storage, never in PostgreSQL.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create or replace function set_updated_at()
    returns trigger language plpgsql as $$
    begin
      new.updated_at = now();
      return new;
    end;
    $$;
  `.execute(db);

  await sql`
    create or replace function prevent_mutation()
    returns trigger language plpgsql as $$
    begin
      raise exception 'table % is append-only', TG_TABLE_NAME;
    end;
    $$;
  `.execute(db);

  await sql`
    create table diagnostic_sessions (
      id uuid primary key default gen_random_uuid(),
      device_type text not null check (device_type in ('laptop', 'smartphone')),
      manufacturer text,
      model text,
      operating_system text,
      symptoms text not null,
      problem_started_at timestamptz,
      problem_started_note text,
      recent_events text,
      user_mode text not null check (user_mode in ('everyday', 'technician')),
      status text not null default 'open'
        check (status in ('open', 'in_progress', 'awaiting_test', 'completed', 'archived')),
      safety_state text not null default 'normal'
        check (safety_state in ('normal', 'caution', 'critical_stop', 'review_required')),
      access_token_hash text not null,
      is_demo boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index diagnostic_sessions_status_idx on diagnostic_sessions (status);`.execute(db);
  await sql`create index diagnostic_sessions_safety_state_idx on diagnostic_sessions (safety_state);`.execute(db);
  await sql`create index diagnostic_sessions_created_at_idx on diagnostic_sessions (created_at desc);`.execute(db);
  await sql`
    create trigger diagnostic_sessions_set_updated_at
      before update on diagnostic_sessions
      for each row execute function set_updated_at();
  `.execute(db);

  await sql`
    create table evidence_files (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null references diagnostic_sessions (id) on delete cascade,
      storage_key text not null unique,
      media_type text not null,
      byte_size bigint not null check (byte_size > 0),
      original_filename text,
      kind text not null check (kind in ('image', 'video')),
      processing_status text not null default 'pending'
        check (processing_status in ('pending', 'processing', 'ready', 'failed')),
      processing_error text,
      checksum_sha256 text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index evidence_files_session_id_idx on evidence_files (session_id);`.execute(db);
  await sql`
    create trigger evidence_files_set_updated_at
      before update on evidence_files
      for each row execute function set_updated_at();
  `.execute(db);

  await sql`
    create table evidence_observations (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null references diagnostic_sessions (id) on delete cascade,
      evidence_file_id uuid references evidence_files (id) on delete cascade,
      source text not null check (source in ('user', 'model')),
      body text not null,
      created_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index evidence_observations_session_id_idx on evidence_observations (session_id);`.execute(db);
  await sql`create index evidence_observations_file_id_idx on evidence_observations (evidence_file_id);`.execute(db);

  await sql`
    create table evidence_annotations (
      id uuid primary key default gen_random_uuid(),
      evidence_file_id uuid not null references evidence_files (id) on delete cascade,
      kind text not null check (kind in ('box', 'polygon', 'point', 'mask')),
      coordinates jsonb not null,
      label text,
      producer text not null,
      image_width integer not null check (image_width > 0),
      image_height integer not null check (image_height > 0),
      model_run_id uuid,
      created_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index evidence_annotations_file_id_idx on evidence_annotations (evidence_file_id);`.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists evidence_annotations;`.execute(db);
  await sql`drop table if exists evidence_observations;`.execute(db);
  await sql`drop table if exists evidence_files;`.execute(db);
  await sql`drop table if exists diagnostic_sessions;`.execute(db);
  await sql`drop function if exists prevent_mutation();`.execute(db);
  await sql`drop function if exists set_updated_at();`.execute(db);
}
