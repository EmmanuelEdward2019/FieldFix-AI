import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/**
 * 017 — technician directory ("Contact Technicians Near Me").
 *
 * technician_profiles: opt-in public directory cards, one per user.
 * Coordinates are nullable: only technicians who opt into
 * geo-discovery set them. Contact PII (phone/contact_email/
 * whatsapp) is nullable: returned on the card only when set, never
 * in list results (enforced by the serializers, which project the
 * two shapes separately). `verified` is the only trust signal —
 * admin-managed, default false. No rating/review columns exist.
 *
 * technician_contact_requests: customer → technician contact
 * requests. A request may reference a diagnostic session, but the
 * session's evidence is NOT shared by default (see handoffs below).
 *
 * shared_diagnostic_handoffs: explicit, per-request consent records.
 * shared_evidence_ids is an allowlist of evidence file ids the
 * requester chose to share; shared_report gates the repair report.
 * The handoff read path returns ONLY consented rows.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table technician_profiles (
      user_id uuid primary key references users (id) on delete cascade,
      display_name text not null check (char_length(display_name) between 1 and 200),
      city text not null check (char_length(city) between 1 and 200),
      region text not null check (char_length(region) between 1 and 200),
      postal_code text,
      latitude double precision check (latitude between -90 and 90),
      longitude double precision check (longitude between -180 and 180),
      specialties text[] not null default '{}',
      device_types text[] not null default '{}',
      phone text,
      contact_email text,
      whatsapp text,
      about text,
      accepting_requests boolean not null default true,
      verified boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check ((latitude is null) = (longitude is null))
    );
  `.execute(db);
  await sql`
    create trigger technician_profiles_set_updated_at
      before update on technician_profiles
      for each row execute function set_updated_at();
  `.execute(db);
  await sql`create index technician_profiles_accepting_idx on technician_profiles (accepting_requests) where accepting_requests;`.execute(
    db,
  );
  await sql`create index technician_profiles_city_region_idx on technician_profiles (city, region);`.execute(
    db,
  );

  await sql`
    create table technician_contact_requests (
      id uuid primary key default gen_random_uuid(),
      session_id uuid references diagnostic_sessions (id) on delete cascade,
      requester_user_id uuid references users (id) on delete set null,
      technician_user_id uuid not null references users (id) on delete cascade,
      message text not null check (char_length(message) between 1 and 2000),
      contact_method text,
      preferred_time text,
      status text not null default 'submitted'
        check (status in ('submitted', 'awaiting_response', 'accepted', 'declined', 'customer_contacted', 'in_progress', 'completed', 'cancelled')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`
    create trigger technician_contact_requests_set_updated_at
      before update on technician_contact_requests
      for each row execute function set_updated_at();
  `.execute(db);
  await sql`create index technician_contact_requests_tech_idx on technician_contact_requests (technician_user_id, created_at desc);`.execute(
    db,
  );
  await sql`create index technician_contact_requests_requester_idx on technician_contact_requests (requester_user_id, created_at desc);`.execute(
    db,
  );

  await sql`
    create table shared_diagnostic_handoffs (
      id uuid primary key default gen_random_uuid(),
      request_id uuid not null references technician_contact_requests (id) on delete cascade,
      session_id uuid not null references diagnostic_sessions (id) on delete cascade,
      shared_evidence_ids jsonb not null default '[]',
      shared_report boolean not null default false,
      created_by_user_id uuid not null references users (id),
      created_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index shared_diagnostic_handoffs_request_idx on shared_diagnostic_handoffs (request_id, created_at desc);`.execute(
    db,
  );
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists shared_diagnostic_handoffs;`.execute(db);
  await sql`drop table if exists technician_contact_requests;`.execute(db);
  await sql`drop table if exists technician_profiles;`.execute(db);
}
