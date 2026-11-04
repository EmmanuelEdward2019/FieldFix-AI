import { z } from "zod";
import { IngestionError, type NormalizedSection, type ParseResult } from "../types.js";

/**
 * JSON ingestion. Two shapes:
 * - MyFixit repair-manual records (Title/Guidid/Steps/Lines), as a single
 *   record, a JSON array, or newline-delimited JSON (the category files
 *   in jsons/*.json are JSONL).
 * - Generic FieldFix JSON: { title?, sections: [{ heading?, page?,
 *   content, ... }] } for admin-authored imports.
 */

/** Cap direct-upload arrays so one file can't explode into documents. */
const MAX_UPLOAD_RECORDS = 200;

const myFixitLineSchema = z.object({ Text: z.string() }).passthrough();
const myFixitStepSchema = z
  .object({
    Order: z.number(),
    Text_raw: z.string().optional(),
    Lines: z.array(myFixitLineSchema).optional().default([]),
    Word_level_parts_clean: z.array(z.string()).optional().default([]),
  })
  .passthrough();

const myFixitRecordSchema = z
  .object({
    Title: z.string().min(1),
    Guidid: z.number().optional(),
    Category: z.string().optional(),
    Subject: z.string().optional(),
    Ancestors: z.array(z.string()).optional().default([]),
    Url: z.string().optional(),
    Steps: z.array(myFixitStepSchema).min(1),
  })
  .passthrough();

export type MyFixitRecord = z.infer<typeof myFixitRecordSchema>;

const genericSectionSchema = z.object({
  heading: z.string().max(500).nullable().optional(),
  page: z.number().int().positive().nullable().optional(),
  content: z.string().min(1).max(20000),
  step_order: z.number().int().positive().nullable().optional(),
  safety_tags: z.array(z.string().min(1).max(80)).max(20).optional().default([]),
  component_tags: z.array(z.string().min(1).max(80)).max(20).optional().default([]),
  model_applicability: z.array(z.string().min(1).max(120)).max(20).optional().default([]),
});

const genericDocumentSchema = z.object({
  title: z.string().max(500).optional(),
  sections: z.array(genericSectionSchema).min(1).max(2000),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Split raw bytes into candidate records: array, JSONL, or single. */
export function splitJsonRecords(bytes: Buffer): unknown[] {
  const text = bytes.toString("utf8").trim();
  if (text.length === 0) {
    throw new IngestionError("empty_document", "JSON input is empty.");
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (isRecord(parsed) && Array.isArray(parsed.manuals)) {
      return parsed.manuals;
    }
    return [parsed];
  } catch {
    // Fall back to newline-delimited JSON (MyFixit category files).
    const records: unknown[] = [];
    for (const [index, line] of text.split("\n").entries()) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      try {
        records.push(JSON.parse(trimmed) as unknown);
      } catch {
        throw new IngestionError(
          "parse_failed",
          `JSON input is neither a document nor JSONL (line ${index + 1} is invalid).`,
        );
      }
    }
    if (records.length === 0) {
      throw new IngestionError("parse_failed", "JSON input could not be parsed.");
    }
    return records;
  }
}

export function parseMyFixitRecord(value: unknown): MyFixitRecord {
  const parsed = myFixitRecordSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new IngestionError(
      "parse_failed",
      `Invalid MyFixit record: ${first?.path.join(".") || "?"} — ${first?.message || "schema violation"}.`,
    );
  }
  return parsed.data;
}

export function myFixitRecordToSections(record: MyFixitRecord): NormalizedSection[] {
  const applicability = [
    ...(record.Category ? [record.Category] : []),
    ...record.Ancestors.filter((a) => a !== "Root" && a !== record.Category).slice(0, 3),
  ];
  return record.Steps.map((step) => {
    const lines = step.Lines.map((l) => l.Text.trim()).filter((t) => t.length > 0);
    const content = (step.Text_raw?.trim() || lines.join(" ")).trim();
    return {
      heading: `Step ${step.Order}`,
      pageNumber: null,
      content,
      stepOrder: Number.isInteger(step.Order) && step.Order > 0 ? step.Order : null,
      safetyTags: [],
      componentTags: [...new Set(step.Word_level_parts_clean.map((p) => p.trim()).filter((p) => p.length > 0))].slice(0, 20),
      modelApplicability: applicability,
    };
  }).filter((s) => s.content.length > 0);
}

/** Parse uploaded JSON bytes into sections (single or multi-record). */
export function parseJson(bytes: Buffer): ParseResult {
  const records = splitJsonRecords(bytes);
  if (records.length === 0) {
    throw new IngestionError("empty_document", "JSON input has no records.");
  }
  const first = records[0];
  const looksMyFixit =
    isRecord(first) && typeof first.Title === "string" && Array.isArray(first.Steps);

  if (looksMyFixit) {
    if (records.length > MAX_UPLOAD_RECORDS) {
      throw new IngestionError(
        "parse_failed",
        `JSON holds ${records.length} manuals; direct uploads are capped at ${MAX_UPLOAD_RECORDS} — use the myfixit_dataset connector with a limit instead.`,
      );
    }
    const sections: NormalizedSection[] = [];
    const warnings: string[] = [];
    for (const [index, value] of records.entries()) {
      try {
        const record = parseMyFixitRecord(value);
        const recordSections = myFixitRecordToSections(record);
        if (recordSections.length > 0 && records.length > 1) {
          const head = recordSections[0];
          if (head) {
            head.heading = `${record.Title} — ${head.heading ?? "Step 1"}`;
          }
        }
        sections.push(...recordSections);
      } catch (err) {
        warnings.push(
          `record ${index + 1} skipped: ${err instanceof Error ? err.message : "invalid"}`,
        );
      }
    }
    if (sections.length === 0) {
      throw new IngestionError("empty_document", "No valid MyFixit records found in JSON input.");
    }
    return { format: "myfixit_json", sections, pagesNeedingOcr: [], warnings };
  }

  if (records.length > 1 || !isRecord(first)) {
    throw new IngestionError(
      "parse_failed",
      "JSON must be a MyFixit record (or array/JSONL of records) or a { title?, sections[] } document.",
    );
  }
  const parsed = genericDocumentSchema.safeParse(first);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new IngestionError(
      "parse_failed",
      `Invalid generic JSON: ${issue?.path.join(".") || "?"} — ${issue?.message || "schema violation"}.`,
    );
  }
  return {
    format: "generic_json",
    sections: parsed.data.sections.map((s) => ({
      heading: s.heading ?? null,
      pageNumber: s.page ?? null,
      content: s.content,
      stepOrder: s.step_order ?? null,
      safetyTags: s.safety_tags,
      componentTags: s.component_tags,
      modelApplicability: s.model_applicability,
    })),
    pagesNeedingOcr: [],
    warnings: [],
  };
}
