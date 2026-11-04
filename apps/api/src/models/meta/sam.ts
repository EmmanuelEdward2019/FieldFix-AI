import {
  decodeMaskToRaster,
  frameIndexOf,
  parseImageStream,
  recordsOfKind,
  type ImageSegmentationResult,
  type SegmentationMask,
} from "@meta-sam/parser";
import {
  ModelError,
  type SegmentCallInput,
  type SegmentedObject,
  type SegmentationProvider,
  type SegmentationResult,
} from "../types.js";
import type { MetaAdapterOptions, MetaLogger } from "./client.js";
import { categorizeHttpFailure } from "./errors.js";

/**
 * SAM 3.1 segmentation over the Responses API, verified against
 * https://dev.meta.ai/docs/sam/* (Oct 2026): model `sam-3.1`, one
 * concept prompt per request, streamed `output_text` in the documented
 * box/mask token grammar, `metadata.mask_encoding: one_bit`, parsed
 * with the official @meta-sam/parser. Images only — FieldFix evidence
 * is stills; video tracking is out of scope.
 *
 * Transport mirrors MetaModelAdapter (auth, timeout, retries, safe
 * logging). Geometry is validated before it is returned: single frame
 * `<0f>`, paired box+mask records, wire w/h echoing the measured
 * image size, in-range coordinates, bounded mask rasters, and a
 * successful mask decode per record.
 */

export interface SamAdapterConfig {
  apiKey?: string;
  baseUrl: string;
  modelId: string;
  timeoutMs: number;
  maxRetries: number;
  maxImageBytes: number;
}

const RETRY_AFTER_CAP_MS = 60_000;
const BASE_RETRY_MS = 500;
const MAX_MASK_DIM = 4096;
const MAX_MASK_PIXELS = 16_777_216;

const noopLogger: MetaLogger = {
  info: () => undefined,
  warn: () => undefined,
};

export class SamSegmentationAdapter implements SegmentationProvider {
  readonly id = "meta-sam";

  private readonly fetchFn: typeof fetch;
  private readonly logger: MetaLogger;
  private readonly sleepMs: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(
    private readonly config: SamAdapterConfig,
    options: MetaAdapterOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.logger = options.logger ?? noopLogger;
    this.sleepMs =
      options.sleepMs ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  async segment(input: SegmentCallInput): Promise<SegmentationResult> {
    if (!this.config.apiKey) {
      throw new ModelError(
        "config",
        "Meta API key is not configured (META_API_KEY).",
      );
    }
    if (input.image.length > this.config.maxImageBytes) {
      throw new ModelError("payload_too_large", "Image exceeds the segmentation size cap.", {
        retryable: false,
      });
    }
    if (/[<|>]/.test(input.concept)) {
      // A concept reaches input_text verbatim; token characters could
      // smuggle object prompts into the grammar. Reject locally.
      throw new ModelError("invalid_request", "Concept must be a plain noun phrase.", {
        retryable: false,
      });
    }
    const started = this.now();
    let attempts = 0;
    let lastError: ModelError | null = null;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      attempts = attempt + 1;
      try {
        const result = await this.attempt(input);
        this.logger.info("meta.sam_response", {
          model: this.config.modelId,
          objects: result.objects.length,
          latencyMs: this.now() - started,
          attempts,
        });
        return { ...result, latencyMs: this.now() - started, attempts };
      } catch (err) {
        lastError = err instanceof ModelError
          ? err
          : new ModelError("unknown", "Unexpected segmentation failure.");
        if (!lastError.retryable || attempt >= this.config.maxRetries) {
          this.logger.warn("meta.sam_failed", {
            category: lastError.category,
            attempts,
            status: lastError.status,
          });
          throw lastError;
        }
        await this.sleepMs(this.retryDelayMs(attempt, lastError));
      }
    }
    throw lastError ?? new ModelError("unknown", "Unexpected segmentation failure.");
  }

