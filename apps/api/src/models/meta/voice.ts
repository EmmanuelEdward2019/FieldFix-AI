import {
  ModelError,
  type CompleteOptions,
  type TranscribeFileInput,
  type TranscriptResult,
  type TranscriptTurn,
  type TranscriptionProvider,
} from "../types.js";
import { categorizeHttpFailure, truncate } from "./errors.js";

type FetchFn = typeof fetch;

export interface VoiceAdapterConfig {
  apiKey?: string;
  /** Trimmed base URL (default https://api.meta.ai/v1). */
  baseUrl: string;
  /** Env-configured model id (default muse-voice-transcribe-1.0). */
  modelId: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface VoiceAdapterOptions {
  fetchFn?: FetchFn;
  /** Injected for deterministic retry tests. Defaults to setTimeout. */
  sleepMs?: (ms: number) => Promise<void>;
  /** Injected jitter source. Defaults to Math.random. */
  random?: () => number;
  now?: () => number;
}

const RETRY_AFTER_CAP_MS = 60_000;

/** WAV container magic: RIFF....WAVE (defense in depth; routes validate first). */
function isWavMediaType(mediaType: string): boolean {
  return mediaType === "audio/wav" || mediaType === "audio/x-wav";
}

/**
 * Meta Voice Transcribe adapter (file endpoint only).
 *
 * Verified against the official Meta docs: POST {baseUrl}/asr/transcribe
 * with multipart `request` (JSON) + `audio` parts and a Bearer [REDACTED]
 * Realtime WebSocket is intentionally NOT implemented here (handshake
 * details were not fully verified; it stays a documented stretch goal).
 * The endpoint is STT-only: it never synthesizes speech.
 */
export class MetaVoiceTranscribeAdapter implements TranscriptionProvider {
  readonly id = "meta-voice";
  readonly configured: boolean;

  private readonly fetchFn: FetchFn;
  private readonly sleepMs: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(
    private readonly config: VoiceAdapterConfig,
    options: VoiceAdapterOptions = {},
  ) {
    this.configured = (config.apiKey?.length ?? 0) > 0;
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleepMs =
      options.sleepMs ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  async transcribeFile(
    input: TranscribeFileInput,
    options: CompleteOptions = {},
  ): Promise<TranscriptResult> {
    if (!this.config.apiKey) {
      throw new ModelError(
        "config",
        "Voice transcription is not configured (META_API_KEY).",
      );
    }
    if (!isWavMediaType(input.mediaType)) {
      throw new ModelError(
        "invalid_request",
        `Voice transcription requires WAV audio; got ${truncate(input.mediaType, 80)}.`,
      );
    }
    const started = this.now();
    let attempts = 0;
    let lastError: ModelError | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      attempts = attempt + 1;
      try {
        const result = await this.attempt(input, options.signal);
        return { ...result, attempts, latencyMs: this.now() - started };
      } catch (err) {
        lastError = err instanceof ModelError
          ? err
          : new ModelError("unknown", "Unexpected voice adapter failure.");
        if (!lastError.retryable || attempt >= this.config.maxRetries) {
          throw lastError;
        }
        await this.sleepMs(this.retryDelayMs(attempt, lastError));
      }
    }
    throw lastError ?? new ModelError("unknown", "Unexpected voice adapter failure.");
  }

