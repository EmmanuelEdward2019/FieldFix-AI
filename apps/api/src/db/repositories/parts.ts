import type {
  CreatePartRecommendation,
  CreateToolRecommendation,
  UpdateRecommendationStatus,
} from "@fieldfix/contracts";
import type {
  Db,
  PartRecommendation,
  ToolRecommendation,
} from "../database.js";

export class PartRecommendationRepository {
  constructor(private readonly db: Db) {}

  async create(
    sessionId: string,
    input: CreatePartRecommendation,
  ): Promise<PartRecommendation> {
    return this.db
      .insertInto("part_recommendations")
      .values({
        session_id: sessionId,
        hypothesis_id: input.hypothesis_id ?? null,
        test_id: input.test_id ?? null,
        part_name: input.part_name,
        part_number: input.part_number ?? null,
        manufacturer: input.manufacturer ?? null,
        model_compat: input.model_compat ?? null,
        chunk_id: input.chunk_id ?? null,
        excerpt: input.excerpt ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getById(id: string): Promise<PartRecommendation | undefined> {
    return this.db
      .selectFrom("part_recommendations")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async listBySession(sessionId: string): Promise<PartRecommendation[]> {
    return this.db
      .selectFrom("part_recommendations")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async updateStatus(
    id: string,
    status: UpdateRecommendationStatus["status"],
  ): Promise<PartRecommendation | undefined> {
    return this.db
      .updateTable("part_recommendations")
      .set({ status })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }
}

export class ToolRecommendationRepository {
  constructor(private readonly db: Db) {}

  async create(
    sessionId: string,
    input: CreateToolRecommendation,
  ): Promise<ToolRecommendation> {
    return this.db
      .insertInto("tool_recommendations")
      .values({
        session_id: sessionId,
        test_id: input.test_id ?? null,
        tool_name: input.tool_name,
        spec: input.spec ?? null,
        chunk_id: input.chunk_id ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getById(id: string): Promise<ToolRecommendation | undefined> {
    return this.db
      .selectFrom("tool_recommendations")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async listBySession(sessionId: string): Promise<ToolRecommendation[]> {
    return this.db
      .selectFrom("tool_recommendations")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async updateStatus(
    id: string,
    status: UpdateRecommendationStatus["status"],
  ): Promise<ToolRecommendation | undefined> {
    return this.db
      .updateTable("tool_recommendations")
      .set({ status })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }
}
