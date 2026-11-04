import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { Kysely } from "kysely";
import type { AdminUploadMetadata } from "@fieldfix/contracts";
import type { Database, DocumentChunk, TechnicalDocument } from "../db/database.js";
import { DocumentRepository, ChunkRepository } from "../db/repositories/documents.js";
import { IngestionJobRepository } from "../db/repositories/ingestion-jobs.js";
import { StorageNotFoundError, type StorageAdapter } from "../storage/types.js";
import { TesseractOcrService, type OcrService } from "./ocr.js";
import { parseCsv } from "./parsers/csv.js";
import { parseJson } from "./parsers/json.js";
import { parsePdf } from "./parsers/pdf.js";
import { parseText } from "./parsers/text.js";
import { assertSourcePermitted, type SourceId } from "./sources.js";
import {
  IngestionError,
  type IngestionErrorCode,
  type NormalizedSection,
  type ParsedFormat,
} from "./types.js";
import { sectionsToChunks } from "./normalize.js";

/** Max bytes retained per document (route enforces upload size too). */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

const DOCUMENT_MEDIA_TYPES = [
  "application/pdf",
  "application/json",
  "text/csv",
  "text/plain",
  "text/markdown",
] as const;

export type DocumentKind = "pdf" | "json" | "csv" | "text";

export interface IngestionServiceDeps {
  db: Kysely<Database>;
  storage: StorageAdapter;
  ocr?: OcrService;
  env?: NodeJS.ProcessEnv;
}

export interface IngestFileInput {
  bytes: Buffer;
  mediaType: string;
  filename?: string;
  metadata: AdminUploadMetadata;
  sourceId: SourceId;
  sourceName?: string;
}

export type IngestOutcome =
  | {
    status: "indexed";
    document: TechnicalDocument;
    chunks: DocumentChunk[];
    jobId: string;
    format: ParsedFormat;
    warnings: string[];
    pagesNeedingOcr: number[];
    ocrPagesFilled: number[];
  }
  | { status: "duplicate"; document: TechnicalDocument; jobId: string; duplicateOf: string }
  | {
    status: "failed";
    document: TechnicalDocument | null;
    jobId: string;
    code: IngestionErrorCode;
    error: string;
  };

export class IngestionService {
  private readonly ocr: OcrService;

  constructor(private readonly deps: IngestionServiceDeps) {
    this.ocr = deps.ocr ?? new TesseractOcrService();
  }

  /**
   * Full PRD 5.2 flow: permission gate -> checksum/duplicate check ->
   * retain bytes -> parse -> normalize -> index. One job row per
   * attempt; failures are recorded, never thrown past the caller.
   */
  async ingestFile(input: IngestFileInput): Promise<IngestOutcome> {
    const { db, storage } = this.deps;
    const documents = new DocumentRepository(db);
    const jobs = new IngestionJobRepository(db);
    const sourceName = input.sourceName ?? input.metadata.source_name;

    try {
      assertSourcePermitted(input.sourceId, this.deps.env ?? process.env);
    } catch (err) {
      return this.recordAttemptFailure(jobs, null, sourceName, err);
    }
    if (input.metadata.permission_status === "rejected") {
      return this.recordAttemptFailure(
        jobs,
        null,
        sourceName,
        new IngestionError(
          "permission_rejected",
          "Document permission is 'rejected'; ingestion refused.",
        ),
      );
    }

    let kind: DocumentKind;
    try {
      kind = detectDocumentKind(input.mediaType, input.bytes);
    } catch (err) {
      return this.recordAttemptFailure(jobs, null, sourceName, err);
    }

    const checksum = sha256(input.bytes);
    const existing = await documents.findByChecksum(checksum);
    if (existing) {
      const job = await jobs.create({ source_name: sourceName, document_id: existing.id });
      await jobs.finish(job.id, {
        status: "succeeded",
        chunks_created: 0,
        detail: { duplicate_of: existing.id, warnings: ["Duplicate checksum; no new chunks stored."] },
      });
      return { status: "duplicate", document: existing, jobId: job.id, duplicateOf: existing.id };
    }

    const job = await jobs.create({ source_name: sourceName });
    await jobs.markRunning(job.id);
    let documentId: string | undefined;
    try {
      // Canonical extension from the detected kind (not the client
      // filename) so re-ingestion can recover the parser later.
      const ext = kind === "pdf" ? "pdf" : kind === "json" ? "json" : kind === "csv" ? "csv" : "txt";
      const storageKey = `documents/${randomUUID()}/${baseName(input.filename)}.${ext}`;
      try {
        await storage.put(storageKey, input.bytes, input.mediaType);
      } catch (err) {
        throw new IngestionError(
          "storage_failed",
          `Could not retain document bytes: ${err instanceof Error ? err.message : "storage error"}.`,
        );
      }
      const document = await documents.create({
        ...input.metadata,
        source_name: sourceName,
        checksum_sha256: checksum,
        storage_key: storageKey,
      });
      documentId = document.id;
      await documents.updateIngestion(document.id, { ingestion_status: "processing" });
      const sections = await this.parseBytes(kind, input.bytes);
      const chunks = sectionsToChunks(sections.sections, {
        defaultModelApplicability: input.metadata.model_numbers,
      });
      if (chunks.length === 0) {
        throw new IngestionError("empty_document", "Parsing yielded no storable chunks.");
      }
      const stored = await db.transaction().execute(async (trx) => {
        const txChunks = new ChunkRepository(trx);
        const created: DocumentChunk[] = [];
        for (const chunk of chunks) {
          created.push(await txChunks.create(document.id, chunk));
        }
        await new DocumentRepository(trx).updateIngestion(document.id, {
          ingestion_status: "indexed",
        });
        return created;
      });
      const finished = await documents.getById(document.id);
      if (!finished) {
        throw new IngestionError("storage_failed", "Document vanished after indexing.");
      }
      await jobs.finish(job.id, {
        status: "succeeded",
        document_id: document.id,
        chunks_created: stored.length,
        detail: {
          format: sections.format,
          chunks_created: stored.length,
          sections_parsed: sections.sections.length,
          pages_needing_ocr: sections.pagesNeedingOcr,
          ocr_pages_filled: sections.ocrPagesFilled,
          warnings: sections.warnings,
        },
      });
      return {
        status: "indexed",
        document: finished,
        chunks: stored,
        jobId: job.id,
        format: sections.format,
        warnings: sections.warnings,
        pagesNeedingOcr: sections.pagesNeedingOcr,
        ocrPagesFilled: sections.ocrPagesFilled,
      };
    } catch (err) {
      return this.recordAttemptFailure(jobs, job.id, sourceName, err, documentId);
    }
  }

