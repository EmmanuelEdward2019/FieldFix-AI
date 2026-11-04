import type { ReasoningContext } from "@fieldfix/contracts";

/**
 * Provider-agnostic model interface. Diagnostic code depends only on
 * these types; Meta specifics live in ./meta/.
 */

export type CallModality = "text" | "image";

export interface PromptImage {
  mediaType: string;
  /** Raw image bytes; the provider encodes for transport. */
  bytes: Buffer;
  /** FieldFix evidence id, for tracing (never sent to the provider). */
  evidenceFileId?: string;
}

export interface TextSection {
  heading: string;
  body: string;
}

/** Provider-neutral reasoning prompt. */
export interface ProviderPrompt {
  instructions: string;
  textSections: TextSection[];
  images: PromptImage[];
  /** JSON Schema the response must conform to (provider-enforced). */
  jsonSchema: { name: string; schema: Record<string, unknown>; strict: boolean };
  effort: string;
  maxOutputTokens: number;
}

export interface UsageInfo {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ProviderTextResult {
  text: string;
  usage?: UsageInfo;
  providerResponseId?: string;
  model: string;
  latencyMs: number;
  attempts: number;
  /** True when the provider answered but cut the reply off (ping only). */
  truncated?: boolean;
}

export type ModelErrorCategory =
  | "config"
  | "auth"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "payload_too_large"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "unsupported_modality"
  | "refusal"
  | "empty_response"
  | "incomplete"
  | "malformed_response"
  | "validation_failed"
  | "unknown";

/** Categorized, safe-to-surface model failure. Never holds secrets. */
export class ModelError extends Error {
  readonly category: ModelErrorCategory;
  readonly retryable: boolean;
  readonly status?: number;
  readonly providerCode?: string;
  /** Provider-requested retry delay (Retry-After), when supplied. */
  retryAfterMs?: number;

  constructor(
    category: ModelErrorCategory,
    message: string,
    options: {
      retryable?: boolean;
      status?: number;
      providerCode?: string;
      retryAfterMs?: number;
    } = {},
  ) {
    super(message);
    this.name = "ModelError";
    this.category = category;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.providerCode = options.providerCode;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export interface CompleteOptions {
  signal?: AbortSignal;
}

export interface ModelProvider {
  readonly id: string;
  readonly modalities: readonly CallModality[];
  complete(prompt: ProviderPrompt, options?: CompleteOptions): Promise<ProviderTextResult>;
}

/** One concept prompt sent to a segmentation model. */
export interface SegmentCallInput {
  image: Buffer;
  mediaType: string;
  /** Short noun phrase naming one concrete object (SAM concept prompt). */
  concept: string;
  /** Measured source pixels; the provider must echo these on the wire. */
  imageWidth: number;
  imageHeight: number;
}

/**
 * One validated box+mask pair in source pixels. Boxes are half-open
 * (the official parser converts the wire's inclusive corners);
 * mask payloads are verbatim, marker included.
 */
export interface SegmentedObject {
  objectId: string;
  box: { left: number; top: number; right: number; bottom: number };
  mask: {
    rows: number;
    cols: number;
    encoding: "lossless" | "one_bit";
    payload: string;
    bounds: { left: number; top: number; right: number; bottom: number };
  };
}

export interface SegmentationResult {
  model: string;
  objects: SegmentedObject[];
  warnings: string[];
  latencyMs: number;
  attempts: number;
  providerResponseId?: string;
}

/** Image segmentation behind the provider abstraction (SAM 3.1 on Meta). */
export interface SegmentationProvider {
  readonly id: string;
  segment(input: SegmentCallInput): Promise<SegmentationResult>;
}

/** Verified Meta ASR file modes (official speech-to-text docs). */
export type TranscriptionMode = "PUSH_TO_TALK" | "ENDPOINTING" | "DIARIZATION";

export interface TranscribeFileInput {
  /** Raw audio bytes; the provider encodes for transport. */
  audio: Buffer;
  mediaType: string;
  mode?: TranscriptionMode;
  languageBias?: string;
  keywords?: string[];
}

/** One turn-level transcript segment (Meta has no word timestamps). */
export interface TranscriptTurn {
  turnId: string;
  startMs: number;
  endMs: number;
  transcript: string;
  speaker?: string;
}

export interface TranscriptResult {
  transcript: string;
  audioDurationMs?: number;
  turns: TranscriptTurn[];
  providerResponseId?: string;
  model: string;
  latencyMs: number;
  attempts: number;
}

/**
 * Speech-to-text behind the provider abstraction (Meta Voice
 * Transcribe on the file endpoint). Mirrors SegmentationProvider.
 */
export interface TranscriptionProvider {
  readonly id: string;
  /** False when credentials/config are missing (route maps to 501). */
  readonly configured: boolean;
  transcribeFile(
    input: TranscribeFileInput,
    options?: CompleteOptions,
  ): Promise<TranscriptResult>;
}

/** Task-name alias for the speech-to-text provider seam. */
export type SpeechToTextProvider = TranscriptionProvider;

export interface SpeechSynthesisRequest {
  text: string;
  language?: string;
  rate?: number;
  voiceId?: string | null;
}

/**
 * Speak policy for browser speechSynthesis. The server never
 * generates audio (no verified Meta TTS API exists); audioBase64
 * is always null so clients can assert "no fake audio".
 */
export interface SpeechSynthesisPolicy {
  text: string;
  ssml: string;
  language: string;
  rate: number;
  voiceId: string | null;
  mode: "browser-speech-synthesis";
  audioBase64: null;
}

/** Text-to-speech seam: browser-relay policies only in Phase 1. */
export interface TextToSpeechProvider {
  readonly id: string;
  synthesizeSpeech(input: SpeechSynthesisRequest): Promise<SpeechSynthesisPolicy>;
}

/** Validated diagnostic context plus raw evidence for one reasoning call. */
export interface ReasoningCallInput {
  context: ReasoningContext;
  evidence: Array<{
    fileId: string;
    mediaType: string;
    bytes: Buffer;
  }>;
}
