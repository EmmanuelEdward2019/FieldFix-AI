import { z } from "zod";
import type { AdminUploadMetadata } from "@fieldfix/contracts";
import { IngestionError } from "../types.js";
import { assertSourcePermitted } from "../sources.js";
import { IngestionService, type IngestOutcome } from "../pipeline.js";

/**
 * iFixit API connector (PRD 5.1.2). Fetches ONE explicitly listed
 * public guide per call — no search, no catalogue crawl. Verified
 * against the official OpenAPI spec (https://www.ifixit.com/api/2.0):
 * GET /guides/{guideid}, public, BY-NC-SA non-commercial, LLM
 * training prohibited. Refuses to run until the operator records the
 * licence acknowledgement.
 */

export const DEFAULT_IFIXIT_BASE_URL = "https://www.ifixit.com/api/2.0";
const FETCH_TIMEOUT_MS = 30_000;

const guideLineSchema = z.object({ text_raw: z.string() }).passthrough();
const guideStepSchema = z
  .object({
    orderby: z.number(),
    title: z.string(),
    lines: z.array(guideLineSchema),
  })
  .passthrough();
const guideSchema = z
  .object({
    guideid: z.number(),
    title: z.string().min(1),
    subject: z.string().optional(),
    category: z.string().optional(),
    type: z.string().optional(),
    url: z.string().optional(),
    revisionid: z.number().optional(),
    summary: z.string().optional(),
    steps: z.array(guideStepSchema),
  })
  .passthrough();

export type IfixitGuide = z.infer<typeof guideSchema>;

export interface IfixitClientOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export class IfixitClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: IfixitClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_IFIXIT_BASE_URL).replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async fetchGuide(guideId: number): Promise<IfixitGuide> {
    if (!Number.isInteger(guideId) || guideId <= 0) {
      throw new IngestionError("fetch_failed", `Invalid iFixit guide id: ${guideId}.`);
    }
    let response: Response;
    try {
      response = await this.fetchFn(
        `${this.baseUrl}/guides/${guideId}`,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
    } catch (err) {
      throw new IngestionError(
        "fetch_failed",
        `Could not reach the iFixit API: ${err instanceof Error ? err.message : "network error"}.`,
      );
    }
    if (response.status === 404) {
      throw new IngestionError("ref_not_found", `iFixit guide ${guideId} not found.`);
    }
    if (!response.ok) {
      throw new IngestionError(
        "fetch_failed",
        `iFixit API returned HTTP ${response.status} for guide ${guideId}.`,
      );
    }
    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      throw new IngestionError("fetch_failed", "iFixit API returned invalid JSON.");
    }
    const parsed = guideSchema.safeParse(payload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new IngestionError(
        "fetch_failed",
        `Unexpected iFixit guide shape: ${first?.path.join(".") || "?"} — ${first?.message || "schema violation"}.`,
      );
    }
    return parsed.data;
  }
}

export interface IfixitImportOptions {
  guideId: number;
  metadata?: Partial<AdminUploadMetadata>;
  client?: IfixitClient;
  env?: NodeJS.ProcessEnv;
}

/** Fetch one guide and ingest its steps as a single document. */
export async function importIfixitGuide(
  pipeline: IngestionService,
  options: IfixitImportOptions,
): Promise<IngestOutcome> {
  assertSourcePermitted("ifixit_api", options.env ?? process.env);
  const client = options.client ?? new IfixitClient();
  const guide = await client.fetchGuide(options.guideId);
  const generic = {
    title: guide.title,
    sections: guide.steps.map((step) => ({
      heading: step.title.trim().length > 0
        ? `Step ${step.orderby}: ${step.title.trim()}`.slice(0, 500)
        : `Step ${step.orderby}`,
      page: null,
      content: step.lines.map((l) => l.text_raw.trim()).filter((t) => t.length > 0).join(" ").slice(0, 20000),
      step_order: Number.isInteger(step.orderby) && step.orderby > 0 ? step.orderby : null,
      safety_tags: [],
      component_tags: guide.subject ? [guide.subject.slice(0, 80)] : [],
      model_applicability: guide.category ? [guide.category.slice(0, 120)] : [],
    })).filter((s) => s.content.length > 0),
  };
  if (generic.sections.length === 0) {
    throw new IngestionError("empty_document", `iFixit guide ${guide.guideid} has no step text.`);
  }
  return pipeline.ingestFile({
    bytes: Buffer.from(JSON.stringify(generic)),
    mediaType: "application/json",
    filename: `ifixit-guide-${guide.guideid}.json`,
    metadata: {
      title: guide.title.slice(0, 500),
      manufacturer: null,
      device_family: guide.category?.slice(0, 120) ?? null,
      model_numbers: [],
      document_type: "repair_guide",
      source_name: "iFixit API",
      source_url: guide.url?.slice(0, 2000) ?? `https://www.ifixit.com/Guide/${guide.guideid}`,
      version: guide.revisionid !== undefined ? `guide-${guide.guideid}-rev-${guide.revisionid}` : `guide-${guide.guideid}`,
      language: "en",
      licence_name: "CC BY-NC-SA 3.0",
      permission_status: "pending",
      ...options.metadata,
    },
    sourceId: "ifixit_api",
    sourceName: "iFixit API",
  });
}
