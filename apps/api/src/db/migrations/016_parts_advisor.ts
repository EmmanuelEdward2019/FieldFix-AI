import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/**
 * 016 — parts and tools advisor (deterministic v1).
 *
 * part_recommendations: advisory part suggestions linked to exactly
 * one of a hypothesis or a test (num_nonnulls CHECK, mirroring the
 * source_citations link pattern but strictly exclusive). Optional
 * manual provenance (chunk_id + excerpt) is stored only when the
 * excerpt occurs verbatim in the chunk — enforced by the service
 * layer, with a pairing CHECK here as backstop.
 *
 * tool_recommendations: advisory tool suggestions with an optional
 * test link and optional manual chunk pointer (no excerpt: tools
 * cite a passage by reference only).
 *
 * Deliberately absent: price, stock, availability, image, supplier
 * columns. Supplier catalogues are a later integration; what the
 * schema cannot store cannot be fabricated.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table part_recommendations (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null references diagnostic_sessions (id) on delete cascade,
      hypothesis_id uuid references diagnostic_hypotheses (id) on delete cascade,
      test_id uuid references diagnostic_tests (id) on delete cascade,
      part_name text not null check (char_length(part_name) between 1 and 300),
      part_number text,
      manufacturer text,
      model_compat text,
      chunk_id uuid references document_chunks (id),
      excerpt text,
      status text not null default 'proposed'
        check (status in ('proposed', 'accepted', 'dismissed')),
      created_at timestamptz not null default now(),
      check (num_nonnulls(hypothesis_id, test_id) = 1),
      check ((chunk_id is null) = (excerpt is null))
    );
  `.execute(db);
  await sql`create index part_recommendations_session_id_idx on part_recommendations (session_id);`.execute(
    db,
  );

  await sql`
    create table tool_recommendations (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null references diagnostic_sessions (id) on delete cascade,
      test_id uuid references diagnostic_tests (id) on delete cascade,
      tool_name text not null check (char_length(tool_name) between 1 and 300),
      spec text,
      chunk_id uuid references document_chunks (id),
      status text not null default 'proposed'
        check (status in ('proposed', 'accepted', 'dismissed')),
      created_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index tool_recommendations_session_id_idx on tool_recommendations (session_id);`.execute(
    db,
  );
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists tool_recommendations;`.execute(db);
  await sql`drop table if exists part_recommendations;`.execute(db);
}