  private async attempt(
    input: TranscribeFileInput,
    outerSignal?: AbortSignal,
  ): Promise<TranscriptResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const onOuterAbort = () => controller.abort();
    outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
    try {
      const requestPart: Record<string, unknown> = {
        model: this.config.modelId,
        audioEncoding: "WAV",
      };
      if (input.mode) {
        requestPart.mode = input.mode;
      }
      if (input.languageBias) {
        requestPart.languageBias = input.languageBias;
      }
      if (input.keywords?.length) {
        requestPart.keywords = input.keywords;
      }
      const form = new FormData();
      form.append(
        "request",
        new Blob([JSON.stringify(requestPart)], { type: "application/json" }),
      );
      form.append(
        "audio",
        new Blob([input.audio as unknown as BlobPart], { type: "audio/wav" }),
        "audio.wav",
      );
      const response = await this.fetchFn(
        `${this.config.baseUrl}/asr/transcribe`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey as string}`,
            Accept: "application/json",
          },
          body: form,
          signal: controller.signal,
        },
      );
      const text = await response.text();
      if (!response.ok) {
        // 406 (unsupported audio characteristics) has no shared branch;
        // map it here so callers see invalid_request, never unknown.
        if (response.status === 406) {
          throw new ModelError(
            "invalid_request",
            `Provider rejected the audio characteristics (HTTP 406)${detailSuffix(text)}.`,
            { status: 406 },
          );
        }
        const failure = categorizeHttpFailure(response.status, text);
        failure.retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
        throw failure;
      }
      return this.parseSuccess(text);
    } catch (err) {
      if (err instanceof ModelError) {
        throw err;
      }
      if (isAbort(err)) {
        throw new ModelError(
          "timeout",
          `Voice transcription timed out after ${this.config.timeoutMs}ms.`,
          { retryable: true },
        );
      }
      throw new ModelError("unavailable", "Could not reach the Meta voice API.", {
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener("abort", onOuterAbort);
    }
  }

  private parseSuccess(text: string): TranscriptResult {
    let root: unknown;
    try {
      root = JSON.parse(text) as unknown;
    } catch {
      throw new ModelError("malformed_response", "Voice provider returned invalid JSON.");
    }
    const obj = asRecord(root);
    // An empty transcript (silence) is honest output; a missing one is not.
    if (typeof obj?.transcript !== "string") {
      throw new ModelError(
        "malformed_response",
        "Voice provider response has no transcript.",
      );
    }
    const duration = obj.audioDurationMs;
    return {
      transcript: obj.transcript,
      audioDurationMs:
        typeof duration === "number" && Number.isInteger(duration) && duration >= 0
          ? duration
          : undefined,
      turns: parseTurns(obj.turns),
      providerResponseId:
        typeof obj.sessionId === "string" ? obj.sessionId : undefined,
      model:
        typeof obj.model === "string" ? obj.model : this.config.modelId,
      latencyMs: 0,
      attempts: 0,
    };
  }

  private retryDelayMs(attempt: number, err: ModelError): number {
    // Same policy as the reasoning adapter: 2^attempt seconds +
    // jitter, honoring Retry-After when the provider sends one.
    const backoff = 2 ** attempt * 1000 + Math.floor(this.random() * 1000);
    if (err.retryAfterMs !== undefined) {
      return Math.min(Math.max(err.retryAfterMs, backoff), RETRY_AFTER_CAP_MS);
    }
    return backoff;
  }
}

function parseTurns(value: unknown): TranscriptTurn[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const turns: TranscriptTurn[] = [];
  for (const entry of value) {
    const turn = asRecord(entry);
    if (
      !turn ||
      typeof turn.turnId !== "string" ||
      !isNonNegativeInt(turn.startMs) ||
      !isNonNegativeInt(turn.endMs) ||
      typeof turn.transcript !== "string"
    ) {
      continue;
    }
    turns.push({
      turnId: turn.turnId,
      startMs: turn.startMs,
      endMs: turn.endMs,
      transcript: turn.transcript,
      speaker: typeof turn.speaker === "string" ? turn.speaker : undefined,
    });
  }
  return turns;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function detailSuffix(bodyText: string): string {
  const message = asRecord(asRecord(safeJson(bodyText))?.error)?.message;
  return typeof message === "string" && message.length > 0
    ? `: ${truncate(message, 200)}`
    : "";
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isAbort(err: unknown): boolean {
  return (
    (typeof err === "object" && err !== null && "name" in err &&
      (err as { name?: unknown }).name === "AbortError") ||
    (typeof DOMException !== "undefined" && err instanceof DOMException &&
      err.name === "AbortError")
  );
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number.parseInt(header.trim(), 10);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return seconds * 1000;
}
