import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/**
 * 011 — platform administration. Role + status on users (existing
 * accounts become active technicians), append-only audit logs,
 * platform settings with seeded defaults, safety-incident reviews,
 * and in-app notification records.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table users
      add column role text not null default 'technician'
        check (role in ('super_admin', 'admin', 'operator', 'technician')),
      add column status text not null default 'active'
        check (status in ('active', 'suspended', 'deactivated')),
      add column last_login_at timestamptz;
  `.execute(db);
  await sql`create index users_role_idx on users (role);`.execute(db);
  await sql`create index users_status_idx on users (status);`.execute(db);

  await sql`
    create table admin_audit_logs (
      id uuid primary key default gen_random_uuid(),
      actor_type text not null check (actor_type in ('user', 'token')),
      actor_id text,
      actor_email text,
      action text not null,
      target_type text,
      target_id text,
      outcome text not null check (outcome in ('success', 'denied', 'failed')),
      metadata jsonb not null default '{}',
      ip text,
      created_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index admin_audit_logs_created_idx on admin_audit_logs (created_at desc);`.execute(db);
  await sql`create index admin_audit_logs_actor_idx on admin_audit_logs (actor_id);`.execute(db);
  await sql`create index admin_audit_logs_action_idx on admin_audit_logs (action);`.execute(db);

  await sql`
    create table platform_settings (
      key text primary key,
      value jsonb not null,
      updated_by text,
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`
    insert into platform_settings (key, value) values
      ('platform_name', '"FieldFix AI"'),
      ('support_contact', '"support@fieldfix.ai"'),
      ('demo_enabled', 'true'),
      ('ai.meta.enabled', 'true'),
      ('ai.sam.enabled', 'true');
  `.execute(db);

  await sql`
    create table safety_incident_reviews (
      id uuid primary key default gen_random_uuid(),
      safety_event_id uuid not null unique references safety_events (id) on delete cascade,
      reviewed_by uuid references users (id) on delete set null,
      note text not null,
      created_at timestamptz not null default now()
    );
  `.execute(db);

  await sql`
    create table notification_records (
      id uuid primary key default gen_random_uuid(),
      kind text not null,
      title text not null,
      body text not null,
      link text,
      is_read boolean not null default false,
      created_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index notification_records_created_idx on notification_records (created_at desc);`.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists notification_records;`.execute(db);
  await sql`drop table if exists safety_incident_reviews;`.execute(db);
  await sql`drop table if exists platform_settings;`.execute(db);
  await sql`drop table if exists admin_audit_logs;`.execute(db);
  await sql`alter table users drop column if exists role;`.execute(db);
  await sql`alter table users drop column if exists status;`.execute(db);
  await sql`alter table users drop column if exists last_login_at;`.execute(db);
}
