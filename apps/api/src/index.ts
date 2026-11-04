import "dotenv/config";
import type { Kysely } from "kysely";
import { createApp } from "./app.js";
import { closeDb, createDb, type Database } from "./db/database.js";
import { loadEnv } from "./env.js";
import { createStorageFromEnv } from "./storage/index.js";

const env = loadEnv();
const storage = createStorageFromEnv(env);

let db: Kysely<Database> | undefined;
if (env.DATABASE_URL) {
  db = createDb(env.DATABASE_URL);
} else {
  console.warn(
    "DATABASE_URL is not set: /api/v1/sessions routes will return 503.",
  );
}

const app = createApp(env, { db, storage });

const server = app.listen(env.PORT, () => {
  console.log(
    `fieldfix-api listening on http://localhost:${env.PORT} (env=${env.NODE_ENV})`,
  );
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}, shutting down.`);
  server.close(() => {
    void (db ? closeDb(db) : Promise.resolve()).finally(() =>
      process.exit(0),
    );
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
