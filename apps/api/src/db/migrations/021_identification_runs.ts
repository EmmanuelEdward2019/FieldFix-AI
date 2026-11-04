import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/**
 * 021 — admit the 'identification' model-run task type.
 * Visual component identification records task-typed runs like
 * every other model call; the 004 CHECK list must include it.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table model_runs
      drop constraint model_runs_task_type_check,
      add constraint model_runs_task_type_check check (
        task_type in (
          'diagnosis',
          'segmentation',
          'identification',
          'safety_screen',
          'transcription',
          'illustration',
          'other'
        )
      );
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`delete from model_runs where task_type = 'identification';`.execute(db);
  await sql`
    alter table model_runs
      drop constraint model_runs_task_type_check,
      add constraint model_runs_task_type_check check (
        task_type in (
          'diagnosis',
          'segmentation',
          'safety_screen',
          'transcription',
          'illustration',
          'other'
        )
      );
  `.execute(db);
}
