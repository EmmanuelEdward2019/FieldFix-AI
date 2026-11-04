import "dotenv/config";
import { sql, type Kysely } from "kysely";
import { closeDb, createDb, type Database } from "../../src/db/database.js";
import { migrateToLatest } from "../../src/db/migrator.js";

const TABLES = [
  "diagnostic_sessions",
  "evidence_files",
  "evidence_observations",
  "evidence_annotations",
  "diagnostic_hypotheses",
  "hypothesis_evidence",
  "diagnostic_tests",
  "test_results",
  "diagnostic_events",
  "technical_documents",
  "document_chunks",
  "source_citations",
  "safety_events",
  "repair_reports",
  "model_runs",
  "ingestion_jobs",
  "user_sessions",
  "user_email_tokens",
  "user_mfa",
  "user_mfa_backup_codes",
  "user_mfa_challenges",
  "users",
  "admin_audit_logs",
  "rate_limit_windows",
  "platform_settings",
  "safety_incident_reviews",
  "notification_records",
  "voice_preferences",
  "voice_interactions",
  "speech_transcriptions",
  "part_recommendations",
  "tool_recommendations",
  "technician_profiles",
  "technician_contact_requests",
  "shared_diagnostic_handoffs",
  "shops",
  "shop_members",
  "shop_customers",
  "customer_devices",
  "repair_jobs",
  "repair_job_events",
  "repair_estimates",
  "repair_estimate_items",
  "inventory_items",
  "inventory_movements",
  "suppliers",
  "supplier_products",
  "evidence_identifications",
];

const SETTING_SEEDS: [string, string][] = [
  ["platform_name", '"FieldFix AI"'],
  ["support_contact", '"support@fieldfix.ai"'],
  ["demo_enabled", "true"],
  ["ai.meta.enabled", "true"],
  ["ai.sam.enabled", "true"],
  ["ai.voice.enabled", "true"],
];

/**
 * Open the integration-test database and migrate it to latest. Fails
 * fast when DATABASE_URL_TEST is unset — these tests never silently
 * skip and never fall back to another database.
 */
export async function setupTestDb(): Promise<Kysely<Database>> {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error(
      "DATABASE_URL_TEST is not set. Integration tests need a real PostgreSQL " +
        "database (see docs/DATABASE.md). Refusing to run against a fallback.",
    );
  }
  const db = createDb(url, 5);
  await migrateToLatest(db);
  return db;
}

export async function truncateAll(db: Kysely<Database>): Promise<void> {
  await sql`truncate table ${sql.join(TABLES.map((t) => sql.ref(t)))} restart identity cascade`.execute(
    db,
  );
  // Restore migration-seeded platform defaults.
  for (const [key, value] of SETTING_SEEDS) {
    await sql`insert into platform_settings (key, value) values (${key}, ${value}::jsonb)`.execute(
      db,
    );
  }
}

export async function teardownTestDb(
  db: Kysely<Database> | undefined,
): Promise<void> {
  if (db) {
    await closeDb(db);
  }
}
