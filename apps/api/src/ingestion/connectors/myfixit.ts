import { readFile, stat } from "node:fs/promises";
import type { AdminUploadMetadata } from "@fieldfix/contracts";
import { IngestionError } from "../types.js";
import { splitJsonRecords, parseMyFixitRecord } from "../parsers/json.js";
import { assertSourcePermitted } from "../sources.js";
import { IngestionService, type IngestOutcome } from "../pipeline.js";

/**
 * MyFixit dataset connector (PRD 5.1.1). Reads a LOCAL checkout of the
 * dataset's jsons/*.json category files (JSON arrays or JSONL, one
 * manual per record) and ingests up to `limit` manuals as individual
 * documents. The server never fetches the dataset remotely, and the
 * connector refuses to run until the operator records the CC BY-NC-SA
 * 3.0 acknowledgement (see docs/DATA_SOURCES.md).
 *
 * Verified against https://github.com/rub-ksv/MyFixit-Dataset:
 * 15 category files, records with Title/Ancestors/Guidid/Category/
 * Subject/Url/Steps[].
 */

export const MAX_MYFIXIT_FILE_BYTES = 100 * 1024 * 1024;

export interface MyFixitImportOptions {
  filePath: string;
  limit?: number;
  metadata?: Partial<AdminUploadMetadata>;
  env?: NodeJS.ProcessEnv;
}

export interface MyFixitImportResult {
  filePath: string;
  recordsSeen: number;
  imported: Array<{ title: string; documentId: string; jobId: string; chunks: number }>;
  duplicates: Array<{ title: string; documentId: string; jobId: string }>;
  failed: Array<{ title: string; jobId: string | null; error: string }>;
  skippedInvalid: number;
}

export async function importMyFixitFile(
  pipeline: IngestionService,
  options: MyFixitImportOptions,
): Promise<MyFixitImportResult> {
  assertSourcePermitted("myfixit_dataset", options.env ?? process.env);
  const limit = options.limit ?? 25;
  let size = 0;
  try {
    size = (await stat(options.filePath)).size;
  } catch {
    throw new IngestionError(
      "ref_not_found",
      `MyFixit file not found: ${options.filePath}. Clone the dataset locally first (see docs/DATA_SOURCES.md).`,
    );
  }
  if (size > MAX_MYFIXIT_FILE_BYTES) {
    throw new IngestionError(
      "file_too_large",
      `MyFixit file is ${size} bytes; capped at ${MAX_MYFIXIT_FILE_BYTES}.`,
    );
  }
  const bytes = await readFile(options.filePath);
  const records = splitJsonRecords(bytes);
  const result: MyFixitImportResult = {
    filePath: options.filePath,
    recordsSeen: records.length,
    imported: [],
    duplicates: [],
    failed: [],
    skippedInvalid: 0,
  };
  let attempted = 0;
  for (const value of records) {
    if (attempted >= limit) {
      break;
    }
    let title = "(untitled record)";
    try {
      const record = parseMyFixitRecord(value);
      title = record.Title;
      attempted += 1;
      const outcome: IngestOutcome = await pipeline.ingestFile({
        bytes: Buffer.from(JSON.stringify(record)),
        mediaType: "application/json",
        filename: `myfixit-${record.Guidid ?? attempted}.json`,
        metadata: {
          title: record.Title.slice(0, 500),
          manufacturer: null,
          device_family: record.Ancestors.find((a) => a !== "Root") ?? null,
          model_numbers: record.Category ? [record.Category.slice(0, 120)] : [],
          document_type: "repair_guide",
          source_name: "MyFixit Dataset",
          source_url: record.Url?.slice(0, 2000) ?? null,
          version: record.Guidid !== undefined ? `guide-${record.Guidid}` : null,
          language: "en",
          licence_name: "CC BY-NC-SA 3.0",
          permission_status: "pending",
          ...options.metadata,
        },
        sourceId: "myfixit_dataset",
        sourceName: "MyFixit Dataset",
      });
      if (outcome.status === "indexed") {
        result.imported.push({
          title,
          documentId: outcome.document.id,
          jobId: outcome.jobId,
          chunks: outcome.chunks.length,
        });
      } else if (outcome.status === "duplicate") {
        result.duplicates.push({
          title,
          documentId: outcome.document.id,
          jobId: outcome.jobId,
        });
      } else {
        result.failed.push({
          title,
          jobId: outcome.jobId,
          error: outcome.error,
        });
      }
    } catch (err) {
      result.skippedInvalid += 1;
      result.failed.push({
        title,
        jobId: null,
        error: err instanceof Error ? err.message : "invalid record",
      });
    }
  }
  return result;
}
