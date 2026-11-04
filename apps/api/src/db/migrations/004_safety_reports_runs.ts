import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/** 004 — safety events, repair reports, model runs, annotation provenance. */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table safety_events (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null references diagnostic_sessions (id) on delete cascade,
      previous_state text not null
        check (previous_state in ('normal', 'caution', 'critical_stop', 'review_required')),
      new_state text not null
        check (new_state in ('normal', 'caution', 'critical_stop', 'review_required')),
      trigger_type text not null
        check (trigger_type in ('user_report', 'model_finding', 'policy_rule')),
      trigger_detail text,
      evidence_file_id uuid references evidence_files (id) on delete set null,
      blocked_action text,
      safe_next_steps text not null,
      created_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index safety_events_session_id_idx on safety_events (session_id, created_at);`.execute(db);
  await sql`
    create trigger safety_events_no_mutation
      before update or delete on safety_events
      for each row execute function prevent_mutation();
  `.execute(db);

  await sql`
    create table repair_reports (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null references diagnostic_sessions (id) on delete cascade,
      status text not null default 'draft'
        check (status in ('draft', 'ready', 'failed')),
      report_data jsonb not null,
      error_message text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index repair_reports_session_id_idx on repair_reports (session_id);`.execute(db);
  await sql`
    create trigger repair_reports_set_updated_at
      before update on repair_reports
      for each row execute function set_updated_at();
  `.execute(db);

  await sql`
    create table model_runs (
      id uuid primary key default gen_random_uuid(),
      session_id uuid references diagnostic_sessions (id) on delete cascade,
      provider text not null,
      model_id text not null,
      task_type text not null
        check (task_type in ('diagnosis', 'segmentation', 'safety_screen', 'transcription', 'illustration', 'other')),
      status text not null default 'pending'
        check (status in ('pending', 'running', 'succeeded', 'failed', 'timeout')),
      latency_ms integer check (latency_ms is null or latency_ms >= 0),
      prompt_tokens integer check (prompt_tokens is null or prompt_tokens >= 0),
      completion_tokens integer check (completion_tokens is null or completion_tokens >= 0),
      request_id text,
      error_category text,
      error_message text,
      origin text not null default 'live' check (origin in ('live', 'demo', 'eval')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index model_runs_session_id_idx on model_runs (session_id);`.execute(db);
  await sql`create index model_runs_request_id_idx on model_runs (request_id);`.execute(db);
  await sql`
    create trigger model_runs_set_updated_at
      before update on model_runs
      for each row execute function set_updated_at();
  `.execute(db);

  // Deferred FK: annotations reference the model run that produced them.
  await sql`
    alter table evidence_annotations
      add constraint evidence_annotations_model_run_fk
      foreign key (model_run_id)
      references model_runs (id) on delete set null;
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table evidence_annotations
      drop constraint if exists evidence_annotations_model_run_fk;
  `.execute(db);
  await sql`drop table if exists model_runs;`.execute(db);
  await sql`drop table if exists repair_reports;`.execute(db);
  await sql`drop table if exists safety_events;`.execute(db);
}
