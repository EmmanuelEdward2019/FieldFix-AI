import { sql } from "kysely";
import type {
  CreateChunk,
  CreateDocument,
  KnowledgeSearch,
  KnowledgeSearchHit,
  UpdateDocumentIngestion,
} from "@fieldfix/contracts";
import type {
  Db,
  DocumentChunk,
  TechnicalDocument,
} from "../database.js";

export interface CreateDocumentInput extends CreateDocument {
  is_demo?: boolean;
}

export class DocumentRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateDocumentInput): Promise<TechnicalDocument> {
    return this.db
      .insertInto("technical_documents")
      .values({
        title: input.title,
        manufacturer: input.manufacturer ?? null,
        device_family: input.device_family ?? null,
        model_numbers: input.model_numbers,
        document_type: input.document_type,
        source_name: input.source_name,
        source_url: input.source_url ?? null,
        version: input.version ?? null,
        language: input.language,
        licence_name: input.licence_name ?? null,
        permission_status: input.permission_status,
        storage_key: input.storage_key ?? null,
        checksum_sha256: input.checksum_sha256 ?? null,
        is_demo: input.is_demo ?? false,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getById(id: string): Promise<TechnicalDocument | undefined> {
    return this.db
      .selectFrom("technical_documents")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async listRecent(limit: number): Promise<TechnicalDocument[]> {
    return this.db
      .selectFrom("technical_documents")
      .selectAll()
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  }

  async findByChecksum(
    checksum: string,
  ): Promise<TechnicalDocument | undefined> {
    return this.db
      .selectFrom("technical_documents")
      .selectAll()
      .where("checksum_sha256", "=", checksum)
      .executeTakeFirst();
  }

  async updateIngestion(
    id: string,
    input: UpdateDocumentIngestion,
  ): Promise<TechnicalDocument | undefined> {
    return this.db
      .updateTable("technical_documents")
      .set({
        ingestion_status: input.ingestion_status,
        ingestion_error: input.ingestion_error ?? null,
        ...(input.permission_status !== undefined
          ? { permission_status: input.permission_status }
          : {}),
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }
}

export class ChunkRepository {
  constructor(private readonly db: Db) {}

  async create(
    documentId: string,
    input: CreateChunk,
  ): Promise<DocumentChunk> {
    return this.db
      .insertInto("document_chunks")
      .values({
        document_id: documentId,
        chunk_index: input.chunk_index,
        page_number: input.page_number ?? null,
        heading: input.heading ?? null,
        content: input.content,
        safety_tags: input.safety_tags,
        component_tags: input.component_tags,
        model_applicability: input.model_applicability,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getById(id: string): Promise<DocumentChunk | undefined> {
    return this.db
      .selectFrom("document_chunks")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async listByDocument(documentId: string): Promise<DocumentChunk[]> {
    return this.db
      .selectFrom("document_chunks")
      .selectAll()
      .where("document_id", "=", documentId)
      .orderBy("chunk_index", "asc")
      .execute();
  }
}

/**
 * Full-text search over indexed, approved documents only. Returns real
 * excerpts with document/page references — never fabricated citations.
 * `match: "any"` ORs the query lexemes for natural-language recall
 * (diagnosis auto-consult); the default ANDs them (user search).
 * Headline markers are stripped — excerpts render as plain text.
 */
export async function searchChunks(
  db: Db,
  query: KnowledgeSearch,
  options: { match?: "all" | "any" } = {},
): Promise<KnowledgeSearchHit[]> {
  const { manufacturer, model, limit } = query;
  const tsquery =
    options.match === "any"
      ? sql`to_tsquery('english', replace(plainto_tsquery('english', ${query.query})::text, '&', '|'))`
      : sql`plainto_tsquery('english', ${query.query})`;
  const rows = await db
    .selectFrom("document_chunks as c")
    .innerJoin("technical_documents as d", "d.id", "c.document_id")
    .select([
      "c.id as chunk_id",
      "d.id as document_id",
      "d.title as document_title",
      "c.page_number",
      "c.heading",
      sql<string>`replace(replace(ts_headline('english', c.content, ${tsquery}), '<b>', ''), '</b>', '')`.as(
        "excerpt",
      ),
      sql<number>`ts_rank(c.search_vector, ${tsquery})`.as("rank"),
    ])
    .where(sql<boolean>`c.search_vector @@ ${tsquery}`)
    .where("d.permission_status", "=", "approved")
    .where("d.ingestion_status", "=", "indexed")
    .$if(manufacturer !== undefined, (qb) =>
      qb.where("d.manufacturer", "=", manufacturer as string),
    )
    .$if(model !== undefined, (qb) =>
      qb.where(sql<boolean>`${model} = any(d.model_numbers)`),
    )
    .orderBy("rank", "desc")
    .limit(limit)
    .execute();
  return rows;
}
