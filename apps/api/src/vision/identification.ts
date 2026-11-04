import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import {
  IDENTIFY_JSON_SCHEMA,
  visionIdentificationSchema,
  type IdentifiedComponent,
  type SuspectedFaultArea,
} from "@fieldfix/contracts";
import type {
  Database,
  EvidenceAnnotation,
  EvidenceIdentification,
  ModelRun,
} from "../db/database.js";
import { IdentificationRepository } from "../db/repositories/identifications.js";
import { ModelRunRepository } from "../db/repositories/model-runs.js";
import { SessionRepository } from "../db/repositories/sessions.js";
import { EvidenceFileRepository } from "../db/repositories/evidence.js";
import { StorageNotFoundError, type StorageAdapter } from "../storage/types.js";
import { ModelError, type ModelProvider } from "../models/types.js";
import { SegmentationError, SegmentationService } from "./service.js";
import { defaultComponents } from "./components.js";

/**
 * Visual device/component identification: an additive intelligence
 * layer over evidence images. The vision model names the device and
 * visible components (with confidence) and nominates at most one
 * suspected fault area as a *visual hypothesis*; high/medium
 * components are then localized with SAM so the viewer can highlight
 * them. Identification never touches hypotheses, tests, reports, or
 * the safety controller — the diagnostic sequence is unchanged, and
 * a failed identification degrades to warnings, never a block.
 */

export type IdentificationErrorCode =
  | "session_not_found"
  | "file_not_found"
  | "not_supported"
  | "provider_failed";

export class IdentificationError extends Error {
  readonly code: IdentificationErrorCode;

  constructor(code: IdentificationErrorCode, message: string) {
    super(message);
    this.name = "IdentificationError";
    this.code = code;
  }
}

export interface IdentificationServiceDeps {
  db: Kysely<Database>;
  storage: StorageAdapter;
  vision: ModelProvider;
  modelId: string;
  /** Absent in minimal deployments: identification without masks. */
  segmentation?: SegmentationService;
}

export interface IdentifyOutcome {
  identification: EvidenceIdentification;
  annotations: EvidenceAnnotation[];
  runs: ModelRun[];
  conceptsUsed: string[];
  warnings: string[];
}

const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
/** SAM takes at most 8 concepts; low-confidence names stay unlocalized. */
const MAX_LOCALIZE_CONCEPTS = 8;

const INSTRUCTIONS = `You identify devices and components in a repair photo. Reply with a single JSON object matching the required schema.

- device_name: the device shown (e.g. "HP Pavilion 15 laptop"), or null when it cannot be determined.
- components: every reliably recognizable part with confidence high, medium, or low. Name plainly ("cooling fan", not "the round spinning thing"). Never invent names for unclear regions.
- suspected_fault_area: the ONE component whose visible condition best matches the reported symptoms, with a short visual rationale — or null when nothing in the image points at the fault. This is a visual observation only: NEVER declare a component faulty, failed, or in need of replacement.
- unidentifiable: short descriptions of visible regions or objects you cannot confidently name (e.g. "small connector at the top edge"). Empty array when everything visible is named.

Component names must be plain noun phrases without <, |, or > characters.`;

export class IdentificationService {
  constructor(private readonly deps: IdentificationServiceDeps) {}

