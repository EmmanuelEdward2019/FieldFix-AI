import {
  ModelError,
  type CompleteOptions,
  type ModelProvider,
  type ProviderPrompt,
  type ProviderTextResult,
  type UsageInfo,
} from "../types.js";
import type { MetaAdapterConfig } from "./config.js";
import { categorizeHttpFailure, truncate } from "./errors.js";

type FetchFn = typeof fetch;

export interface MetaLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
}

const noopLogger: MetaLogger = {
  info: () => undefined,
  warn: () => undefined,
};

export interface MetaAdapterOptions {
  fetchFn?: FetchFn;
  logger?: MetaLogger;
  /** Injected for deterministic retry tests. Defaults to setTimeout. */
  sleepMs?: (ms: number) => Promise<void>;
  /** Injected jitter source. Defaults to Math.random. */
  random?: () => number;
  now?: () => number;
}

interface ResponsesBody {
  model: string;
  instructions: string;
  input: unknown[];
  text: {
    format: { type: "json_schema"; name: string; strict: boolean; schema: unknown };
  };
  reasoning: { effort: string };
  max_output_tokens: number;
  store: false;
}

const RETRY_AFTER_CAP_MS = 60_000;

/**
 * Meta Model API adapter (Responses API, `POST /v1/responses`).
 * Single place for auth, transport, retries, parsing, and logging.
 * Credentials, prompts, and image bytes never reach logs.
 */
export class MetaModelAdapter implements ModelProvider {
  readonly id = "meta";
  readonly modalities = ["text", "image"] as const;

  private readonly fetchFn: FetchFn;
  private readonly logger: MetaLogger;
  private readonly sleepMs: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(
    private readonly config: MetaAdapterConfig,
    options: MetaAdapterOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.logger = options.logger ?? noopLogger;
    this.sleepMs =
      options.sleepMs ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  /**
   * Minimal live call used by the admin connection test. Never used in the
   * diagnostic loop. A cut-off reply still proves connectivity, auth, and a
   * working account, so truncation resolves (flagged) instead of throwing;
   * every other failure category still throws.
   */
  async ping(signal?: AbortSignal): Promise<ProviderTextResult> {
    const started = this.now();
    try {
      return await this.complete(
        {
          instructions: "Reply with exactly: ok",
          textSections: [{ heading: "Ping", body: "Reply with exactly: ok" }],
          images: [],
          jsonSchema: {
            name: "ping",
            strict: false,
            schema: { type: "object", properties: { reply: { type: "string" } } },
          },
          effort: "minimal",
          maxOutputTokens: 64,
        },
        { signal },
      );
    } catch (err) {
      if (err instanceof ModelError && err.category === "incomplete") {
        return {
          text: "",
          model: this.config.modelId,
          latencyMs: this.now() - started,
          attempts: 1,
          truncated: true,
        };
      }
      throw err;
    }
  }

  async complete(
    prompt: ProviderPrompt,
    options: CompleteOptions = {},
  ): Promise<ProviderTextResult> {
    if (!this.config.apiKey) {
      throw new ModelError(
        "config",
        "Meta API key is not configured (META_API_KEY).",
      );
    }
    const body = this.buildBody(prompt);
    const started = this.now();
    let attempts = 0;
    let lastError: ModelError | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      attempts = attempt + 1;
      try {
        const result = await this.attempt(body, options.signal);
        this.logger.info("meta.response", {
          model: result.model,
          latencyMs: this.now() - started,
          attempts,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          providerResponseId: result.providerResponseId,
        });
        return { ...result, attempts, latencyMs: this.now() - started };
      } catch (err) {
        lastError = err instanceof ModelError
          ? err
          : new ModelError("unknown", "Unexpected adapter failure.");
        if (!lastError.retryable || attempt >= this.config.maxRetries) {
          this.logger.warn("meta.response_failed", {
            category: lastError.category,
            attempts,
            status: lastError.status,
          });
          throw lastError;
        }
        const delay = this.retryDelayMs(attempt, lastError);
        this.logger.info("meta.retry", {
          category: lastError.category,
          attempt: attempts,
          delayMs: delay,
        });
        await this.sleepMs(delay);
      }
    }
    throw lastError ?? new ModelError("unknown", "Unexpected adapter failure.");
  }