  private async attempt(input: SegmentCallInput): Promise<
    Omit<SegmentationResult, "latencyMs" | "attempts">
  > {
    const body = {
      model: this.config.modelId,
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: input.concept },
            {
              type: "input_image",
              image_url: `data:${input.mediaType};base64,${input.image.toString("base64")}`,
            },
          ],
        },
      ],
      stream: true,
      metadata: { mask_encoding: "one_bit" },
      store: false,
    };
    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.baseUrl}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      throw toTransportError(err);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw categorizeHttpFailure(response.status, text);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      throw new ModelError(
        "malformed_response",
        "Segmentation response is not a stream.",
        { retryable: false },
      );
    }
    let parsed;
    try {
      parsed = parseImageStream(this.readEvents(response));
      for await (const _snapshot of parsed) {
        // Drain snapshots; the final result carries the records.
      }
    } catch (err) {
      throw toStreamError(err);
    }
    let result;
    try {
      result = await parsed.finalResult;
    } catch (err) {
      throw toStreamError(err);
    }
    if (result.outcome.status !== "completed") {
      throw new ModelError("incomplete", "Segmentation ended before completion.", {
        retryable: false,
      });
    }
    return this.toSegmentationResult(result, input);
  }

  private async *readEvents(
    response: Response,
  ): AsyncGenerator<{ type: string } & Record<string, unknown>> {
    const body = response.body as unknown as AsyncIterable<Uint8Array> | null;
    if (!body) {
      throw new ModelError("malformed_response", "Segmentation stream has no body.", {
        retryable: false,
      });
    }
    const decoder = new TextDecoder();
    let buffer = "";
    const drain = function* (flush: boolean): Generator<string> {
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = flush ? "" : (parts.pop() ?? "");
      for (const part of parts) {
        yield part;
      }
    };
    const emit = function* (
      block: string,
    ): Generator<{ type: string } & Record<string, unknown>> {
      const dataLines: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith(":")) {
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      if (dataLines.length === 0) {
        return;
      }
      const data = dataLines.join("\n");
      if (data === "[DONE]") {
        return;
      }
      let event: unknown;
      try {
        event = JSON.parse(data) as unknown;
      } catch {
        throw new ModelError("malformed_response", "Segmentation stream has invalid JSON.", {
          retryable: false,
        });
      }
      if (
        typeof event !== "object" || event === null || !("type" in event) ||
        typeof (event as { type: unknown }).type !== "string"
      ) {
        throw new ModelError("malformed_response", "Segmentation stream event has no type.", {
          retryable: false,
        });
      }
      yield event as { type: string } & Record<string, unknown>;
    };
    try {
      for await (const chunk of body) {
        buffer += decoder.decode(chunk, { stream: true });
        for (const block of drain(false)) {
          yield* emit(block);
        }
      }
      buffer += decoder.decode();
      for (const block of drain(true)) {
        yield* emit(block);
      }
    } catch (err) {
      if (err instanceof ModelError) {
        throw err;
      }
      throw new ModelError("unavailable", "Segmentation stream was interrupted.", {
        retryable: true,
      });
    }
  }

  private toSegmentationResult(
    result: ImageSegmentationResult,
    input: SegmentCallInput,
  ): Omit<SegmentationResult, "latencyMs" | "attempts"> {
    for (const diagnostic of result.diagnostics) {
      if (diagnostic.severity === "error") {
        throw new ModelError(
          "malformed_response",
          `Segmentation output failed to parse (${diagnostic.code}).`,
          { retryable: false },
        );
      }
    }
    const warnings = result.diagnostics.map((d) => d.message);
    const boxes = recordsOfKind(result.records, "box");
    const masks = recordsOfKind(result.records, "mask");
    for (const record of result.records) {
      if (record.kind !== "box" && record.kind !== "mask") {
        throw new ModelError(
          "malformed_response",
          "Segmentation output holds an unexpected record.",
          { retryable: false },
        );
      }
    }
    assertWireDims(result.rawOutput, input.imageWidth, input.imageHeight);
    const masksByObject = new Map(masks.map((m) => [m.objectId, m]));
    if (masksByObject.size !== masks.length || boxes.length !== masks.length) {
      throw new ModelError(
        "malformed_response",
        "Segmentation records do not pair one box with one mask.",
        { retryable: false },
      );
    }
    const objects: SegmentedObject[] = [];
    for (const box of boxes) {
      // Image records carry no frame (video frames would be numbered).
      if (!isImageFrame(frameIndexOf(box))) {
        throw new ModelError(
          "malformed_response",
          "Segmentation returned a non-image frame.",
          { retryable: false },
        );
      }
      const mask = masksByObject.get(box.objectId);
      if (!mask || !isImageFrame(frameIndexOf(mask))) {
        throw new ModelError(
          "malformed_response",
          "Segmentation records do not pair one box with one mask.",
          { retryable: false },
        );
      }
      assertBoxInRange(box, input.imageWidth, input.imageHeight);
      assertMaskDecodable(mask.mask);
      objects.push({
        objectId: box.objectId,
        box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
        mask: {
          rows: mask.mask.height,
          cols: mask.mask.width,
          encoding: mask.mask.encoding,
          payload: mask.mask.payload,
          bounds: {
            left: mask.bounds.left,
            top: mask.bounds.top,
            right: mask.bounds.right,
            bottom: mask.bounds.bottom,
          },
        },
      });
    }
    return { model: this.config.modelId, objects, warnings };
  }

  private retryDelayMs(attempt: number, err: ModelError): number {
    if (err.retryAfterMs !== undefined) {
      return Math.min(err.retryAfterMs, RETRY_AFTER_CAP_MS);
    }
    const backoff = BASE_RETRY_MS * 2 ** attempt;
    return Math.min(backoff + Math.floor(this.random() * BASE_RETRY_MS), RETRY_AFTER_CAP_MS);
  }
}

