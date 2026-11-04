import type { DiagnosticEventInput } from "@fieldfix/contracts";
import type { Db, DiagnosticEvent, Timestamp } from "../database.js";
import { jsonb } from "../database.js";

/** Append-only workflow log. Updates/deletes are rejected by the DB. */
export class EventRepository {
  constructor(private readonly db: Db) {}

  async append(
    sessionId: string,
    input: DiagnosticEventInput,
  ): Promise<DiagnosticEvent> {
    return this.db
      .insertInto("diagnostic_events")
      .values({
        session_id: sessionId,
        event_type: input.event_type,
        payload: jsonb(input.payload),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listBySession(
    sessionId: string,
    limit = 200,
  ): Promise<DiagnosticEvent[]> {
    return this.db
      .selectFrom("diagnostic_events")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "asc")
      .limit(limit)
      .execute();
  }

  /** Recent events across every session the user owns, newest first. */
  async listForUser(
    userId: string,
    limit = 20,
  ): Promise<
    Array<{
      id: string;
      session_id: string;
      event_type: string;
      device_type: string;
      model: string | null;
      created_at: Timestamp;
    }>
  > {
    return this.db
      .selectFrom("diagnostic_events as e")
      .innerJoin("diagnostic_sessions as s", "s.id", "e.session_id")
      .select([
        "e.id",
        "e.session_id",
        "e.event_type",
        "s.device_type",
        "s.model",
        "e.created_at",
      ])
      .where("s.user_id", "=", userId)
      .orderBy("e.created_at", "desc")
      .limit(limit)
      .execute();
  }
}
