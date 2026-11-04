/** Shared ingestion shapes. Parsers produce sections; the pipeline stores chunks. */

export type ParsedFormat =
  | "myfixit_json"
  | "generic_json"
  | "csv"
  | "pdf"
  | "text";

/** One headed block of source content, before size-bounded chunking. */
export interface NormalizedSection {
  heading: string | null;
  /** 1-based page number, when the source has pages. */
  pageNumber: number | null;
  content: string;
  /** 1-based step position for repair-guide sources, when known. */
  stepOrder: number | null;
  safetyTags: string[];
  componentTags: string[];
  modelApplicability: string[];
}

export interface ParseResult {
  format: ParsedFormat;
  sections: NormalizedSection[];
  /** 1-based pages with negligible extractable text (scanned candidates). */
  pagesNeedingOcr: number[];
  warnings: string[];
}

export type IngestionErrorCode =
  | "source_not_permitted"
  | "source_disabled"
  | "permission_rejected"
  | "duplicate"
  | "unsupported_format"
  | "parse_failed"
  | "empty_document"
  | "fetch_failed"
  | "ref_not_found"
  | "file_too_large"
  | "ocr_unavailable"
  | "storage_failed"
  | "no_stored_bytes"
  | "internal";

/** Categorized ingestion failure. Safe to surface to admin callers. */
export class IngestionError extends Error {
  readonly code: IngestionErrorCode;
  /** Existing document id for duplicates. */
  readonly duplicateOf?: string;

  constructor(code: IngestionErrorCode, message: string, options: { duplicateOf?: string } = {}) {
    super(message);
    this.name = "IngestionError";
    this.code = code;
    this.duplicateOf = options.duplicateOf;
  }
}