  private buildBody(prompt: ProviderPrompt): ResponsesBody {
    const content: unknown[] = prompt.textSections.map((section) => ({
      type: "input_text",
      text: `# ${section.heading}\n${section.body}`,
    }));
    for (const image of prompt.images) {
      content.push({
        type: "input_image",
        image_url: `data:${image.mediaType};base64,${image.bytes.toString("base64")}`,
        detail: "auto",
      });
    }
    return {
      model: this.config.modelId,
      instructions: prompt.instructions,
      input: [{ type: "message", role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: prompt.jsonSchema.name,
          strict: prompt.jsonSchema.strict,
          schema: prompt.jsonSchema.schema,
        },
      },
      reasoning: { effort: prompt.effort },
      max_output_tokens: prompt.maxOutputTokens,
      store: false,
    };
  }

  private async attempt(
    body: ResponsesBody,
    outerSignal?: AbortSignal,
  ): Promise<ProviderTextResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const onOuterAbort = () => controller.abort();
    outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
    try {
      const response = await this.fetchFn(`${this.config.baseUrl}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey as string}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        const failure = categorizeHttpFailure(response.status, text);
        failure.retryAfterMs = parseRetryAfter(
          response.headers.get("retry-after"),
        );
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
          `Meta request timed out after ${this.config.timeoutMs}ms.`,
          { retryable: true },
        );
      }
      throw new ModelError(
        "unavailable",
        "Could not reach the Meta API.",
        { retryable: true },
      );
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener("abort", onOuterAbort);
    }
  }

  private parseSuccess(text: string): ProviderTextResult {
    let root: unknown;
    try {
      root = JSON.parse(text) as unknown;
    } catch {
      throw new ModelError(
        "malformed_response",
        "Provider returned invalid JSON.",
      );
    }
    const obj = asRecord(root);
    const status = obj?.status;
    if (status === "failed") {
      throw new ModelError("unavailable", "Provider failed to complete.", {
        retryable: true,
      });
    }
    if (status === "incomplete") {
      const details = truncate(JSON.stringify(obj?.incomplete_details ?? null), 300);
      throw new ModelError(
        "incomplete",
        `Provider response incomplete: ${details}.`,
      );
    }
    if (status !== "completed") {
      throw new ModelError(
        "malformed_response",
        "Provider response has an unexpected status.",
      );
    }
    const { text: combined, refused } = extractOutputText(obj?.output);
    if (refused) {
      throw new ModelError(
        "refusal",
        "Provider refused the request.",
      );
    }
    if (combined.length === 0) {
      throw new ModelError("empty_response", "Provider returned no text.");
    }
    const usage = parseUsage(obj?.usage);
    const responseId = typeof obj?.id === "string" ? obj.id : undefined;
    const model =
      typeof obj?.model === "string" ? obj.model : this.config.modelId;
    return {
      text: combined,
      usage,
      providerResponseId: responseId,
      model,
      latencyMs: 0,
      attempts: 0,
    };
  }

  private retryDelayMs(attempt: number, err: ModelError): number {
    // Docs: 2^attempt seconds + jitter, starting ~0.5–1s.
    const backoff = 2 ** attempt * 1000 + Math.floor(this.random() * 1000);
    if (err.retryAfterMs !== undefined) {
      return Math.min(Math.max(err.retryAfterMs, backoff), RETRY_AFTER_CAP_MS);
    }
    return backoff;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Walk output[] → message items → output_text (SDK helper reimplemented). */
function extractOutputText(output: unknown): { text: string; refused: boolean } {
  const parts: string[] = [];
  let refused = false;
  for (const item of asArray(output)) {
    const node = asRecord(item);
    if (!node) {
      continue;
    }
    if (node.type === "refusal" || asRecord(node.refusal)) {
      refused = true;
      continue;
    }
    const content =
      node.type === "message" ? asArray(node.content) : asArray(node.output);
    for (const part of content) {
      const block = asRecord(part);
      if (!block) {
        continue;
      }
      if (block.type === "output_text" && typeof block.text === "string") {
        parts.push(block.text);
      } else if (block.type === "refusal") {
        refused = true;
      }
    }
    // Flat message shape: {type:"message", text} is not documented; ignore.
  }
  return { text: parts.join(""), refused };
}

function parseUsage(value: unknown): UsageInfo | undefined {
  const obj = asRecord(value);
  if (!obj) {
    return undefined;
  }
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;
  const usage: UsageInfo = {
    inputTokens: num(obj.input_tokens),
    outputTokens: num(obj.output_tokens),
    totalTokens: num(obj.total_tokens),
  };
  return usage.inputTokens === undefined &&
      usage.outputTokens === undefined &&
      usage.totalTokens === undefined
    ? undefined
    : usage;
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
