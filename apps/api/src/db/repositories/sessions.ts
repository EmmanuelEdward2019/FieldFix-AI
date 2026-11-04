import type {
  CreateSession,
  SafetyState,
  SessionStatus,
  UpdateSession,
} from "@fieldfix/contracts";
import type { Db, DiagnosticSession } from "../database.js";

export interface CreateSessionInput extends CreateSession {
  access_token_hash: string;
  is_demo?: boolean;
  user_id?: string | null;
}

export class SessionRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateSessionInput): Promise<DiagnosticSession> {
    return this.db
      .insertInto("diagnostic_sessions")
      .values({
        device_type: input.device_type,
        manufacturer: input.manufacturer ?? null,
        model: input.model ?? null,
        operating_system: input.operating_system ?? null,
        symptoms: input.symptoms,
        problem_started_at: input.problem_started_at ?? null,
        problem_started_note: input.problem_started_note ?? null,
        recent_events: input.recent_events ?? null,
        user_mode: input.user_mode,
        access_token_hash: input.access_token_hash,
        is_demo: input.is_demo ?? false,
        user_id: input.user_id ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getById(id: string): Promise<DiagnosticSession | undefined> {
    return this.db
      .selectFrom("diagnostic_sessions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async listRecent(limit: number): Promise<DiagnosticSession[]> {
    return this.db
      .selectFrom("diagnostic_sessions")
      .selectAll()
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  }

  async listByUser(userId: string, limit = 100): Promise<DiagnosticSession[]> {
    return this.db
      .selectFrom("diagnostic_sessions")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("updated_at", "desc")
      .limit(limit)
      .execute();
  }

  /** Account list with test/evidence counts for progress display. */
  async listByUserWithCounts(
    userId: string,
    limit = 100,
  ): Promise<Array<DiagnosticSession & { test_count: number; tests_recorded: number; evidence_count: number }>> {
    const rows = await this.db
      .selectFrom("diagnostic_sessions as s")
      .selectAll("s")
      .select((eb) => [
        eb
          .selectFrom("diagnostic_tests as t")
          .select((sb) => sb.fn.countAll<number>().as("count"))
          .whereRef("t.session_id", "=", "s.id")
          .as("test_count"),
        eb
          .selectFrom("diagnostic_tests as t")
          .innerJoin("test_results as r", "r.test_id", "t.id")
          .select((sb) => sb.fn.count<number>("t.id").as("count"))
          .whereRef("t.session_id", "=", "s.id")
          .as("tests_recorded"),
        eb
          .selectFrom("evidence_files as f")
          .select((sb) => sb.fn.countAll<number>().as("count"))
          .whereRef("f.session_id", "=", "s.id")
          .as("evidence_count"),
      ])
      .where("s.user_id", "=", userId)
      .orderBy("s.updated_at", "desc")
      .limit(limit)
      .execute();
    return rows.map((row) => ({
      ...row,
      test_count: Number(row.test_count),
      tests_recorded: Number(row.tests_recorded),
      evidence_count: Number(row.evidence_count),
    }));
  }

  async update(
    id: string,
    patch: UpdateSession,
  ): Promise<DiagnosticSession | undefined> {
    if (Object.keys(patch).length === 0) {
      return this.getById(id);
    }
    return this.db
      .updateTable("diagnostic_sessions")
      .set(patch)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  async updateStatus(
    id: string,
    status: SessionStatus,
  ): Promise<DiagnosticSession | undefined> {
    return this.update(id, { status });
  }

  async updateSafetyState(
    id: string,
    safetyState: SafetyState,
  ): Promise<DiagnosticSession | undefined> {
    return this.update(id, { safety_state: safetyState });
  }

  /** Deletes the session; children cascade via foreign keys. */
  async remove(id: string): Promise<void> {
    await this.db
      .deleteFrom("diagnostic_sessions")
      .where("id", "=", id)
      .execute();
  }
}
