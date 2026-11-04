import type { Request } from "express";
import type { Db, NewAdminAuditLog } from "../database.js";
import type { AdminActor } from "../../auth/admin-access.js";

export interface AuditEvent {
  action: string;
  targetType?: string;
  targetId?: string;
  outcome?: "success" | "denied" | "failed";
  metadata?: Record<string, unknown>;
}

export class AuditLogRepository {
  constructor(private readonly db: Db) {}

  async append(
    actor: Pick<AdminActor, "actorType" | "actorId" | "actorEmail">,
    req: Request,
    event: AuditEvent,
  ): Promise<void> {
    const row: NewAdminAuditLog = {
      actor_type: actor.actorType,
      actor_id: actor.actorId,
      actor_email: actor.actorEmail,
      action: event.action,
      target_type: event.targetType ?? null,
      target_id: event.targetId ?? null,
      outcome: event.outcome ?? "success",
      metadata: event.metadata ?? {},
      ip: req.ip ?? null,
    };
    await this.db.insertInto("admin_audit_logs").values(row).execute();
  }

  async list(options: {
    limit: number;
    offset: number;
    action?: string;
    actorId?: string;
    outcome?: string;
  }): Promise<{ rows: Awaited<ReturnType<AuditLogRepository["listRows"]>>; total: number }> {
    const rows = await this.listRows(options);
    let countQuery = this.db
      .selectFrom("admin_audit_logs")
      .select((eb) => eb.fn.countAll<number>().as("count"));
    if (options.action) {
      countQuery = countQuery.where("action", "=", options.action);
    }
    if (options.actorId) {
      countQuery = countQuery.where("actor_id", "=", options.actorId);
    }
    if (options.outcome) {
      countQuery = countQuery.where(
        "outcome",
        "=",
        options.outcome as "success" | "denied" | "failed",
      );
    }
    const countRow = await countQuery.executeTakeFirst();
    return { rows, total: Number(countRow?.count ?? 0) };
  }

  private async listRows(options: {
    limit: number;
    offset: number;
    action?: string;
    actorId?: string;
    outcome?: string;
  }) {
    let query = this.db
      .selectFrom("admin_audit_logs")
      .selectAll()
      .orderBy("created_at", "desc")
      .limit(options.limit)
      .offset(options.offset);
    if (options.action) {
      query = query.where("action", "=", options.action);
    }
    if (options.actorId) {
      query = query.where("actor_id", "=", options.actorId);
    }
    if (options.outcome) {
      query = query.where(
        "outcome",
        "=",
        options.outcome as "success" | "denied" | "failed",
      );
    }
    return query.execute();
  }
}
