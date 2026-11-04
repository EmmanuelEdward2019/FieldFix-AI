import { randomUUID } from "node:crypto";
import { decodeMaskToSVGPath } from "@meta-sam/parser";
import type { Kysely } from "kysely";
import { imageSize } from "image-size";
import type { AnnotationCoordinates, DeviceType } from "@fieldfix/contracts";
import type {
  Database,
  EvidenceAnnotation,
  ModelRun,
} from "../db/database.js";
import { SessionRepository } from "../db/repositories/sessions.js";
import { SettingsRepository } from "../db/repositories/settings.js";
import {
  AnnotationRepository,
  EvidenceFileRepository,
} from "../db/repositories/evidence.js";
import { ModelRunRepository } from "../db/repositories/model-runs.js";
import { StorageNotFoundError, type StorageAdapter } from "../storage/types.js";
import {
  ModelError,
  type SegmentedObject,
  type SegmentationProvider,
} from "../models/types.js";
import { defaultComponents } from "./components.js";

/**
 * Optional image segmentation for device components. Reads the
 * original evidence bytes (never modifies them), measures the image,
 * segments one concept per provider call, validates geometry against
 * the measured size, and persists box+mask annotations with the image
 * dimensions plus one model run per concept (task_type
 * "segmentation"). All-or-nothing per request: a provider or
 * validation failure persists nothing.
 *
 * Segmentation is localization, not diagnosis: labels come from our
 * component prompts, geometry never touches hypotheses, tests, or
 * reports, and runs are observably task-typed "segmentation".
 */

export type SegmentationErrorCode =
  | "session_not_found"
  | "file_not_found"
  | "not_an_image"
  | "unreadable_image"
  | "invalid_concepts"
  | "provider_failed";

export class SegmentationError extends Error {
  readonly code: SegmentationErrorCode;

  constructor(code: SegmentationErrorCode, message: string) {
    super(message);
    this.name = "SegmentationError";
    this.code = code;
  }
}

export interface SegmentationServiceDeps {
  db: Kysely<Database>;
  storage: StorageAdapter;
  provider: SegmentationProvider;
  modelId: string;
}

export interface SegmentOutcome {
  annotations: EvidenceAnnotation[];
  runs: ModelRun[];
  conceptsUsed: string[];
  warnings: string[];
  imageWidth: number;
  imageHeight: number;
}

const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export class SegmentationService {
  constructor(private readonly deps: SegmentationServiceDeps) {}

  async segment(
    sessionId: string,
    fileId: string,
    concepts?: string[],
  ): Promise<SegmentOutcome> {
    const { db, storage, provider } = this.deps;
    const enabled = await new SettingsRepository(db).get("ai.sam.enabled").catch(() => true);
    if (enabled === false) {
      throw new SegmentationError(
        "provider_failed",
        "The segmentation provider is disabled by the administrator.",
      );
    }
    const session = await new SessionRepository(db).getById(sessionId);
    if (!session) {
      throw new SegmentationError("session_not_found", "Unknown session.");
    }
    const file = await new EvidenceFileRepository(db).getById(fileId);
    if (!file || file.session_id !== sessionId) {
      throw new SegmentationError("file_not_found", "Unknown evidence file for this session.");
    }
    if (!IMAGE_MEDIA_TYPES.includes(file.media_type)) {
      throw new SegmentationError(
        "not_an_image",
        `Segmentation needs an image file; this file is ${file.media_type}.`,
      );
    }
    const resolved = resolveConcepts(concepts, session.device_type);

    let bytes: Buffer;
    try {
      bytes = await storage.get(file.storage_key);
    } catch (err) {
      if (err instanceof StorageNotFoundError) {
        throw new SegmentationError("file_not_found", "Evidence bytes are missing from storage.");
      }
      throw err;
    }
    const { width, height } = measureImage(bytes);

    // One provider call per concept (verified API shape). Failures
    // abort before anything is persisted.
    const perConcept: Array<{
      concept: string;
      objects: SegmentedObject[];
      warnings: string[];
      latencyMs: number;
      attempts: number;
      providerResponseId?: string;
    }> = [];
    const warnings: string[] = [];
    for (const concept of resolved) {
      let result;
      try {
        result = await provider.segment({
          image: bytes,
          mediaType: file.media_type,
          concept,
          imageWidth: width,
          imageHeight: height,
        });
      } catch (err) {
        throw toSegmentationError(err, concept);
      }
      if (result.objects.length === 0) {
        warnings.push(`No ${concept} found in the image.`);
      }
      warnings.push(...result.warnings.map((w) => `${concept}: ${w}`));
      perConcept.push({
        concept,
        objects: result.objects,
        warnings: result.warnings,
        latencyMs: result.latencyMs,
        attempts: result.attempts,
        providerResponseId: result.providerResponseId,
      });
    }

    const stored = await db.transaction().execute(async (trx) => {
      const runs = new ModelRunRepository(trx);
      const annotations = new AnnotationRepository(trx);
      const createdRuns: ModelRun[] = [];
      const createdAnnotations: EvidenceAnnotation[] = [];
      for (const item of perConcept) {
        const run = await runs.create({
          session_id: sessionId,
          provider: provider.id,
          model_id: this.deps.modelId,
          task_type: "segmentation",
          origin: "live",
          request_id: randomUUID(),
        });
        const finished = await runs.update(run.id, {
          status: "succeeded",
          latency_ms: item.latencyMs,
          input_modality: ["image"],
          validation_status: "passed",
          provider_response_id: item.providerResponseId ?? null,
        });
        createdRuns.push(finished ?? run);
        for (const object of item.objects) {
          createdAnnotations.push(
            await annotations.create({
              evidence_file_id: fileId,
              kind: "box",
              coordinates: {
                x: object.box.left,
                y: object.box.top,
                // Half-open bounds: width/height are plain differences.
                width: object.box.right - object.box.left,
                height: object.box.bottom - object.box.top,
              },
              label: item.concept,
              producer: this.deps.modelId,
              image_width: width,
              image_height: height,
              model_run_id: run.id,
            }),
          );
          createdAnnotations.push(
            await annotations.create({
              evidence_file_id: fileId,
              kind: "mask",
              coordinates: {
                rows: object.mask.rows,
                cols: object.mask.cols,
                data: object.mask.payload,
                bounds: { ...object.mask.bounds },
              },
              label: item.concept,
              producer: this.deps.modelId,
              image_width: width,
              image_height: height,
              model_run_id: run.id,
            }),
          );
        }
      }
      return { runs: createdRuns, annotations: createdAnnotations };
    });

    return {
      annotations: stored.annotations,
      runs: stored.runs,
      conceptsUsed: resolved,
      warnings,
      imageWidth: width,
      imageHeight: height,
    };
  }

  async list(fileId: string): Promise<EvidenceAnnotation[]> {
    return new AnnotationRepository(this.deps.db).listByFile(fileId);
  }

  /** Ownership check for reads that must not segment. */
  async listOwned(sessionId: string, fileId: string): Promise<boolean> {
    const file = await new EvidenceFileRepository(this.deps.db).getById(fileId);
    return file?.session_id === sessionId;
  }
}

