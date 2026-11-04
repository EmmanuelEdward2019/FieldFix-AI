import type { Kysely } from "kysely";
import { createCitationSchema, type CreateCitation } from "@fieldfix/contracts";
import type {
  Database,
  DocumentChunk,
  SourceCitation,
  TechnicalDocument,
} from "../db/database.js";
import { ChunkRepository, DocumentRepository } from "../db/repositories/documents.js";
import { CitationRepository } from "../db/repositories/citations.js";
import { SessionRepository } from "../db/repositories/sessions.js";
import { HypothesisRepository } from "../db/repositories/hypotheses.js";
import { DiagnosticTestRepository } from "../db/repositories/tests.js";

/**
 * Citation integrity (PRD 5.3 citation rule): a citation is only stored
 * when its excerpt is verifiably contained in a real chunk of an
 * approved, indexed document. Resolution returns the live passage so
 * callers can prove what the citation points at.
 */

export type CitationErrorCode =
  | "invalid_input"
  | "session_not_found"
  | "chunk_not_found"
  | "document_not_citable"
  | "excerpt_not_found"
  | "link_not_found";

export class CitationError extends Error {
  readonly code: CitationErrorCode;

  constructor(code: CitationErrorCode, message: string) {
    super(message);
    this.name = "CitationError";
    this.code = code;
  }
}

export interface ResolvedCitation {
  citation: SourceCitation;
  chunk: DocumentChunk;
  document: TechnicalDocument;
}

/** Collapse whitespace so PDF line-breaks don't break matching. */
export function normalizePassage(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export class CitationService {
  constructor(private readonly db: Kysely<Database>) {}

  async create(
    sessionId: string,
    input: CreateCitation,
  ): Promise<SourceCitation> {
    const parsed = createCitationSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new CitationError(
        "invalid_input",
        `Invalid citation: ${first?.path.join(".") || "?"} — ${first?.message || "schema violation"}.`,
      );
    }
    const session = await new SessionRepository(this.db).getById(sessionId);
    if (!session) {
      throw new CitationError("session_not_found", "Unknown session.");
    }
    const chunk = await new ChunkRepository(this.db).getById(parsed.data.chunk_id);
    if (!chunk) {
      throw new CitationError("chunk_not_found", "Cited passage does not exist.");
    }
    const document = await new DocumentRepository(this.db).getById(chunk.document_id);
    if (
      !document ||
      document.permission_status !== "approved" ||
      document.ingestion_status !== "indexed"
    ) {
      throw new CitationError(
        "document_not_citable",
        "Cited document is not approved and indexed.",
      );
    }
    const haystack = normalizePassage(chunk.content);
    const needle = normalizePassage(parsed.data.excerpt);
    if (needle.length === 0 || !haystack.includes(needle)) {
      throw new CitationError(
        "excerpt_not_found",
        "Excerpt is not contained in the cited passage; refusing to store a fabricated citation.",
      );
    }
    if (parsed.data.hypothesis_id) {
      const hypothesis = await new HypothesisRepository(this.db).getById(
        parsed.data.hypothesis_id,
      );
      if (!hypothesis || hypothesis.session_id !== sessionId) {
        throw new CitationError("link_not_found", "Linked hypothesis does not exist in this session.");
      }
    }
    if (parsed.data.test_id) {
      const test = await new DiagnosticTestRepository(this.db).getById(parsed.data.test_id);
      if (!test || test.session_id !== sessionId) {
        throw new CitationError("link_not_found", "Linked test does not exist in this session.");
      }
    }
    return new CitationRepository(this.db).create(sessionId, parsed.data);
  }

  /** Load a citation with its live passage and document, or null. */
  async resolve(citationId: string): Promise<ResolvedCitation | null> {
    const citation = await this.db
      .selectFrom("source_citations")
      .selectAll()
      .where("id", "=", citationId)
      .executeTakeFirst();
    if (!citation) {
      return null;
    }
    const chunk = await new ChunkRepository(this.db).getById(citation.chunk_id);
    if (!chunk) {
      return null;
    }
    const document = await new DocumentRepository(this.db).getById(chunk.document_id);
    if (!document) {
      return null;
    }
    return { citation, chunk, document };
  }

  /** List a session's citations with passages, for the reference panel. */
  async listSessionResolved(sessionId: string): Promise<ResolvedCitation[]> {
    const citations = await new CitationRepository(this.db).listBySession(sessionId);
    const chunks = new ChunkRepository(this.db);
    const documents = new DocumentRepository(this.db);
    const resolved: ResolvedCitation[] = [];
    for (const citation of citations) {
      const chunk = await chunks.getById(citation.chunk_id);
      if (!chunk) {
        continue;
      }
      const document = await documents.getById(chunk.document_id);
      if (!document) {
        continue;
      }
      resolved.push({ citation, chunk, document });
    }
    return resolved;
  }
}
