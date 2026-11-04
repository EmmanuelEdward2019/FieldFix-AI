import { sql } from "kysely";
import type { Db } from "../database.js";

/** Curated platform settings (key/value JSON). Unknown keys are rejected. */
export const KNOWN_SETTINGS = [
  "platform_name",
  "support_contact",
  "demo_enabled",
  "ai.meta.enabled",
  "ai.sam.enabled",
  "ai.voice.enabled",
] as const;

export type SettingKey = (typeof KNOWN_SETTINGS)[number];

export class SettingsRepository {
  constructor(private readonly db: Db) {}

  async getAll(): Promise<Record<string, unknown>> {
    const rows = await this.db.selectFrom("platform_settings").selectAll().execute();
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      out[row.key] = row.value;
    }
    return out;
  }

  async get(key: string): Promise<unknown> {
    const row = await this.db
      .selectFrom("platform_settings")
      .selectAll()
      .where("key", "=", key)
      .executeTakeFirst();
    return row?.value;
  }

  async set(key: string, value: unknown, updatedBy: string | null): Promise<void> {
    // JSON-encode: the pg driver sends raw strings verbatim, which jsonb rejects.
    const encoded = sql`cast(${JSON.stringify(value)} as jsonb)`;
    await this.db
      .insertInto("platform_settings")
      .values({ key, value: encoded, updated_by: updatedBy })
      .onConflict((oc) =>
        oc.column("key").doUpdateSet((eb) => ({
          value: eb.ref("excluded.value"),
          updated_by: eb.ref("excluded.updated_by"),
          updated_at: sql`now()`,
        })),
      )
      .execute();
  }
}
