import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Kysely } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import type { Database } from "./database.js";

export function createMigrator(db: Kysely<Database>): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      // Resolves under both src/db (tsx) and dist/db (compiled node).
      migrationFolder: path.join(__dirname, "migrations"),
    }),
  });
}

export interface MigrationOutcome {
  name: string;
  direction: "up" | "down";
}

function toOutcomes(
  results: readonly { migrationName: string }[] | undefined,
  direction: "up" | "down",
): MigrationOutcome[] {
  return (results ?? []).map((r) => ({ name: r.migrationName, direction }));
}

/** Apply all pending migrations. Throws if any migration fails. */
export async function migrateToLatest(
  db: Kysely<Database>,
): Promise<MigrationOutcome[]> {
  const { error, results } = await createMigrator(db).migrateToLatest();
  if (error) {
    throw new Error(`Migration failed: ${String(error)}`);
  }
  return toOutcomes(results, "up");
}

/** Revert the most recently applied migration. Throws on failure. */
export async function migrateDownOne(
  db: Kysely<Database>,
): Promise<MigrationOutcome[]> {
  const { error, results } = await createMigrator(db).migrateDown();
  if (error) {
    throw new Error(`Migration rollback failed: ${String(error)}`);
  }
  return toOutcomes(results, "down");
}
