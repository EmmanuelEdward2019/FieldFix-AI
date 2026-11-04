import type { Kysely } from "kysely";
import {
  createPartRecommendationSchema,
  createToolRecommendationSchema,
  type CreatePartRecommendation,
  type CreateToolRecommendation,
  type UpdateRecommendationStatus,
} from "@fieldfix/contracts";
import type {
  Database,
  PartRecommendation,
  ToolRecommendation,
} from "../db/database.js";
import {
  ChunkRepository,
  DocumentRepository,
} from "../db/repositories/documents.js";
import {
  PartRecommendationRepository,
  ToolRecommendationRepository,
} from "../db/repositories/parts.js";
import { SessionRepository } from "../db/repositories/sessions.js";
import { HypothesisRepository } from "../db/repositories/hypotheses.js";
import { DiagnosticTestRepository } from "../db/repositories/tests.js";
import { normalizePassage } from "../knowledge/citations.js";

/**
 * Parts and tools advisor (Phase 2, deterministic v1): stores
 * technician-entered part/tool suggestions with optional manual
 * provenance. Provenance follows the citation integrity rule — an
 * excerpt is stored only when it occurs verbatim in a real chunk of
 * an approved, indexed document — reusing the verbatim helpers
 * (normalizePassage plus the chunk/document citable checks). This
 * service never calls CitationService.create: recommendations are
 * not citations and must not insert citation rows.
 */

export type PartsAdvisorErrorCode =
  | "invalid_input"
  | "session_not_found"
  | "link_not_found"
  | "chunk_not_found"
  | "document_not_citable"
  | "excerpt_not_found"
  | "recommendation_not_found";

export class PartsAdvisorError extends Error {
  readonly code: PartsAdvisorErrorCode;

  constructor(code: PartsAdvisorErrorCode, message: string) {
    super(message);
    this.name = "PartsAdvisorError";
    this.code = code;
  }
}

function invalidInput(message: string): PartsAdvisorError {
  return new PartsAdvisorError("invalid_input", message);
}

export class PartsAdvisorService {
  constructor(private readonly db: Kysely<Database>) {}

  async createPart(
    sessionId: string,
    input: CreatePartRecommendation,
  ): Promise<PartRecommendation> {
    const parsed = createPartRecommendationSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw invalidInput(
        `Invalid part recommendation: ${first?.path.join(".") || "?"} — ${first?.message || "schema violation"}.`,
      );
    }
    const session = await new SessionRepository(this.db).getById(sessionId);
    if (!session) {
      throw new PartsAdvisorError("session_not_found", "Unknown session.");
    }
    if (parsed.data.hypothesis_id) {
      const hypothesis = await new HypothesisRepository(this.db).getById(
        parsed.data.hypothesis_id,
      );
      if (!hypothesis || hypothesis.session_id !== sessionId) {
        throw new PartsAdvisorError(
          "link_not_found",
          "Linked hypothesis does not exist in this session.",
        );
      }
    }
    if (parsed.data.test_id) {
      const test = await new DiagnosticTestRepository(this.db).getById(
        parsed.data.test_id,
      );
      if (!test || test.session_id !== sessionId) {
        throw new PartsAdvisorError(
          "link_not_found",
          "Linked test does not exist in this session.",
        );
      }
    }
    if (parsed.data.chunk_id) {
      await this.verifyExcerpt(
        parsed.data.chunk_id,
        parsed.data.excerpt as string,
      );
    }
    return new PartRecommendationRepository(this.db).create(
      sessionId,
      parsed.data,
    );
  }

  async listParts(sessionId: string): Promise<PartRecommendation[]> {
    return new PartRecommendationRepository(this.db).listBySession(sessionId);
  }

  async setPartStatus(
    sessionId: string,
    recId: string,
    status: UpdateRecommendationStatus["status"],
  ): Promise<PartRecommendation> {
    const row = await new PartRecommendationRepository(this.db).getById(recId);
    if (!row || row.session_id !== sessionId) {
      throw new PartsAdvisorError(
        "recommendation_not_found",
        "No such part recommendation.",
      );
    }
    const updated = await new PartRecommendationRepository(this.db).updateStatus(
      recId,
      status,
    );
    if (!updated) {
      throw new PartsAdvisorError(
        "recommendation_not_found",
        "No such part recommendation.",
      );
    }
    return updated;
  }

  async createTool(
    sessionId: string,
    input: CreateToolRecommendation,
  ): Promise<ToolRecommendation> {
    const parsed = createToolRecommendationSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw invalidInput(
        `Invalid tool recommendation: ${first?.path.join(".") || "?"} — ${first?.message || "schema violation"}.`,
      );
    }
    const session = await new SessionRepository(this.db).getById(sessionId);
    if (!session) {
      throw new PartsAdvisorError("session_not_found", "Unknown session.");
    }
    if (parsed.data.test_id) {
      const test = await new DiagnosticTestRepository(this.db).getById(
        parsed.data.test_id,
      );
      if (!test || test.session_id !== sessionId) {
        throw new PartsAdvisorError(
          "link_not_found",
          "Linked test does not exist in this session.",
        );
      }
    }
    if (parsed.data.chunk_id) {
      await this.verifyChunkCitable(parsed.data.chunk_id);
    }
    return new ToolRecommendationRepository(this.db).create(
      sessionId,
      parsed.data,
    );
  }

  async listTools(sessionId: string): Promise<ToolRecommendation[]> {
    return new ToolRecommendationRepository(this.db).listBySession(sessionId);
  }

  async setToolStatus(
    sessionId: string,
    recId: string,
    status: UpdateRecommendationStatus["status"],
  ): Promise<ToolRecommendation> {
    const row = await new ToolRecommendationRepository(this.db).getById(recId);
    if (!row || row.session_id !== sessionId) {
      throw new PartsAdvisorError(
        "recommendation_not_found",
        "No such tool recommendation.",
      );
    }
    const updated = await new ToolRecommendationRepository(this.db).updateStatus(
      recId,
      status,
    );
    if (!updated) {
      throw new PartsAdvisorError(
        "recommendation_not_found",
        "No such tool recommendation.",
      );
    }
    return updated;
  }

  /**
   * The citation integrity rule, minus the citation row: the chunk
   * must exist, its document must be approved and indexed, and the
   * excerpt must occur verbatim (whitespace-normalized) in the
   * chunk content. Refusals are honest 422s/404s, never stored rows.
   */
  private async verifyExcerpt(chunkId: string, excerpt: string): Promise<void> {
    const chunk = await this.verifyChunkCitable(chunkId);
    const haystack = normalizePassage(chunk.content);
    const needle = normalizePassage(excerpt);
    if (needle.length === 0 || !haystack.includes(needle)) {
      throw new PartsAdvisorError(
        "excerpt_not_found",
        "Excerpt is not contained in the cited passage; refusing to store a fabricated reference.",
      );
    }
  }

  private async verifyChunkCitable(chunkId: string) {
    const chunk = await new ChunkRepository(this.db).getById(chunkId);
    if (!chunk) {
      throw new PartsAdvisorError(
        "chunk_not_found",
        "Cited passage does not exist.",
      );
    }
    const document = await new DocumentRepository(this.db).getById(
      chunk.document_id,
    );
    if (
      !document ||
      document.permission_status !== "approved" ||
      document.ingestion_status !== "indexed"
    ) {
      throw new PartsAdvisorError(
        "document_not_citable",
        "Cited document is not approved and indexed.",
      );
    }
    return chunk;
  }
}
