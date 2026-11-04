import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/** 003 — technical documents, chunks with full-text search, citations. */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table technical_documents (
      id uuid primary key default gen_random_uuid(),
      title text not null,
      manufacturer text,
      device_family text,
      model_numbers text[] not null default '{}',
      document_type text not null
        check (document_type in ('service_manual', 'user_manual', 'safety_notice', 'repair_guide', 'other')),
      source_name text not null,
      source_url text,
      version text,
      language text not null default 'en',
      licence_name text,
      permission_status text not null default 'pending'
        check (permission_status in ('pending', 'approved', 'restricted', 'rejected')),
      storage_key text,
      ingestion_status text not null default 'pending'
        check (ingestion_status in ('pending', 'processing', 'indexed', 'failed')),
      ingestion_error text,
      checksum_sha256 text unique,
      is_demo boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index technical_documents_permission_idx on technical_documents (permission_status);`.execute(db);
  await sql`create index technical_documents_ingestion_idx on technical_documents (ingestion_status);`.execute(db);
  await sql`create index technical_documents_manufacturer_idx on technical_documents (manufacturer);`.execute(db);
  await sql`
    create trigger technical_documents_set_updated_at
      before update on technical_documents
      for each row execute function set_updated_at();
  `.execute(db);

  await sql`
    create table document_chunks (
      id uuid primary key default gen_random_uuid(),
      document_id uuid not null references technical_documents (id) on delete cascade,
      chunk_index integer not null,
      page_number integer check (page_number is null or page_number > 0),
      heading text,
      content text not null,
      safety_tags text[] not null default '{}',
      component_tags text[] not null default '{}',
      model_applicability text[] not null default '{}',
      search_vector tsvector
        generated always as (to_tsvector('english', coalesce(heading, '') || ' ' || content)) stored,
      created_at timestamptz not null default now(),
      unique (document_id, chunk_index)
    );
  `.execute(db);
  await sql`create index document_chunks_document_id_idx on document_chunks (document_id);`.execute(db);
  await sql`create index document_chunks_search_idx on document_chunks using gin (search_vector);`.execute(db);

  await sql`
    create table source_citations (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null references diagnostic_sessions (id) on delete cascade,
      hypothesis_id uuid references diagnostic_hypotheses (id) on delete cascade,
      test_id uuid references diagnostic_tests (id) on delete cascade,
      chunk_id uuid not null references document_chunks (id),
      excerpt text not null,
      note text,
      created_at timestamptz not null default now(),
      check (hypothesis_id is not null or test_id is not null)
    );
  `.execute(db);
  await sql`create index source_citations_session_id_idx on source_citations (session_id);`.execute(db);
  await sql`create index source_citations_chunk_id_idx on source_citations (chunk_id);`.execute(db);
  await sql`create index source_citations_hypothesis_id_idx on source_citations (hypothesis_id);`.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists source_citations;`.execute(db);
  await sql`drop table if exists document_chunks;`.execute(db);
  await sql`drop table if exists technical_documents;`.execute(db);
}
