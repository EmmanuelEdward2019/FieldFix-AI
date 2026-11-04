import type {
  CreateModelRun,
  UpdateModelRun,
} from "@fieldfix/contracts";
import type { Updateable } from "kysely";
import type { Db, ModelRun, ModelRunsTable } from "../database.js";

export class ModelRunRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateModelRun): Promise<ModelRun> {
    return this.db
      .insertInto("model_runs")
      .values({
        session_id: input.session_id ?? null,
        provider: input.provider,
        model_id: input.model_id,
        task_type: input.task_type,
        origin: input.origin,
        request_id: input.request_id ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getById(id: string): Promise<ModelRun | undefined> {
    return this.db
      .selectFrom("model_runs")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async listBySession(sessionId: string): Promise<ModelRun[]> {
    return this.db
      .selectFrom("model_runs")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async update(
    id: string,
    patch: UpdateModelRun,
  ): Promise<ModelRun | undefined> {
    // PATCH semantics: only provided keys are written, so finishing a
    // run never wipes columns set at creation (e.g. request_id).
    const set: Updateable<ModelRunsTable> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        (set as Record<string, unknown>)[key] = value;
      }
    }
    return this.db
      .updateTable("model_runs")
      .set(set)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }
}
