import type { IngestionJobStatus } from "@fieldfix/contracts";
import { jsonb, type Db, type IngestionJob } from "../database.js";

export interface JobDetailInput {
  format?: string;
  chunks_created?: number;
  sections_parsed?: number;
  pages_needing_ocr?: number[];
  ocr_pages_filled?: number[];
  warnings?: string[];
  duplicate_of?: string | null;
}

export class IngestionJobRepository {
  constructor(private readonly db: Db) {}

  async create(input: {
    source_name: string;
    document_id?: string | null;
  }): Promise<IngestionJob> {
    return this.db
      .insertInto("ingestion_jobs")
      .values({
        source_name: input.source_name,
        document_id: input.document_id ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getById(id: string): Promise<IngestionJob | undefined> {
    return this.db
      .selectFrom("ingestion_jobs")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async listByDocument(documentId: string): Promise<IngestionJob[]> {
    return this.db
      .selectFrom("ingestion_jobs")
      .selectAll()
      .where("document_id", "=", documentId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async markRunning(id: string): Promise<void> {
    await this.db
      .updateTable("ingestion_jobs")
      .set({ status: "running" })
      .where("id", "=", id)
      .execute();
  }

  async finish(
    id: string,
    input: {
      status: Extract<IngestionJobStatus, "succeeded" | "failed">;
      document_id?: string | null;
      error?: string | null;
      chunks_created?: number;
      detail?: JobDetailInput | null;
    },
  ): Promise<IngestionJob | undefined> {
    return this.db
      .updateTable("ingestion_jobs")
      .set({
        status: input.status,
        ...(input.document_id !== undefined
          ? { document_id: input.document_id }
          : {}),
        error: input.error ?? null,
        chunks_created: input.chunks_created ?? 0,
        detail: input.detail !== undefined && input.detail !== null
          ? jsonb({
            pages_needing_ocr: [],
            ocr_pages_filled: [],
            warnings: [],
            ...input.detail,
          })
          : null,
        finished_at: new Date(),
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }
}
