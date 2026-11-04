import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/**
 * 012 — user-scoped notifications. `user_id` null keeps the existing
 * admin-console rows global; user rows carry their owner's id and are
 * only ever served to that owner. Global `announcement` rows are also
 * visible to signed-in users.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table notification_records
      add column user_id uuid references users (id) on delete cascade;
  `.execute(db);
  await sql`
    create index notification_records_user_idx
      on notification_records (user_id, created_at desc);
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop index if exists notification_records_user_idx;`.execute(db);
  await sql`alter table notification_records drop column if exists user_id;`.execute(db);
}
