import "dotenv/config";
import { closeDb, createDb } from "./database.js";
import { migrateDownOne, migrateToLatest } from "./migrator.js";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "up";
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env and set it (see docs/DATABASE.md).",
    );
    process.exitCode = 1;
    return;
  }
  const db = createDb(url);
  try {
    if (command === "up") {
      const applied = await migrateToLatest(db);
      for (const m of applied) {
        console.log(`migrated up: ${m.name}`);
      }
      if (applied.length === 0) {
        console.log("database is already up to date");
      }
    } else if (command === "down") {
      const reverted = await migrateDownOne(db);
      for (const m of reverted) {
        console.log(`migrated down: ${m.name}`);
      }
      if (reverted.length === 0) {
        console.log("nothing to revert");
      }
    } else {
      console.error(`unknown command: ${command} (expected "up" or "down")`);
      process.exitCode = 1;
    }
  } finally {
    await closeDb(db);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
