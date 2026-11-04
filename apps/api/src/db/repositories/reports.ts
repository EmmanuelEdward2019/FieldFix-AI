import type {
  CreateReport,
  ReportStatus,
} from "@fieldfix/contracts";
import type { Db, DiagnosticSession, RepairReport } from "../database.js";
import { jsonb } from "../database.js";

export class ReportRepository {
  constructor(private readonly db: Db) {}

  async create(
    sessionId: string,
    input: CreateReport,
  ): Promise<RepairReport> {
    return this.db
      .insertInto("repair_reports")
      .values({
        session_id: sessionId,
        status: input.status,
        report_data: jsonb(input.report_data),
        error_message: input.error_message ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getById(id: string): Promise<RepairReport | undefined> {
    return this.db
      .selectFrom("repair_reports")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async listBySession(sessionId: string): Promise<RepairReport[]> {
    return this.db
      .selectFrom("repair_reports")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async getLatest(sessionId: string): Promise<RepairReport | undefined> {
    return this.db
      .selectFrom("repair_reports")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();
  }

  async listByUser(
    userId: string,
    limit = 100,
  ): Promise<
    Array<{
      id: string;
      session_id: string;
      status: RepairReport["status"];
      device_type: DiagnosticSession["device_type"];
      manufacturer: string | null;
      model: string | null;
      symptoms: string;
      created_at: RepairReport["created_at"];
    }>
  > {
    return this.db
      .selectFrom("repair_reports as r")
      .innerJoin("diagnostic_sessions as s", "s.id", "r.session_id")
      .select([
        "r.id",
        "r.session_id",
        "r.status",
        "s.device_type",
        "s.manufacturer",
        "s.model",
        "s.symptoms",
        "r.created_at",
      ])
      .where("s.user_id", "=", userId)
      .orderBy("r.created_at", "desc")
      .limit(limit)
      .execute();
  }

  async markStatus(
    id: string,
    status: ReportStatus,
    errorMessage: string | null = null,
  ): Promise<RepairReport | undefined> {
    return this.db
      .updateTable("repair_reports")
      .set({ status, error_message: errorMessage })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }
}
