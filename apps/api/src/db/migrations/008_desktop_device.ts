import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/**
 * 008 — widen the diagnostic_sessions device_type check to include
 * 'desktop'. The 001 constraint carries Postgres's default name
 * (diagnostic_sessions_device_type_check); drop it if present, then
 * add the widened one. Down requires no desktop rows to exist.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table diagnostic_sessions drop constraint if exists diagnostic_sessions_device_type_check;`.execute(
    db,
  );
  await sql`alter table diagnostic_sessions add constraint diagnostic_sessions_device_type_check check (device_type in ('laptop', 'desktop', 'smartphone'));`.execute(
    db,
  );
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`alter table diagnostic_sessions drop constraint if exists diagnostic_sessions_device_type_check;`.execute(
    db,
  );
  await sql`alter table diagnostic_sessions add constraint diagnostic_sessions_device_type_check check (device_type in ('laptop', 'smartphone'));`.execute(
    db,
  );
}
