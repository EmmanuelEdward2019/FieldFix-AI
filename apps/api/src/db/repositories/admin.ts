import { sql } from "kysely";
import type { Db } from "../database.js";

export interface UserListFilters {
  q?: string;
  role?: string;
  status?: string;
  sort?: "created_at" | "email" | "name" | "last_login_at";
  dir?: "asc" | "desc";
  limit: number;
  offset: number;
}

export interface SessionListFilters {
  device?: string;
  status?: string;
  safety?: string;
  user?: string;
  from?: string;
  to?: string;
  model?: "succeeded" | "failed" | "none";
  limit: number;
  offset: number;
}

export interface ReportListFilters {
  device?: string;
  status?: string;
  user?: string;
  from?: string;
  to?: string;
  verified?: "yes" | "no";
  limit: number;
  offset: number;
}

export interface EvidenceListFilters {
  device?: string;
  media?: string;
  processing?: string;
  limit: number;
  offset: number;
}

export interface RunListFilters {
  provider?: string;
  model?: string;
  status?: string;
  sessionId?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface SafetyListFilters {
  state?: string;
  trigger?: string;
  reviewed?: "yes" | "no";
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface JobListFilters {
  status?: string;
  limit: number;
  offset: number;
}

/** Cross-cutting admin reads: filtered lists, counts, and aggregates. */
export class AdminRepository {
  constructor(private readonly db: Db) {}

  async listUsers(filters: UserListFilters) {
    const sortCol =
      filters.sort === "email"
        ? "users.email"
        : filters.sort === "name"
          ? "users.name"
          : filters.sort === "last_login_at"
            ? "users.last_login_at"
            : "users.created_at";
    const dir = filters.dir === "asc" ? "asc" : "desc";
    let rowsQuery = this.db
      .selectFrom("users")
      .select([
        "users.id",
        "users.email",
        "users.name",
        "users.role",
        "users.status",
        "users.email_confirmed_at",
        "users.created_at",
        "users.last_login_at",
        (eb) =>
          eb
            .selectFrom("diagnostic_sessions")
            .select((eb2) => eb2.fn.countAll<number>().as("count"))
            .whereRef("diagnostic_sessions.user_id", "=", "users.id")
            .as("session_count"),
      ])
      .orderBy(sortCol, dir)
      .limit(filters.limit)
      .offset(filters.offset);
    let countQuery = this.db
      .selectFrom("users")
      .select((eb) => eb.fn.countAll<number>().as("count"));
    if (filters.q) {
      const q = `%${filters.q}%`;
      rowsQuery = rowsQuery.where((eb) =>
        eb.or([eb("users.email", "ilike", q), eb("users.name", "ilike", q)]),
      );
      countQuery = countQuery.where((eb) =>
        eb.or([eb("users.email", "ilike", q), eb("users.name", "ilike", q)]),
      );
    }
    if (filters.role) {
      rowsQuery = rowsQuery.where("users.role", "=", filters.role as "technician");
      countQuery = countQuery.where("users.role", "=", filters.role as "technician");
    }
    if (filters.status) {
      rowsQuery = rowsQuery.where("users.status", "=", filters.status as "active");
      countQuery = countQuery.where("users.status", "=", filters.status as "active");
    }
    const [rows, countRow] = await Promise.all([
      rowsQuery.execute(),
      countQuery.executeTakeFirst(),
    ]);
    return { rows, total: Number(countRow?.count ?? 0) };
  }

  async getUserDetail(userId: string) {
    const user = await this.db
      .selectFrom("users")
      .selectAll()
      .where("id", "=", userId)
      .executeTakeFirst();
    if (!user) {
      return null;
    }
    const sessions = await this.db
      .selectFrom("diagnostic_sessions")
      .select([
        "id",
        "device_type",
        "manufacturer",
        "model",
        "status",
        "safety_state",
        "created_at",
        "updated_at",
      ])
      .where("user_id", "=", userId)
      .orderBy("updated_at", "desc")
      .limit(50)
      .execute();
    const reports = await this.db
      .selectFrom("repair_reports")
      .innerJoin(
        "diagnostic_sessions",
        "diagnostic_sessions.id",
        "repair_reports.session_id",
      )
      .select([
        "repair_reports.id",
        "repair_reports.session_id",
        "repair_reports.status",
        "repair_reports.created_at",
        "diagnostic_sessions.device_type",
      ])
      .where("diagnostic_sessions.user_id", "=", userId)
      .orderBy("repair_reports.created_at", "desc")
      .limit(50)
      .execute();
    return { user, sessions, reports };
  }

  async listSessions(filters: SessionListFilters) {
    let rowsQuery = this.db
      .selectFrom("diagnostic_sessions")
      .leftJoin("users", "users.id", "diagnostic_sessions.user_id")
      .select([
        "diagnostic_sessions.id",
        "diagnostic_sessions.device_type",
        "diagnostic_sessions.manufacturer",
        "diagnostic_sessions.model",
        "diagnostic_sessions.symptoms",
        "diagnostic_sessions.status",
        "diagnostic_sessions.safety_state",
        "diagnostic_sessions.created_at",
        "diagnostic_sessions.updated_at",
        "users.email as user_email",
        (eb) =>
          eb
            .selectFrom("evidence_files")
            .select((eb2) => eb2.fn.countAll<number>().as("count"))
            .whereRef("evidence_files.session_id", "=", "diagnostic_sessions.id")
            .as("evidence_count"),
        (eb) =>
          eb
            .selectFrom("diagnostic_hypotheses")
            .select((eb2) => eb2.fn.countAll<number>().as("count"))
            .whereRef("diagnostic_hypotheses.session_id", "=", "diagnostic_sessions.id")
            .as("hypothesis_count"),
        (eb) =>
          eb
            .selectFrom("diagnostic_tests")
            .select((eb2) => eb2.fn.countAll<number>().as("count"))
            .whereRef("diagnostic_tests.session_id", "=", "diagnostic_sessions.id")
            .as("test_count"),
        (eb) =>
          eb
            .selectFrom("model_runs")
            .select((eb2) => eb2.fn.countAll<number>().as("count"))
            .whereRef("model_runs.session_id", "=", "diagnostic_sessions.id")
            .as("model_run_count"),
      ])
      .orderBy("diagnostic_sessions.updated_at", "desc")
      .limit(filters.limit)
      .offset(filters.offset);
    let countQuery = this.db
      .selectFrom("diagnostic_sessions")
      .leftJoin("users", "users.id", "diagnostic_sessions.user_id")
      .select((eb) => eb.fn.countAll<number>().as("count"));

    if (filters.device) {
      const device = filters.device as "laptop";
      rowsQuery = rowsQuery.where("diagnostic_sessions.device_type", "=", device);
      countQuery = countQuery.where("diagnostic_sessions.device_type", "=", device);
    }
    if (filters.status) {
      const status = filters.status as "open";
      rowsQuery = rowsQuery.where("diagnostic_sessions.status", "=", status);
      countQuery = countQuery.where("diagnostic_sessions.status", "=", status);
    }
    if (filters.safety) {
      const safety = filters.safety as "normal";
      rowsQuery = rowsQuery.where("diagnostic_sessions.safety_state", "=", safety);
      countQuery = countQuery.where("diagnostic_sessions.safety_state", "=", safety);
    }
    if (filters.user) {
      const like = `%${filters.user}%`;
      rowsQuery = rowsQuery.where((eb) =>
        eb.or([eb("users.email", "ilike", like), eb("users.name", "ilike", like)]),
      );
      countQuery = countQuery.where((eb) =>
        eb.or([eb("users.email", "ilike", like), eb("users.name", "ilike", like)]),
      );
    }
    if (filters.from) {
      const from = new Date(filters.from).toISOString();
      rowsQuery = rowsQuery.where(sql<boolean>`diagnostic_sessions.created_at >= ${from}`);
      countQuery = countQuery.where(sql<boolean>`diagnostic_sessions.created_at >= ${from}`);
    }
    if (filters.to) {
      const to = new Date(filters.to).toISOString();
      rowsQuery = rowsQuery.where(sql<boolean>`diagnostic_sessions.created_at <= ${to}`);
      countQuery = countQuery.where(sql<boolean>`diagnostic_sessions.created_at <= ${to}`);
    }
    if (filters.model === "none") {
      rowsQuery = rowsQuery.where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom("model_runs")
              .select("model_runs.id")
              .whereRef("model_runs.session_id", "=", "diagnostic_sessions.id"),
          ),
        ),
      );
      countQuery = countQuery.where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom("model_runs")
              .select("model_runs.id")
              .whereRef("model_runs.session_id", "=", "diagnostic_sessions.id"),
          ),
        ),
      );
    } else if (filters.model === "succeeded" || filters.model === "failed") {
      const status = filters.model;
      rowsQuery = rowsQuery.where((eb) =>
        eb.exists(
          eb
            .selectFrom("model_runs")
            .select("model_runs.id")
            .whereRef("model_runs.session_id", "=", "diagnostic_sessions.id")
            .where("model_runs.status", "=", status),
        ),
      );
      countQuery = countQuery.where((eb) =>
        eb.exists(
          eb
            .selectFrom("model_runs")
            .select("model_runs.id")
            .whereRef("model_runs.session_id", "=", "diagnostic_sessions.id")
            .where("model_runs.status", "=", status),
        ),
      );
    }
    const [rows, countRow] = await Promise.all([
      rowsQuery.execute(),
      countQuery.executeTakeFirst(),
    ]);
    // Last model-run status per session (one extra query over the page).
    const ids = rows.map((r) => r.id);
    const lastRuns =
      ids.length === 0
        ? []
        : await this.db
            .selectFrom("model_runs")
            .select(["session_id", "status", "created_at"])
            .where("session_id", "in", ids)
            .orderBy("created_at", "desc")
            .execute();
    const lastBySession = new Map<string, string>();
    for (const run of lastRuns) {
      if (run.session_id && !lastBySession.has(run.session_id)) {
        lastBySession.set(run.session_id, run.status);
      }
    }
    return {
      rows: rows.map((r) => ({
        ...r,
        last_model_status: lastBySession.get(r.id) ?? null,
      })),
      total: Number(countRow?.count ?? 0),
    };
  }

  async listReports(filters: ReportListFilters) {
    let rowsQuery = this.db
      .selectFrom("repair_reports")
      .innerJoin("diagnostic_sessions", "diagnostic_sessions.id", "repair_reports.session_id")
      .leftJoin("users", "users.id", "diagnostic_sessions.user_id")
      .select([
        "repair_reports.id",
        "repair_reports.session_id",
        "repair_reports.status",
        "repair_reports.report_data",
        "repair_reports.created_at",
        "diagnostic_sessions.device_type",
        "diagnostic_sessions.manufacturer",
        "diagnostic_sessions.model",
        "users.email as user_email",
      ])
      .orderBy("repair_reports.created_at", "desc")
      .limit(filters.limit)
      .offset(filters.offset);
    let countQuery = this.db
      .selectFrom("repair_reports")
      .innerJoin("diagnostic_sessions", "diagnostic_sessions.id", "repair_reports.session_id")
      .leftJoin("users", "users.id", "diagnostic_sessions.user_id")
      .select((eb) => eb.fn.countAll<number>().as("count"));
    if (filters.device) {
      const device = filters.device as "laptop";
      rowsQuery = rowsQuery.where("diagnostic_sessions.device_type", "=", device);
      countQuery = countQuery.where("diagnostic_sessions.device_type", "=", device);
    }
    if (filters.status) {
      const status = filters.status as "ready";
      rowsQuery = rowsQuery.where("repair_reports.status", "=", status);
      countQuery = countQuery.where("repair_reports.status", "=", status);
    }
    if (filters.user) {
      const like = `%${filters.user}%`;
      rowsQuery = rowsQuery.where("users.email", "ilike", like);
      countQuery = countQuery.where("users.email", "ilike", like);
    }
    if (filters.from) {
      const from = new Date(filters.from).toISOString();
      rowsQuery = rowsQuery.where(sql<boolean>`repair_reports.created_at >= ${from}`);
      countQuery = countQuery.where(sql<boolean>`repair_reports.created_at >= ${from}`);
    }
    if (filters.to) {
      const to = new Date(filters.to).toISOString();
      rowsQuery = rowsQuery.where(sql<boolean>`repair_reports.created_at <= ${to}`);
      countQuery = countQuery.where(sql<boolean>`repair_reports.created_at <= ${to}`);
    }
    const [rows, countRow] = await Promise.all([
      rowsQuery.execute(),
      countQuery.executeTakeFirst(),
    ]);
    let mapped = rows.map((r) => {
      const data = r.report_data as { hypotheses?: { status?: string }[] } | null;
      const hypotheses = Array.isArray(data?.hypotheses) ? data.hypotheses : [];
      return {
        id: r.id,
        session_id: r.session_id,
        user_email: r.user_email,
        device_type: r.device_type,
        manufacturer: r.manufacturer,
        model: r.model,
        status: r.status,
        verified_findings: hypotheses.filter((h) => h.status === "verified").length,
        total_findings: hypotheses.length,
        created_at: r.created_at,
      };
    });
    if (filters.verified === "yes") {
      mapped = mapped.filter((r) => r.verified_findings > 0);
    } else if (filters.verified === "no") {
      mapped = mapped.filter((r) => r.verified_findings === 0);
    }
    return { rows: mapped, total: Number(countRow?.count ?? 0) };
  }

  async listEvidence(filters: EvidenceListFilters) {
    let rowsQuery = this.db
      .selectFrom("evidence_files")
      .innerJoin("diagnostic_sessions", "diagnostic_sessions.id", "evidence_files.session_id")
      .select([
        "evidence_files.id",
        "evidence_files.session_id",
        "evidence_files.media_type",
        "evidence_files.byte_size",
        "evidence_files.original_filename",
        "evidence_files.processing_status",
        "evidence_files.created_at",
        "diagnostic_sessions.device_type",
      ])
      .orderBy("evidence_files.created_at", "desc")
      .limit(filters.limit)
      .offset(filters.offset);
    let countQuery = this.db
      .selectFrom("evidence_files")
      .innerJoin("diagnostic_sessions", "diagnostic_sessions.id", "evidence_files.session_id")
      .select((eb) => eb.fn.countAll<number>().as("count"));
    if (filters.device) {
      const device = filters.device as "laptop";
      rowsQuery = rowsQuery.where("diagnostic_sessions.device_type", "=", device);
      countQuery = countQuery.where("diagnostic_sessions.device_type", "=", device);
    }
    if (filters.media) {
      rowsQuery = rowsQuery.where("evidence_files.media_type", "=", filters.media);
      countQuery = countQuery.where("evidence_files.media_type", "=", filters.media);
    }
    if (filters.processing) {
      const processing = filters.processing as "ready";
      rowsQuery = rowsQuery.where("evidence_files.processing_status", "=", processing);
      countQuery = countQuery.where("evidence_files.processing_status", "=", processing);
    }
    const [rows, countRow] = await Promise.all([
      rowsQuery.execute(),
      countQuery.executeTakeFirst(),
    ]);
    return { rows, total: Number(countRow?.count ?? 0) };
  }

  async listModelRuns(filters: RunListFilters) {
    let rowsQuery = this.db
      .selectFrom("model_runs")
      .selectAll()
      .orderBy("created_at", "desc")
      .limit(filters.limit)
      .offset(filters.offset);
    let countQuery = this.db
      .selectFrom("model_runs")
      .select((eb) => eb.fn.countAll<number>().as("count"));
    if (filters.provider) {
      rowsQuery = rowsQuery.where("model_runs.provider", "=", filters.provider);
      countQuery = countQuery.where("model_runs.provider", "=", filters.provider);
    }
    if (filters.model) {
      rowsQuery = rowsQuery.where("model_runs.model_id", "=", filters.model);
      countQuery = countQuery.where("model_runs.model_id", "=", filters.model);
    }
    if (filters.status) {
      const status = filters.status as "succeeded";
      rowsQuery = rowsQuery.where("model_runs.status", "=", status);
      countQuery = countQuery.where("model_runs.status", "=", status);
    }
    if (filters.sessionId) {
      rowsQuery = rowsQuery.where("model_runs.session_id", "=", filters.sessionId);
      countQuery = countQuery.where("model_runs.session_id", "=", filters.sessionId);
    }
    if (filters.from) {
      const from = new Date(filters.from).toISOString();
      rowsQuery = rowsQuery.where(sql<boolean>`model_runs.created_at >= ${from}`);
      countQuery = countQuery.where(sql<boolean>`model_runs.created_at >= ${from}`);
    }
    if (filters.to) {
      const to = new Date(filters.to).toISOString();
      rowsQuery = rowsQuery.where(sql<boolean>`model_runs.created_at <= ${to}`);
      countQuery = countQuery.where(sql<boolean>`model_runs.created_at <= ${to}`);
    }
    const [rows, countRow] = await Promise.all([
      rowsQuery.execute(),
      countQuery.executeTakeFirst(),
    ]);
    return { rows, total: Number(countRow?.count ?? 0) };
  }

  async listSafetyEvents(filters: SafetyListFilters) {
    let rowsQuery = this.db
      .selectFrom("safety_events")
      .innerJoin("diagnostic_sessions", "diagnostic_sessions.id", "safety_events.session_id")
      .leftJoin(
        "safety_incident_reviews",
        "safety_incident_reviews.safety_event_id",
        "safety_events.id",
      )
      .select([
        "safety_events.id",
        "safety_events.session_id",
        "safety_events.previous_state",
        "safety_events.new_state",
        "safety_events.trigger_type",
        "safety_events.trigger_detail",
        "safety_events.blocked_action",
        "safety_events.created_at",
        "diagnostic_sessions.device_type",
        "safety_incident_reviews.note as review_note",
      ])
      .orderBy("safety_events.created_at", "desc")
      .limit(filters.limit)
      .offset(filters.offset);
    let countQuery = this.db
      .selectFrom("safety_events")
      .select((eb) => eb.fn.countAll<number>().as("count"));
    const applyRows = () => {
      if (filters.state) {
        rowsQuery = rowsQuery.where("safety_events.new_state", "=", filters.state as "normal");
      }
      if (filters.trigger) {
        rowsQuery = rowsQuery.where("safety_events.trigger_type", "=", filters.trigger as never);
      }
      if (filters.from) {
        rowsQuery = rowsQuery.where(sql<boolean>`safety_events.created_at >= ${new Date(filters.from).toISOString()}`);
      }
      if (filters.to) {
        rowsQuery = rowsQuery.where(sql<boolean>`safety_events.created_at <= ${new Date(filters.to).toISOString()}`);
      }
      if (filters.reviewed === "yes") {
        rowsQuery = rowsQuery.where("safety_incident_reviews.id", "is not", null);
      } else if (filters.reviewed === "no") {
        rowsQuery = rowsQuery.where("safety_incident_reviews.id", "is", null);
      }
    };
    const applyCount = () => {
      if (filters.state) {
        countQuery = countQuery.where("new_state", "=", filters.state as "normal");
      }
      if (filters.trigger) {
        countQuery = countQuery.where("trigger_type", "=", filters.trigger as never);
      }
      if (filters.from) {
        countQuery = countQuery.where(sql<boolean>`created_at >= ${new Date(filters.from).toISOString()}`);
      }
      if (filters.to) {
        countQuery = countQuery.where(sql<boolean>`created_at <= ${new Date(filters.to).toISOString()}`);
      }
    };
    applyRows();
    applyCount();
    const [rows, countRow] = await Promise.all([
      rowsQuery.execute(),
      countQuery.executeTakeFirst(),
    ]);
    return {
      rows: rows.map((r) => ({ ...r, reviewed: r.review_note != null })),
      total: Number(countRow?.count ?? 0),
    };
  }

  async listIngestionJobs(filters: JobListFilters) {
    let rowsQuery = this.db
      .selectFrom("ingestion_jobs")
      .leftJoin("technical_documents", "technical_documents.id", "ingestion_jobs.document_id")
      .selectAll("ingestion_jobs")
      .select("technical_documents.title as document_title")
      .orderBy("ingestion_jobs.created_at", "desc")
      .limit(filters.limit)
      .offset(filters.offset);
    let countQuery = this.db
      .selectFrom("ingestion_jobs")
      .select((eb) => eb.fn.countAll<number>().as("count"));
    if (filters.status) {
      rowsQuery = rowsQuery.where("ingestion_jobs.status", "=", filters.status as "succeeded");
      countQuery = countQuery.where("status", "=", filters.status as "succeeded");
    }
    const [rows, countRow] = await Promise.all([
      rowsQuery.execute(),
      countQuery.executeTakeFirst(),
    ]);
    return { rows, total: Number(countRow?.count ?? 0) };
  }

  async overview(days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const userStats = await this.db
      .selectFrom("users")
      .select([
        (eb) => eb.fn.countAll<number>().as("total"),
        (eb) =>
          eb.fn
            .count<number>(eb.case().when("status", "=", "active").then(1).end())
            .as("active"),
        (eb) =>
          eb.fn
            .count<number>(eb.case().when("role", "=", "technician").then(1).end())
            .as("technicians"),
        (eb) =>
          eb.fn
            .count<number>(
              eb.case().when(sql<boolean>`last_login_at >= ${weekAgo}`).then(1).end(),
            )
            .as("active_7d"),
      ])
      .executeTakeFirstOrThrow();
    const sessionStats = await this.db
      .selectFrom("diagnostic_sessions")
      .select([
        (eb) => eb.fn.countAll<number>().as("total"),
        (eb) =>
          eb.fn
            .count<number>(
              eb.case().when("status", "in", ["open", "in_progress", "awaiting_test"]).then(1).end(),
            )
            .as("active"),
        (eb) =>
          eb.fn.count<number>(eb.case().when("status", "=", "completed").then(1).end()).as("completed"),
      ])
      .executeTakeFirstOrThrow();
    const byDevice = await this.db
      .selectFrom("diagnostic_sessions")
      .select(["device_type", (eb) => eb.fn.countAll<number>().as("count")])
      .where(sql<boolean>`created_at >= ${since}`)
      .groupBy("device_type")
      .execute();
    const byDay = await this.db
      .selectFrom("diagnostic_sessions")
      .select([
        sql<string>`to_char(created_at, 'YYYY-MM-DD')`.as("day"),
        (eb) => eb.fn.countAll<number>().as("count"),
      ])
      .where(sql<boolean>`created_at >= ${since}`)
      .groupBy(sql`to_char(created_at, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(created_at, 'YYYY-MM-DD')`, "asc")
      .execute();
    const byStatus = await this.db
      .selectFrom("diagnostic_sessions")
      .select(["status", (eb) => eb.fn.countAll<number>().as("count")])
      .where(sql<boolean>`created_at >= ${since}`)
      .groupBy("status")
      .execute();
    const aiStats = await this.db
      .selectFrom("model_runs")
      .select([
        (eb) => eb.fn.countAll<number>().as("total"),
        (eb) =>
          eb.fn
            .count<number>(eb.case().when("status", "=", "succeeded").then(1).end())
            .as("succeeded"),
        (eb) =>
          eb.fn.count<number>(eb.case().when("status", "=", "failed").then(1).end()).as("failed"),
        (eb) => eb.fn.avg<number | null>("latency_ms").as("avg_latency"),
      ])
      .executeTakeFirstOrThrow();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const errorCats = await this.db
      .selectFrom("model_runs")
      .select(["error_category", (eb) => eb.fn.countAll<number>().as("count")])
      .where(sql<boolean>`created_at >= ${dayAgo}`)
      .where("error_category", "is not", null)
      .groupBy("error_category")
      .execute();
    const docStats = await this.db
      .selectFrom("technical_documents")
      .select([
        (eb) => eb.fn.countAll<number>().as("total"),
        (eb) =>
          eb.fn
            .count<number>(eb.case().when("ingestion_status", "=", "indexed").then(1).end())
            .as("indexed"),
        (eb) =>
          eb.fn
            .count<number>(eb.case().when("ingestion_status", "=", "failed").then(1).end())
            .as("failed"),
      ])
      .executeTakeFirstOrThrow();
    const safetyStats = await this.db
      .selectFrom("safety_events")
      .select([
        (eb) => eb.fn.countAll<number>().as("total"),
        (eb) =>
          eb.fn
            .count<number>(eb.case().when("new_state", "=", "critical_stop").then(1).end())
            .as("critical"),
      ])
      .executeTakeFirstOrThrow();
    const unreviewedRow = await this.db
      .selectFrom("safety_events")
      .leftJoin(
        "safety_incident_reviews",
        "safety_incident_reviews.safety_event_id",
        "safety_events.id",
      )
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("safety_incident_reviews.id", "is", null)
      .executeTakeFirst();
    const reportsRow = await this.db
      .selectFrom("repair_reports")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirst();
    const recentSafety = await this.db
      .selectFrom("safety_events")
      .innerJoin("diagnostic_sessions", "diagnostic_sessions.id", "safety_events.session_id")
      .leftJoin(
        "safety_incident_reviews",
        "safety_incident_reviews.safety_event_id",
        "safety_events.id",
      )
      .select([
        "safety_events.id",
        "safety_events.session_id",
        "safety_events.previous_state",
        "safety_events.new_state",
        "safety_events.trigger_type",
        "safety_events.trigger_detail",
        "safety_events.blocked_action",
        "safety_events.created_at",
        "diagnostic_sessions.device_type",
        "safety_incident_reviews.note as review_note",
      ])
      .orderBy("safety_events.created_at", "desc")
      .limit(5)
      .execute();

    return {
      userStats: {
        total: Number(userStats.total),
        active: Number(userStats.active),
        technicians: Number(userStats.technicians),
        active_7d: Number(userStats.active_7d),
      },
      sessionStats: {
        total: Number(sessionStats.total),
        active: Number(sessionStats.active),
        completed: Number(sessionStats.completed),
      },
      byDevice: byDevice.map((r) => ({ device: r.device_type, count: Number(r.count) })),
      byDay: byDay.map((r) => ({ day: r.day, count: Number(r.count) })),
      byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.count) })),
      aiStats: {
        total: Number(aiStats.total),
        succeeded: Number(aiStats.succeeded),
        failed: Number(aiStats.failed),
        avg_latency_ms: aiStats.avg_latency == null ? null : Math.round(Number(aiStats.avg_latency)),
      },
      errorCats: errorCats.map((r) => ({
        category: r.error_category as string,
        count: Number(r.count),
      })),
      docStats: {
        total: Number(docStats.total),
        indexed: Number(docStats.indexed),
        failed: Number(docStats.failed),
      },
      safetyStats: {
        total: Number(safetyStats.total),
        critical: Number(safetyStats.critical),
        unreviewed: Number(unreviewedRow?.count ?? 0),
      },
      recentSafety: recentSafety.map((r) => ({
        ...r,
        reviewed: r.review_note != null,
      })),
      reportsTotal: Number(reportsRow?.count ?? 0),
    };
  }

  async activityFeed(limit = 12) {
    const [users, sessions, reports, failedRuns, docs, safety] = await Promise.all([
      this.db
        .selectFrom("users")
        .select(["email", "name", "created_at"])
        .orderBy("created_at", "desc")
        .limit(4)
        .execute(),
      this.db
        .selectFrom("diagnostic_sessions")
        .select(["id", "device_type", "status", "created_at"])
        .orderBy("created_at", "desc")
        .limit(4)
        .execute(),
      this.db
        .selectFrom("repair_reports")
        .select(["id", "session_id", "created_at"])
        .orderBy("created_at", "desc")
        .limit(3)
        .execute(),
      this.db
        .selectFrom("model_runs")
        .select(["id", "provider", "created_at"])
        .where("status", "=", "failed")
        .orderBy("created_at", "desc")
        .limit(3)
        .execute(),
      this.db
        .selectFrom("technical_documents")
        .select(["id", "title", "created_at"])
        .orderBy("created_at", "desc")
        .limit(3)
        .execute(),
      this.db
        .selectFrom("safety_events")
        .select(["id", "session_id", "new_state", "created_at"])
        .where("new_state", "=", "critical_stop")
        .orderBy("created_at", "desc")
        .limit(3)
        .execute(),
    ]);
    const items = [
      ...users.map((u) => ({
        kind: "registration",
        title: `New user: ${u.name} (${u.email})`,
        link: null as string | null,
        created_at: u.created_at,
      })),
      ...sessions.map((s) => ({
        kind: s.status === "completed" ? "diagnosis_completed" : "diagnosis_started",
        title: `${s.device_type} session ${s.status}`,
        link: `/admin/sessions/${s.id}`,
        created_at: s.created_at,
      })),
      ...reports.map((r) => ({
        kind: "report",
        title: `Report for session ${r.session_id.slice(0, 8)}`,
        link: `/admin/reports?session=${r.session_id}`,
        created_at: r.created_at,
      })),
      ...failedRuns.map((r) => ({
        kind: "ai_failed",
        title: `Failed ${r.provider} run`,
        link: "/admin/ai-usage",
        created_at: r.created_at,
      })),
      ...docs.map((d) => ({
        kind: "document",
        title: `Document: ${d.title}`,
        link: "/admin/knowledge",
        created_at: d.created_at,
      })),
      ...safety.map((s) => ({
        kind: "safety",
        title: `Critical stop on session ${s.session_id.slice(0, 8)}`,
        link: "/admin/safety",
        created_at: s.created_at,
      })),
    ];
    items.sort(
      (a, b) =>
        new Date(b.created_at as unknown as string).getTime() -
        new Date(a.created_at as unknown as string).getTime(),
    );
    return items.slice(0, limit);
  }

  async quality() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const completedRow = await this.db
      .selectFrom("diagnostic_sessions")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("status", "=", "completed")
      .executeTakeFirst();
    const abandonedRow = await this.db
      .selectFrom("diagnostic_sessions")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("status", "in", ["open", "in_progress", "awaiting_test"])
      .where(sql<boolean>`updated_at < ${weekAgo}`)
      .executeTakeFirst();
    const testsProposedRow = await this.db
      .selectFrom("diagnostic_tests")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirst();
    const testsRecordedRow = await this.db
      .selectFrom("test_results")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirst();
    const hypByStatus = await this.db
      .selectFrom("diagnostic_hypotheses")
      .select(["status", (eb) => eb.fn.countAll<number>().as("count")])
      .groupBy("status")
      .execute();
    const reportsTotalRow = await this.db
      .selectFrom("repair_reports")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirst();
    const verifiedSessions = await this.db
      .selectFrom("diagnostic_hypotheses")
      .select("session_id")
      .where("status", "=", "verified")
      .distinct()
      .execute();
    const verifiedSessionIds = verifiedSessions.map((r) => r.session_id);
    let withVerified = 0;
    if (verifiedSessionIds.length > 0) {
      const row = await this.db
        .selectFrom("repair_reports")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("session_id", "in", verifiedSessionIds)
        .executeTakeFirst();
      withVerified = Number(row?.count ?? 0);
    }
    const validationRow = await this.db
      .selectFrom("model_runs")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("validation_status", "=", "failed")
      .executeTakeFirst();
    const hyp = (status: string) =>
      Number(hypByStatus.find((r) => r.status === status)?.count ?? 0);
    return {
      sessions_completed: Number(completedRow?.count ?? 0),
      sessions_abandoned_7d: Number(abandonedRow?.count ?? 0),
      tests_proposed: Number(testsProposedRow?.count ?? 0),
      tests_recorded: Number(testsRecordedRow?.count ?? 0),
      hypotheses: {
        total: hypByStatus.reduce((n, r) => n + Number(r.count), 0),
        supported: hyp("supported"),
        weakened: hyp("weakened"),
        verified: hyp("verified"),
        ruled_out: hyp("ruled_out"),
      },
      reports: { total: Number(reportsTotalRow?.count ?? 0), with_verified: withVerified },
      validation_failures: Number(validationRow?.count ?? 0),
    };
  }

  async providerStats(provider: string) {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const row = await this.db
      .selectFrom("model_runs")
      .select([
        (eb) => eb.fn.countAll<number>().as("runs"),
        (eb) =>
          eb.fn.count<number>(eb.case().when("status", "=", "succeeded").then(1).end()).as("ok"),
        (eb) =>
          eb.fn.count<number>(eb.case().when("status", "=", "failed").then(1).end()).as("failed"),
        (eb) => eb.fn.avg<number | null>("latency_ms").as("avg_latency"),
      ])
      .where("provider", "=", provider)
      .where(sql<boolean>`created_at >= ${dayAgo}`)
      .executeTakeFirstOrThrow();
    const last = await this.db
      .selectFrom("model_runs")
      .select(["status", "created_at"])
      .where("provider", "=", provider)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();
    return {
      runs_24h: Number(row.runs),
      succeeded_24h: Number(row.ok),
      failed_24h: Number(row.failed),
      avg_latency_ms: row.avg_latency == null ? null : Math.round(Number(row.avg_latency)),
      last_run_at: last?.created_at ?? null,
      last_status: last?.status ?? null,
    };
  }
}
