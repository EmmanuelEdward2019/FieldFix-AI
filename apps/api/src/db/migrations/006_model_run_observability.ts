import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/**
 * 006 — model-run observability for the Meta reasoning integration:
 * diagnostic stage, input modalities, response-validation status, and
 * the provider's response id for traceability. Metadata only — no
 * prompts, images, or credentials.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table model_runs
      add column diagnostic_stage text,
      add column input_modality text[] not null default '{}',
      add column validation_status text not null default 'pending'
        check (validation_status in ('pending', 'passed', 'failed', 'not_applicable')),
      add column provider_response_id text;
  `.execute(db);
  await sql`create index model_runs_provider_response_id_idx on model_runs (provider_response_id);`.execute(
    db,
  );
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop index if exists model_runs_provider_response_id_idx;`.execute(db);
  await sql`
    alter table model_runs
      drop column if exists diagnostic_stage,
      drop column if exists input_modality,
      drop column if exists validation_status,
      drop column if exists provider_response_id;
  `.execute(db);
}