  /**
   * Re-run parsing for an existing document from its retained bytes
   * (e.g. after a parser fix). Replaces chunks; never duplicates docs.
   */
  async reingestDocument(documentId: string): Promise<IngestOutcome> {
    const { db, storage } = this.deps;
    const documents = new DocumentRepository(db);
    const jobs = new IngestionJobRepository(db);
    const document = await documents.getById(documentId);
    if (!document) {
      throw new IngestionError("parse_failed", "Unknown document.");
    }
    const job = await jobs.create({
      source_name: document.source_name,
      document_id: document.id,
    });
    await jobs.markRunning(job.id);
    await documents.updateIngestion(document.id, { ingestion_status: "processing" });
    try {
      if (!document.storage_key || !document.checksum_sha256) {
        throw new IngestionError(
          "no_stored_bytes",
          "Document has no retained bytes; re-ingestion needs the original file.",
        );
      }
      let bytes: Buffer;
      try {
        bytes = await storage.get(document.storage_key);
      } catch (err) {
        if (err instanceof StorageNotFoundError) {
          throw new IngestionError(
            "no_stored_bytes",
            "Retained bytes are missing from storage.",
          );
        }
        throw new IngestionError(
          "storage_failed",
          `Could not read retained bytes: ${err instanceof Error ? err.message : "storage error"}.`,
        );
      }
      const kind = detectDocumentKind(guessMediaType(document.storage_key), bytes);
      const sections = await this.parseBytes(kind, bytes);
      const chunks = sectionsToChunks(sections.sections, {
        defaultModelApplicability: document.model_numbers,
      });
      if (chunks.length === 0) {
        throw new IngestionError("empty_document", "Parsing yielded no storable chunks.");
      }
      const stored = await db.transaction().execute(async (trx) => {
        await trx.deleteFrom("document_chunks").where("document_id", "=", document.id).execute();
        const txChunks = new ChunkRepository(trx);
        const created: DocumentChunk[] = [];
        for (const chunk of chunks) {
          created.push(await txChunks.create(document.id, chunk));
        }
        await new DocumentRepository(trx).updateIngestion(document.id, {
          ingestion_status: "indexed",
          ingestion_error: null,
        });
        return created;
      });
      const finished = await documents.getById(document.id);
      if (!finished) {
        throw new IngestionError("storage_failed", "Document vanished after indexing.");
      }
      await jobs.finish(job.id, {
        status: "succeeded",
        chunks_created: stored.length,
        detail: {
          format: sections.format,
          chunks_created: stored.length,
          sections_parsed: sections.sections.length,
          pages_needing_ocr: sections.pagesNeedingOcr,
          ocr_pages_filled: sections.ocrPagesFilled,
          warnings: sections.warnings,
        },
      });
      return {
        status: "indexed",
        document: finished,
        chunks: stored,
        jobId: job.id,
        format: sections.format,
        warnings: sections.warnings,
        pagesNeedingOcr: sections.pagesNeedingOcr,
        ocrPagesFilled: sections.ocrPagesFilled,
      };
    } catch (err) {
      return this.recordAttemptFailure(jobs, job.id, document.source_name, err, document.id);
    }
  }

