import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/**
 * 005 — let append-only tables participate in FK cascades.
 *
 * prevent_mutation() blocked every delete, including rows removed by
 * ON DELETE CASCADE when a parent session is deleted. Direct writes
 * run at trigger depth 1; cascaded FK actions run deeper, so the
 * trigger now only rejects depth-1 mutations. Audit history still
 * cannot be edited or wiped directly.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create or replace function prevent_mutation()
    returns trigger language plpgsql as $$
    begin
      if pg_trigger_depth() > 1 then
        return old;
      end if;
      raise exception 'table % is append-only', TG_TABLE_NAME;
    end;
    $$;
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    create or replace function prevent_mutation()
    returns trigger language plpgsql as $$
    begin
      raise exception 'table % is append-only', TG_TABLE_NAME;
    end;
    $$;
  `.execute(db);
}
