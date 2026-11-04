import type { CreateSafetyEvent } from "@fieldfix/contracts";
import type { Db, SafetyEvent } from "../database.js";

/** Append-only safety audit log. Updates/deletes are rejected by the DB. */
export class SafetyEventRepository {
  constructor(private readonly db: Db) {}

  async append(
    sessionId: string,
    input: CreateSafetyEvent,
  ): Promise<SafetyEvent> {
    return this.db
      .insertInto("safety_events")
      .values({
        session_id: sessionId,
        previous_state: input.previous_state,
        new_state: input.new_state,
        trigger_type: input.trigger_type,
        trigger_detail: input.trigger_detail ?? null,
        evidence_file_id: input.evidence_file_id ?? null,
        blocked_action: input.blocked_action ?? null,
        safe_next_steps: input.safe_next_steps,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listBySession(sessionId: string): Promise<SafetyEvent[]> {
    return this.db
      .selectFrom("safety_events")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async getLatest(sessionId: string): Promise<SafetyEvent | undefined> {
    return this.db
      .selectFrom("safety_events")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();
  }

  async getById(id: string): Promise<SafetyEvent | undefined> {
    return this.db
      .selectFrom("safety_events")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /**
   * Record an administrative review note. Reviews never alter the
   * safety event or release any restriction — they only document
   * that a human looked at the incident.
   */
  async upsertReview(
    safetyEventId: string,
    reviewedBy: string | null,
    note: string,
  ): Promise<void> {
    await this.db
      .insertInto("safety_incident_reviews")
      .values({ safety_event_id: safetyEventId, reviewed_by: reviewedBy, note })
      .onConflict((oc) =>
        oc.column("safety_event_id").doUpdateSet((eb) => ({
          reviewed_by: eb.ref("excluded.reviewed_by"),
          note: eb.ref("excluded.note"),
        })),
      )
      .execute();
  }
}
