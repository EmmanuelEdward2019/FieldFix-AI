import type { CreateCitation } from "@fieldfix/contracts";
import type { Db, SourceCitation } from "../database.js";

export class CitationRepository {
  constructor(private readonly db: Db) {}

  async create(
    sessionId: string,
    input: CreateCitation,
  ): Promise<SourceCitation> {
    return this.db
      .insertInto("source_citations")
      .values({
        session_id: sessionId,
        hypothesis_id: input.hypothesis_id ?? null,
        test_id: input.test_id ?? null,
        chunk_id: input.chunk_id,
        excerpt: input.excerpt,
        note: input.note ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listBySession(sessionId: string): Promise<SourceCitation[]> {
    return this.db
      .selectFrom("source_citations")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async listByHypothesis(hypothesisId: string): Promise<SourceCitation[]> {
    return this.db
      .selectFrom("source_citations")
      .selectAll()
      .where("hypothesis_id", "=", hypothesisId)
      .orderBy("created_at", "asc")
      .execute();
  }
}
