import { parse } from "csv-parse/sync";
import { IngestionError, type NormalizedSection, type ParseResult } from "../types.js";

/**
 * CSV ingestion. Header row required; columns are matched
 * case-insensitively against known synonyms. At minimum a content
 * column must be present.
 */

const MAX_ROWS = 5000;

const CONTENT_KEYS = ["content", "text", "body", "description", "excerpt"];
const HEADING_KEYS = ["heading", "title", "section", "step", "name"];
const PAGE_KEYS = ["page", "page_number", "pagenumber"];
const MODEL_KEYS = ["model", "models", "model_applicability", "applicability"];
const COMPONENT_KEYS = ["component", "components", "parts", "component_tags"];
const SAFETY_KEYS = ["safety", "safety_tags", "warnings"];

function findKey(
  headers: string[],
  candidates: string[],
): string | null {
  const lowered = headers.map((h) => h.trim().toLowerCase());
  for (const candidate of candidates) {
    const index = lowered.indexOf(candidate);
    if (index >= 0) {
      return headers[index] as string;
    }
  }
  return null;
}

function splitList(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(/[;,|]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, 20);
}

export function parseCsv(bytes: Buffer): ParseResult {
  if (bytes.includes(0)) {
    throw new IngestionError(
      "parse_failed",
      "CSV input contains NUL bytes; refusing to parse as text.",
    );
  }
  let rows: Array<Record<string, string>>;
  try {
    rows = parse(bytes.toString("utf8"), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Array<Record<string, string>>;
  } catch (err) {
    throw new IngestionError(
      "parse_failed",
      `CSV could not be parsed: ${err instanceof Error ? err.message : "invalid"}.`,
    );
  }
  if (rows.length === 0) {
    throw new IngestionError("empty_document", "CSV has no data rows.");
  }
  if (rows.length > MAX_ROWS) {
    throw new IngestionError(
      "parse_failed",
      `CSV holds ${rows.length} rows; capped at ${MAX_ROWS}.`,
    );
  }
  const headers = Object.keys(rows[0] ?? {});
  const contentKey = findKey(headers, CONTENT_KEYS);
  if (!contentKey) {
    throw new IngestionError(
      "parse_failed",
      `CSV needs a content column (one of: ${CONTENT_KEYS.join(", ")}). Found: ${headers.join(", ") || "(none)"}.`,
    );
  }
  const headingKey = findKey(headers, HEADING_KEYS);
  const pageKey = findKey(headers, PAGE_KEYS);
  const modelKey = findKey(headers, MODEL_KEYS);
  const componentKey = findKey(headers, COMPONENT_KEYS);
  const safetyKey = findKey(headers, SAFETY_KEYS);

  const sections: NormalizedSection[] = [];
  let skipped = 0;
  for (const row of rows) {
    const content = (row[contentKey] ?? "").trim();
    if (content.length === 0) {
      skipped += 1;
      continue;
    }
    const pageRaw = pageKey ? Number.parseInt((row[pageKey] ?? "").trim(), 10) : NaN;
    sections.push({
      heading: headingKey && (row[headingKey] ?? "").trim()
        ? (row[headingKey] as string).trim().slice(0, 500)
        : null,
      pageNumber: Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : null,
      content: content.slice(0, 20000),
      stepOrder: null,
      safetyTags: safetyKey ? splitList(row[safetyKey]) : [],
      componentTags: componentKey ? splitList(row[componentKey]) : [],
      modelApplicability: modelKey ? splitList(row[modelKey]) : [],
    });
  }
  if (sections.length === 0) {
    throw new IngestionError("empty_document", "CSV rows have no readable content.");
  }
  return {
    format: "csv",
    sections,
    pagesNeedingOcr: [],
    warnings: skipped > 0 ? [`${skipped} empty row(s) skipped.`] : [],
  };
}
