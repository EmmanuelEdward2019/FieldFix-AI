import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/** 002 — hypotheses, diagnostic tests, test results, workflow events. */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table diagnostic_hypotheses (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null references diagnostic_sessions (id) on delete cascade,
      title text not null,
      description text,
      supporting_observations jsonb not null default '[]'::jsonb,
      contradicting_observations jsonb not null default '[]'::jsonb,
      confidence_label text not null check (confidence_label in ('low', 'medium', 'high')),
      confidence_rationale text,
      status text not null default 'proposed'
        check (status in ('proposed', 'supported', 'weakened', 'ruled_out', 'verified')),
      suggested_next_test_id uuid,
      verified_by_test_result_id uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index diagnostic_hypotheses_session_id_idx on diagnostic_hypotheses (session_id);`.execute(db);
  await sql`create index diagnostic_hypotheses_status_idx on diagnostic_hypotheses (status);`.execute(db);
  await sql`
    create trigger diagnostic_hypotheses_set_updated_at
      before update on diagnostic_hypotheses
      for each row execute function set_updated_at();
  `.execute(db);

  await sql`
    create table hypothesis_evidence (
      id uuid primary key default gen_random_uuid(),
      hypothesis_id uuid not null references diagnostic_hypotheses (id) on delete cascade,
      evidence_file_id uuid references evidence_files (id) on delete cascade,
      observation_id uuid references evidence_observations (id) on delete cascade,
      created_at timestamptz not null default now(),
      check (
        (evidence_file_id is not null and observation_id is null)
        or (evidence_file_id is null and observation_id is not null)
      )
    );
  `.execute(db);
  await sql`
    create unique index hypothesis_evidence_file_uniq
      on hypothesis_evidence (hypothesis_id, evidence_file_id)
      where evidence_file_id is not null;
  `.execute(db);
  await sql`
    create unique index hypothesis_evidence_observation_uniq
      on hypothesis_evidence (hypothesis_id, observation_id)
      where observation_id is not null;
  `.execute(db);

  await sql`
    create table diagnostic_tests (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null references diagnostic_sessions (id) on delete cascade,
      name text not null,
      objective text not null,
      rationale text,
      required_tools text[] not null default '{}',
      skill_level text not null check (skill_level in ('beginner', 'intermediate', 'advanced')),
      safety_classification text not null default 'safe'
        check (safety_classification in ('safe', 'caution', 'blocked')),
      instructions jsonb not null,
      expected_outcomes text,
      result_options jsonb not null,
      status text not null default 'pending'
        check (status in ('pending', 'awaiting_result', 'completed', 'skipped', 'blocked')),
      position integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index diagnostic_tests_session_id_idx on diagnostic_tests (session_id);`.execute(db);
  await sql`
    create trigger diagnostic_tests_set_updated_at
      before update on diagnostic_tests
      for each row execute function set_updated_at();
  `.execute(db);

  await sql`
    create table test_results (
      id uuid primary key default gen_random_uuid(),
      test_id uuid not null unique references diagnostic_tests (id) on delete cascade,
      session_id uuid not null references diagnostic_sessions (id) on delete cascade,
      selected_option text not null,
      observation text,
      reported_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index test_results_session_id_idx on test_results (session_id);`.execute(db);

  // Deferred FKs: hypotheses reference tests and results created above.
  await sql`
    alter table diagnostic_hypotheses
      add constraint diagnostic_hypotheses_suggested_test_fk
      foreign key (suggested_next_test_id)
      references diagnostic_tests (id) on delete set null;
  `.execute(db);
  await sql`
    alter table diagnostic_hypotheses
      add constraint diagnostic_hypotheses_verified_result_fk
      foreign key (verified_by_test_result_id)
      references test_results (id) on delete set null;
  `.execute(db);

  await sql`
    create table diagnostic_events (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null references diagnostic_sessions (id) on delete cascade,
      event_type text not null,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index diagnostic_events_session_id_idx on diagnostic_events (session_id, created_at);`.execute(db);
  await sql`
    create trigger diagnostic_events_no_mutation
      before update or delete on diagnostic_events
      for each row execute function prevent_mutation();
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists diagnostic_events;`.execute(db);
  await sql`drop table if exists test_results;`.execute(db);
  await sql`drop table if exists diagnostic_tests;`.execute(db);
  await sql`drop table if exists hypothesis_evidence;`.execute(db);
  await sql`drop table if exists diagnostic_hypotheses;`.execute(db);
}