  async identify(sessionId: string, fileId: string): Promise<IdentifyOutcome> {
    const { db, storage, vision } = this.deps;
    const session = await new SessionRepository(db).getById(sessionId);
    if (!session) {
      throw new IdentificationError("session_not_found", "Unknown session.");
    }
    const file = await new EvidenceFileRepository(db).getById(fileId);
    if (!file || file.session_id !== sessionId) {
      throw new IdentificationError("file_not_found", "Unknown evidence file for this session.");
    }
    if (!IMAGE_MEDIA_TYPES.includes(file.media_type)) {
      throw new IdentificationError(
        "not_supported",
        file.media_type.startsWith("video/")
          ? "Component identification works on photos; video has no frame extraction yet."
          : `Component identification needs an image file; this file is ${file.media_type}.`,
      );
    }

    let bytes: Buffer;
    try {
      bytes = await storage.get(file.storage_key);
    } catch (err) {
      if (err instanceof StorageNotFoundError) {
        throw new IdentificationError("file_not_found", "Evidence bytes are missing from storage.");
      }
      throw err;
    }

    const runs = new ModelRunRepository(db);
    const run = await runs.create({
      session_id: sessionId,
      provider: vision.id,
      model_id: this.deps.modelId,
      task_type: "identification",
      origin: "live",
      request_id: randomUUID(),
    });

    let result;
    try {
      result = await vision.complete({
        instructions: INSTRUCTIONS,
        textSections: [
          { heading: "Device", body: deviceContext(session) },
          { heading: "Reported symptoms (context only)", body: session.symptoms.slice(0, 2000) },
        ],
        images: [{ mediaType: file.media_type, bytes, evidenceFileId: fileId }],
        jsonSchema: {
          name: IDENTIFY_JSON_SCHEMA.name,
          schema: IDENTIFY_JSON_SCHEMA.schema as unknown as Record<string, unknown>,
          strict: true,
        },
        effort: "low",
        maxOutputTokens: 2000,
      });
    } catch (err) {
      await runs.update(run.id, { status: "failed" });
      throw toIdentificationError(err);
    }

    const parsed = parseVisionOutput(result.text);
    if (!parsed) {
      await runs.update(run.id, { status: "failed" });
      throw new IdentificationError(
        "provider_failed",
        "The vision model returned an unparseable identification.",
      );
    }
    const finished = await runs.update(run.id, {
      status: "succeeded",
      latency_ms: result.latencyMs,
      input_modality: ["image"],
      validation_status: "passed",
      provider_response_id: result.providerResponseId ?? null,
    });

    const identification = await new IdentificationRepository(db).create({
      session_id: sessionId,
      evidence_file_id: fileId,
      device_name: parsed.deviceName,
      components: parsed.components,
      suspected_fault_area: parsed.suspected,
      unidentifiable: parsed.unidentifiable,
      model_run_id: run.id,
    });

    // Localize high/medium names with SAM. Partial by design: a
    // localization failure warns instead of failing the request.
    const warnings: string[] = [];
    let annotations: EvidenceAnnotation[] = [];
    let conceptsUsed: string[] = [];
    const segmentRuns: ModelRun[] = [];
    const concepts = localizableConcepts(parsed.components);
    if (concepts.length === 0) {
      warnings.push("No confident component names to locate on the image.");
    } else if (!this.deps.segmentation) {
      warnings.push("Component localization is unavailable; names only.");
    } else {
      try {
        const outcome = await this.deps.segmentation.segment(sessionId, fileId, concepts);
        annotations = outcome.annotations;
        conceptsUsed = outcome.conceptsUsed;
        segmentRuns.push(...outcome.runs);
        warnings.push(...outcome.warnings);
      } catch (err) {
        warnings.push(
          err instanceof SegmentationError
            ? `Component localization skipped: ${err.message}`
            : "Component localization skipped unexpectedly.",
        );
      }
    }

    // Fallback: vision sometimes names parts SAM cannot ground
    // ("metal shielding cover" on a wide bench shot). When nothing
    // localized, sweep the deterministic device vocabulary so the
    // photo still gets SAM boxes instead of a bare image. Annotated
    // labels then come from these prompts, never from model output.
    if (annotations.length === 0 && this.deps.segmentation) {
      try {
        const fallback = await this.deps.segmentation.segment(
          sessionId,
          fileId,
          defaultComponents(session.device_type),
        );
        annotations = fallback.annotations;
        conceptsUsed = [...conceptsUsed, ...fallback.conceptsUsed];
        segmentRuns.push(...fallback.runs);
        if (fallback.annotations.length > 0) {
          warnings.push(
            "Named parts could not be grounded, so generic device parts were outlined instead.",
          );
        }
        warnings.push(...fallback.warnings);
      } catch (err) {
        warnings.push(
          err instanceof SegmentationError
            ? `Generic outline sweep skipped: ${err.message}`
            : "Generic outline sweep skipped unexpectedly.",
        );
      }
    }

    return {
      identification,
      annotations,
      runs: [finished ?? run, ...segmentRuns],
      conceptsUsed,
      warnings,
    };
  }

  /** Latest identification for a file, or undefined when never run. */
  async getLatest(sessionId: string, fileId: string): Promise<EvidenceIdentification | undefined> {
    const file = await new EvidenceFileRepository(this.deps.db).getById(fileId);
    if (!file || file.session_id !== sessionId) {
      throw new IdentificationError("file_not_found", "Unknown evidence file for this session.");
    }
    return new IdentificationRepository(this.deps.db).getLatest(fileId);
  }
}

function deviceContext(session: { device_type: string; manufacturer: string | null; model: string | null }): string {
  const parts = [session.device_type, session.manufacturer, session.model].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  return parts.join(" ").slice(0, 300);
}

function parseVisionOutput(text: string): {
  deviceName: string | null;
  components: IdentifiedComponent[];
  suspected: SuspectedFaultArea | null;
  unidentifiable: string[];
} | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  const validated = visionIdentificationSchema.safeParse(raw);
  if (!validated.success) {
    return null;
  }
  const data = validated.data;
  const seen = new Set<string>();
  const components: IdentifiedComponent[] = [];
  for (const item of data.components) {
    const name = item.name.trim();
    if (name.length === 0) {
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    components.push({
      name: name.slice(0, 120),
      confidence: item.confidence,
      note: item.note?.trim() ? item.note.trim().slice(0, 500) : null,
    });
  }
  const deviceName = data.device_name?.trim() ? data.device_name.trim().slice(0, 200) : null;
  const suspectedName = data.suspected_fault_area?.component_name.trim() ?? "";
  const suspectedRationale = data.suspected_fault_area?.rationale.trim() ?? "";
  return {
    deviceName,
    components,
    suspected:
      suspectedName.length > 0 && suspectedRationale.length > 0
        ? {
          component_name: suspectedName.slice(0, 120),
          rationale: suspectedRationale.slice(0, 1000),
        }
        : null,
    unidentifiable: [...new Set(data.unidentifiable.map((u) => u.trim()).filter((u) => u.length > 0))].map(
      (u) => u.slice(0, 300),
    ),
  };
}

/** High/medium names that survive SAM's plain-phrase rules, capped. */
function localizableConcepts(components: IdentifiedComponent[]): string[] {
  const names: string[] = [];
  for (const item of components) {
    if (item.confidence === "low") {
      continue;
    }
    const name = item.name.trim();
    if (name.length === 0 || name.length > 80 || /[<|>]/.test(name)) {
      continue;
    }
    if (!names.includes(name)) {
      names.push(name);
    }
    if (names.length >= MAX_LOCALIZE_CONCEPTS) {
      break;
    }
  }
  return names;
}

function toIdentificationError(err: unknown): IdentificationError {
  if (err instanceof IdentificationError) {
    return err;
  }
  if (err instanceof ModelError) {
    return new IdentificationError(
      "provider_failed",
      `Component identification failed (${err.category}): ${err.message}`,
    );
  }
  return new IdentificationError("provider_failed", "Component identification failed unexpectedly.");
}
