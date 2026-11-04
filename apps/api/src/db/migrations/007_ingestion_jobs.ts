import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/** 007 — one row per ingestion attempt, for status and failure reporting. */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table ingestion_jobs (
      id uuid primary key default gen_random_uuid(),
      document_id uuid references technical_documents (id) on delete cascade,
      source_name text not null,
      status text not null default 'queued'
        check (status in ('queued', 'running', 'succeeded', 'failed')),
      error text,
      chunks_created integer not null default 0,
      detail jsonb,
      created_at timestamptz not null default now(),
      finished_at timestamptz
    );
  `.execute(db);
  await sql`create index ingestion_jobs_document_id_idx on ingestion_jobs (document_id);`.execute(db);
  await sql`create index ingestion_jobs_status_idx on ingestion_jobs (status);`.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists ingestion_jobs;`.execute(db);
}
