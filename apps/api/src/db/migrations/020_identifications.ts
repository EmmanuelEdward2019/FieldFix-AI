import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/**
 * 020 — visual component identifications.
 *
 * evidence_identifications: one row per identification pass over an
 * evidence image. Append-only history (a re-run adds a row; reads
 * take the latest). The components/suspected/unidentifiable lists are
 * model output, stored verbatim as JSONB and validated at the API
 * boundary — they are a visual intelligence layer only. They never
 * feed hypotheses, tests, reports, or the safety controller; the
 * diagnostic sequence is unchanged.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table evidence_identifications (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null references diagnostic_sessions (id) on delete cascade,
      evidence_file_id uuid not null references evidence_files (id) on delete cascade,
      device_name text check (device_name is null or char_length(device_name) between 1 and 200),
      components jsonb not null default '[]'::jsonb,
      suspected_fault_area jsonb,
      unidentifiable jsonb not null default '[]'::jsonb,
      model_run_id uuid references model_runs (id) on delete set null,
      created_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index evidence_identifications_file_id_idx on evidence_identifications (evidence_file_id, created_at desc);`.execute(
    db,
  );
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists evidence_identifications;`.execute(db);
}