function toTransportError(err: unknown): ModelError {
  if (err instanceof ModelError) {
    return err;
  }
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new ModelError("timeout", "Segmentation request timed out.", { retryable: true });
  }
  return new ModelError("unavailable", "Segmentation provider is unreachable.", {
    retryable: true,
  });
}

function toStreamError(err: unknown): ModelError {
  if (err instanceof ModelError) {
    return err;
  }
  if (err instanceof Error) {
    const name = err.name;
    if (name === "ResponsesStreamFailedError") {
      return new ModelError("unavailable", "Segmentation failed mid-stream.", {
        retryable: false,
      });
    }
    if (name === "ResponsesStreamRefusalError") {
      return new ModelError("refusal", "Segmentation was refused.", { retryable: false });
    }
    return new ModelError("malformed_response", `Segmentation stream error: ${name}.`, {
      retryable: false,
    });
  }
  return new ModelError("malformed_response", "Segmentation stream error.", {
    retryable: false,
  });
}

function isImageFrame(frame: number | undefined): boolean {
  return frame === undefined || frame === 0;
}

/** Every record must echo the measured image size (docs: w/h = source). */
function assertWireDims(rawOutput: string, width: number, height: number): void {
  const seen = [...rawOutput.matchAll(/w=(\d+);h=(\d+)/g)];
  for (const match of seen) {
    if (Number(match[1]) !== width || Number(match[2]) !== height) {
      throw new ModelError(
        "validation_failed",
        "Segmentation geometry targets a different image size.",
        { retryable: false },
      );
    }
  }
}

function assertBoxInRange(
  box: { left: number; top: number; right: number; bottom: number },
  width: number,
  height: number,
): void {
  // Half-open bounds from the official parser: right/bottom are exclusive.
  const valid = [box.left, box.top, box.right, box.bottom].every(
    (n) => Number.isInteger(n) && n >= 0,
  ) &&
    box.left < box.right &&
    box.top < box.bottom &&
    box.right <= width &&
    box.bottom <= height;
  if (!valid) {
    throw new ModelError("validation_failed", "Segmentation box lies outside the image.", {
      retryable: false,
    });
  }
}

function assertMaskDecodable(mask: SegmentationMask): void {
  if (
    !Number.isInteger(mask.width) || !Number.isInteger(mask.height) ||
    mask.width <= 0 || mask.height <= 0 ||
    mask.width > MAX_MASK_DIM || mask.height > MAX_MASK_DIM ||
    mask.width * mask.height > MAX_MASK_PIXELS
  ) {
    throw new ModelError("validation_failed", "Segmentation mask dimensions are invalid.", {
      retryable: false,
    });
  }
  try {
    const raster = decodeMaskToRaster(mask);
    if (raster.length !== mask.width * mask.height) {
      throw new ModelError("validation_failed", "Segmentation mask raster has the wrong size.", {
        retryable: false,
      });
    }
  } catch (err) {
    if (err instanceof ModelError) {
      throw err;
    }
    throw new ModelError("validation_failed", "Segmentation mask payload is undecodable.", {
      retryable: false,
    });
  }
}