function resolveConcepts(
  concepts: string[] | undefined,
  deviceType: DeviceType,
): string[] {
  const resolved = concepts ?? defaultComponents(deviceType);
  const cleaned = resolved.map((c) => c.trim()).filter((c) => c.length > 0);
  if (cleaned.length === 0 || cleaned.length > 8) {
    throw new SegmentationError(
      "invalid_concepts",
      "Provide between 1 and 8 component concepts.",
    );
  }
  for (const concept of cleaned) {
    if (concept.length > 80 || /[<|>]/.test(concept)) {
      throw new SegmentationError(
        "invalid_concepts",
        `Invalid concept ${JSON.stringify(concept.slice(0, 40))}: plain noun phrases only.`,
      );
    }
  }
  return [...new Set(cleaned)];
}

function measureImage(bytes: Buffer): { width: number; height: number } {
  try {
    const dims = imageSize(bytes);
    if (!dims.width || !dims.height || dims.width <= 0 || dims.height <= 0) {
      throw new SegmentationError("unreadable_image", "Could not measure the image.");
    }
    return { width: dims.width, height: dims.height };
  } catch (err) {
    if (err instanceof SegmentationError) {
      throw err;
    }
    throw new SegmentationError(
      "unreadable_image",
      "Could not decode the image to measure it.",
    );
  }
}

function toSegmentationError(err: unknown, concept: string): SegmentationError {
  if (err instanceof SegmentationError) {
    return err;
  }
  if (err instanceof ModelError) {
    return new SegmentationError(
      "provider_failed",
      `Segmentation of ${JSON.stringify(concept)} failed (${err.category}): ${err.message}`,
    );
  }
  return new SegmentationError(
    "provider_failed",
    `Segmentation of ${JSON.stringify(concept)} failed unexpectedly.`,
  );
}

/**
 * Render a persisted mask annotation to an SVG path in mask-raster
 * space. Returns null when undecodable — reads degrade, never throw.
 */
export function maskAnnotationToSvgPath(coordinates: AnnotationCoordinates): string | null {
  if (!("rows" in coordinates) || !("data" in coordinates)) {
    return null;
  }
  const marker = coordinates.data[0];
  if (marker !== "~" && marker !== "!") {
    return null;
  }
  try {
    return (
      decodeMaskToSVGPath({
        encoding: marker === "!" ? "one_bit" : "lossless",
        payload: coordinates.data,
        width: coordinates.cols,
        height: coordinates.rows,
      }) || null
    );
  } catch {
    return null;
  }
}
