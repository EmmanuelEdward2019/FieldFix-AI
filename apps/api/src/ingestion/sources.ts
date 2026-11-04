import { IngestionError } from "./types.js";

/**
 * Explicitly permitted ingestion sources (PRD 5.1, docs/DATA_SOURCES.md).
 * Anything not listed here is refused — there is no generic URL fetcher
 * and no unrestricted scraper.
 */

export type SourceId =
  | "admin_upload"
  | "manufacturer_docs"
  | "myfixit_dataset"
  | "ifixit_api";

export interface SourceTerms {
  id: SourceId;
  displayName: string;
  licence: string;
  termsNote: string;
  /** Env var holding the operator's recorded licence acknowledgement. */
  ackEnvVar: string | null;
  /** Exact ack value required, when acknowledgement applies. */
  ackValue: string | null;
}

export const PERMITTED_SOURCES: Record<SourceId, SourceTerms> = {
  admin_upload: {
    id: "admin_upload",
    displayName: "Admin file upload",
    licence: "Per-file, declared by the uploading admin",
    termsNote:
      "The admin asserts authority to import each file and records its licence. Files stay in private storage.",
    ackEnvVar: null,
    ackValue: null,
  },
  manufacturer_docs: {
    id: "manufacturer_docs",
    displayName: "Manufacturer documentation",
    licence: "Per-document, declared at upload",
    termsNote:
      "Official troubleshooting pages, safety notices, or manuals whose terms permit import. Source URL, version, and permission metadata are retained; permission_status starts at pending until reviewed.",
    ackEnvVar: null,
    ackValue: null,
  },
  myfixit_dataset: {
    id: "myfixit_dataset",
    displayName: "MyFixit Dataset (local checkout)",
    licence: "CC BY-NC-SA 3.0",
    termsNote:
      "Research dataset derived from iFixit repair manuals. Non-commercial, share-alike, attribution required. Import only from a local checkout the operator has verified — never fetched remotely by the server.",
    ackEnvVar: "MYFIXIT_LICENCE_ACK",
    ackValue: "CC-BY-NC-SA-3.0",
  },
  ifixit_api: {
    id: "ifixit_api",
    displayName: "iFixit API (explicit guides only)",
    licence: "CC BY-NC-SA 3.0 (non-commercial)",
    termsNote:
      "Official API at https://www.ifixit.com/api/2.0. Non-commercial use; commercial use needs iFixit API-team permission; training LLMs on the content is prohibited. Only explicitly listed guide ids are fetched — no catalogue crawl.",
    ackEnvVar: "IFIXIT_INGEST_ACK",
    ackValue: "CC-BY-NC-SA-3.0",
  },
};

export function isKnownSourceId(value: string): value is SourceId {
  return (Object.keys(PERMITTED_SOURCES) as string[]).includes(value);
}

/**
 * Fail closed: unknown sources are refused, and ack-gated sources
 * refuse to run until the operator records the exact licence ack.
 */
export function assertSourcePermitted(
  sourceId: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): SourceTerms {
  if (!isKnownSourceId(sourceId)) {
    throw new IngestionError(
      "source_not_permitted",
      `Unknown ingestion source '${sourceId}'. Only explicitly permitted sources may be ingested (see docs/DATA_SOURCES.md).`,
    );
  }
  const terms = PERMITTED_SOURCES[sourceId];
  if (terms.ackEnvVar && terms.ackValue) {
    if (env[terms.ackEnvVar] !== terms.ackValue) {
      throw new IngestionError(
        "source_disabled",
        `'${terms.displayName}' is disabled: set ${terms.ackEnvVar}=${terms.ackValue} after reviewing the licence (${terms.licence}).`,
      );
    }
  }
  return terms;
}