  private async parseBytes(
    kind: DocumentKind,
    bytes: Buffer,
  ): Promise<{
    format: ParsedFormat;
    sections: NormalizedSection[];
    pagesNeedingOcr: number[];
    ocrPagesFilled: number[];
    warnings: string[];
  }> {
    switch (kind) {
      case "pdf": {
        const parsed = await parsePdf(bytes, { ocr: this.ocr });
        return {
          format: parsed.format,
          sections: parsed.sections,
          pagesNeedingOcr: parsed.pagesNeedingOcr,
          ocrPagesFilled: parsed.ocrPagesFilled,
          warnings: parsed.warnings,
        };
      }
      case "json": {
        const parsed = parseJson(bytes);
        return { ...parsed, ocrPagesFilled: [] };
      }
      case "csv": {
        const parsed = parseCsv(bytes);
        return { ...parsed, ocrPagesFilled: [] };
      }
      case "text": {
        const parsed = parseText(bytes);
        return { ...parsed, ocrPagesFilled: [] };
      }
    }
  }

  private async recordAttemptFailure(
    jobs: IngestionJobRepository,
    jobId: string | null,
    sourceName: string,
    err: unknown,
    documentId?: string,
  ): Promise<IngestOutcome> {
    const message = err instanceof Error ? err.message : "Ingestion failed.";
    const code = err instanceof IngestionError ? err.code : "internal";
    const documents = new DocumentRepository(this.deps.db);
    let job = jobId ? await jobs.getById(jobId) : undefined;
    if (!job) {
      job = await jobs.create({
        source_name: sourceName,
        document_id: documentId ?? null,
      });
      await jobs.markRunning(job.id);
    }
    await jobs.finish(job.id, {
      status: "failed",
      ...(documentId !== undefined ? { document_id: documentId } : {}),
      error: message.slice(0, 4000),
      detail: { warnings: [] },
    });
    if (documentId) {
      await documents.updateIngestion(documentId, {
        ingestion_status: "failed",
        ingestion_error: message.slice(0, 4000),
      });
      return {
        status: "failed",
        document: (await documents.getById(documentId)) ?? null,
        jobId: job.id,
        code,
        error: message,
      };
    }
    // Pre-registration failure (bad source, rejected permission, bad
    // format): no document row exists, the job carries the report.
    return { status: "failed", document: null, jobId: job.id, code, error: message };
  }
}

/** Media allowlist + magic sniffing; rejects renamed binaries. */
export function detectDocumentKind(mediaType: string, bytes: Buffer): DocumentKind {
  const normalized = mediaType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!(DOCUMENT_MEDIA_TYPES as readonly string[]).includes(normalized)) {
    throw new IngestionError(
      "unsupported_format",
      `Unsupported media type '${mediaType}'. Allowed: ${DOCUMENT_MEDIA_TYPES.join(", ")}.`,
    );
  }
  if (bytes.length === 0) {
    throw new IngestionError("empty_document", "File is empty.");
  }
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    throw new IngestionError(
      "parse_failed",
      `File exceeds the ${MAX_DOCUMENT_BYTES} byte ingestion cap.`,
    );
  }
  switch (normalized) {
    case "application/pdf":
      if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new IngestionError(
          "unsupported_format",
          "File contents do not match the declared PDF type.",
        );
      }
      return "pdf";
    case "application/json": {
      const head = bytes.toString("utf8", 0, Math.min(bytes.length, 2048)).trimStart();
      if (!head.startsWith("{") && !head.startsWith("[")) {
        throw new IngestionError(
          "unsupported_format",
          "File contents do not match the declared JSON type.",
        );
      }
      return "json";
    }
    case "text/csv":
      if (bytes.includes(0)) {
        throw new IngestionError(
          "unsupported_format",
          "File contents do not match the declared CSV type.",
        );
      }
      return "csv";
    case "text/plain":
    case "text/markdown":
      if (bytes.includes(0)) {
        throw new IngestionError(
          "unsupported_format",
          "File contents do not match the declared text type.",
        );
      }
      return "text";
    default:
      throw new IngestionError(
        "unsupported_format",
        `Unsupported media type '${mediaType}'.`,
      );
  }
}

function guessMediaType(storageKey: string): string {
  const ext = path.extname(storageKey).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".json":
    case ".jsonl":
      return "application/json";
    case ".csv":
      return "text/csv";
    case ".md":
    case ".markdown":
      return "text/markdown";
    default:
      return "text/plain";
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function baseName(original: string | undefined): string {
  const base = path.basename(original ?? "").replace(/[^a-zA-Z0-9._-]+/g, "_");
  const trimmed = base
    .replace(/^_+|_+$/g, "")
    .replace(/\.[a-zA-Z0-9]{1,10}$/, "")
    .slice(0, 80);
  return trimmed.length > 0 ? trimmed : "document";
}
