import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/**
 * 015 — voice-guided diagnostics (backend tables).
 *
 * voice_preferences: per-user spoken-response settings.
 * voice_interactions: session-linked conversation log (role + text;
 *   audio bytes are NOT retained in Phase 1 — transcripts only).
 * speech_transcriptions: STT result log. This stores transcript
 *   content; call observability (latency/status) lives in the
 *   existing model_runs table with task_type 'transcription'.
 * Also seeds the ai.voice.enabled kill-switch default.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table voice_preferences (
      user_id uuid primary key references users (id) on delete cascade,
      spoken_responses boolean not null default true,
      voice_id text,
      rate double precision not null default 1
        check (rate >= 0.5 and rate <= 2),
      language text not null default 'en',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`
    create trigger voice_preferences_set_updated_at
      before update on voice_preferences
      for each row execute function set_updated_at();
  `.execute(db);

  await sql`
    create table voice_interactions (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null references diagnostic_sessions (id) on delete cascade,
      user_id uuid references users (id) on delete set null,
      role text not null check (role in ('user', 'assistant')),
      text text not null check (char_length(text) between 1 and 8000),
      audio_storage_key text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index voice_interactions_session_idx on voice_interactions (session_id, created_at);`.execute(
    db,
  );
  await sql`
    create trigger voice_interactions_set_updated_at
      before update on voice_interactions
      for each row execute function set_updated_at();
  `.execute(db);

  await sql`
    create table speech_transcriptions (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null references diagnostic_sessions (id) on delete cascade,
      provider text not null,
      model_id text not null,
      transcript text not null,
      confidence double precision,
      audio_duration_ms integer,
      model_run_id uuid references model_runs (id) on delete set null,
      created_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index speech_transcriptions_session_idx on speech_transcriptions (session_id, created_at);`.execute(
    db,
  );

  await sql`
    insert into platform_settings (key, value) values ('ai.voice.enabled', 'true')
    on conflict (key) do nothing;
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists speech_transcriptions;`.execute(db);
  await sql`drop table if exists voice_interactions;`.execute(db);
  await sql`drop table if exists voice_preferences;`.execute(db);
  await sql`delete from platform_settings where key = 'ai.voice.enabled';`.execute(
    db,
  );
}
