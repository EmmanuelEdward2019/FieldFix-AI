import { describe, expect, it, vi } from "vitest";
import { MetaModelAdapter } from "../../src/models/meta/client.js";
import type { MetaAdapterConfig } from "../../src/models/meta/config.js";
import {
  ModelError,
  type ProviderPrompt,
} from "../../src/models/types.js";

const API_KEY = "test-meta-key-redacted-in-assertions";

const CONFIG: MetaAdapterConfig = {
  apiKey: API_KEY,
  baseUrl: "https://api.meta.ai/v1",
  modelId: "muse-spark-1.3",
  timeoutMs: 5000,
  maxRetries: 2,
  reasoningEffort: "medium",
  maxOutputTokens: 4000,
  maxImagesPerRequest: 8,
  maxImageBytes: 10 * 1024 * 1024,
};

function prompt(overrides: Partial<ProviderPrompt> = {}): ProviderPrompt {
  return {
    instructions: "test instructions",
    textSections: [{ heading: "Device", body: "Category: laptop" }],
    images: [],
    jsonSchema: { name: "diagnostic_assessment", schema: {}, strict: true },
    effort: "medium",
    maxOutputTokens: 4000,
    ...overrides,
  };
}

function completedResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successBody(text: string): Record<string, unknown> {
  return {
    id: "resp_abc123",
    model: "muse-spark-1.3",
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text }],
      },
    ],
    usage: { input_tokens: 120, output_tokens: 45, total_tokens: 165 },
  };
}

function errorResponse(
  status: number,
  providerBody: string,
  retryAfter?: string,
): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (retryAfter !== undefined) {
    headers["retry-after"] = retryAfter;
  }
  return new Response(providerBody, { status, headers });
}

function adapterWith(
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
  overrides: Partial<MetaAdapterConfig> = {},
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const sleeps: number[] = [];
  const logs: Array<{ level: string; message: string; fields?: unknown }> = [];
  const adapter = new MetaModelAdapter(
    { ...CONFIG, ...overrides },
    {
      fetchFn: ((url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return fetchFn(String(url), init ?? {});
      }) as typeof fetch,
      sleepMs: (ms: number) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      random: () => 0,
      logger: {
        info: (message, fields) => logs.push({ level: "info", message, fields }),
        warn: (message, fields) => logs.push({ level: "warn", message, fields }),
      },
    },
  );
  return { adapter, calls, sleeps, logs };
}

function requestBody(calls: Array<{ init: RequestInit }>): Record<string, unknown> {
  return JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
}

describe("MetaModelAdapter (mocked transport)", () => {
  it("posts a Responses request and parses output_text + usage", async () => {
    const { adapter, calls } = adapterWith(async () =>
      completedResponse(successBody('{"summary":"ok"}')),
    );
    const result = await adapter.complete(
      prompt({ images: [{ mediaType: "image/png", bytes: Buffer.from([1, 2, 3]) }] }),
    );

    expect(result.text).toBe('{"summary":"ok"}');
    expect(result.model).toBe("muse-spark-1.3");
    expect(result.providerResponseId).toBe("resp_abc123");
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 45, totalTokens: 165 });
    expect(result.attempts).toBe(1);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.meta.ai/v1/responses");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    const body = requestBody(calls);
    expect(body.model).toBe("muse-spark-1.3");
    expect(body.store).toBe(false);
    expect(body.reasoning).toEqual({ effort: "medium" });
    expect(body.max_output_tokens).toBe(4000);
    const format = (body.text as { format: Record<string, unknown> }).format;
    expect(format.type).toBe("json_schema");
    expect(format.strict).toBe(true);
    const content = (
      (body.input as Array<{ content: unknown[] }>)[0]?.content ?? []
    ) as Array<Record<string, unknown>>;
    expect(content.some((c) => c.type === "input_text")).toBe(true);
    const image = content.find((c) => c.type === "input_image");
    expect(String(image?.image_url)).toBe(
      `data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`,
    );
  });

  it("concatenates output_text across multiple message items", async () => {
    const { adapter } = adapterWith(async () =>
      completedResponse({
        id: "resp_multi",
        status: "completed",
        output: [
          { type: "message", content: [{ type: "output_text", text: '{"a":' }] },
          { type: "message", content: [{ type: "output_text", text: "1}" }] },
        ],
      }),
    );
    const result = await adapter.complete(prompt());
    expect(result.text).toBe('{"a":1}');
  });

  it("fails fast when no API key is configured (no fetch)", async () => {
    const fetchFn = vi.fn();
    const { adapter } = adapterWith(fetchFn as never, { apiKey: undefined });
    await expect(adapter.complete(prompt())).rejects.toMatchObject({
      category: "config",
      retryable: false,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not retry authentication failures", async () => {
    const { adapter, calls } = adapterWith(async () =>
      errorResponse(401, '{"error":{"code":"invalid_api_key","message":"bad key"}}'),
    );
    const err = await adapter.complete(prompt()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err as ModelError).toMatchObject({ category: "auth", retryable: false });
    expect(calls).toHaveLength(1);
  });

  it("maps unknown models to not_found without retry", async () => {
    const { adapter, calls } = adapterWith(async () =>
      errorResponse(404, '{"error":{"code":"model_not_found","message":"no such model"}}'),
    );
    const err = await adapter.complete(prompt()).catch((e: unknown) => e);
    expect(err as ModelError).toMatchObject({ category: "not_found", retryable: false });
    expect(calls).toHaveLength(1);
  });

  it("retries rate limits honoring Retry-After, then succeeds", async () => {
    let n = 0;
    const { adapter, calls, sleeps } = adapterWith(async () => {
      n += 1;
      return n === 1
        ? errorResponse(429, '{"error":{"code":"rate_limit","message":"slow down"}}', "5")
        : completedResponse(successBody("{}"));
    });
    const result = await adapter.complete(prompt());
    expect(result.text).toBe("{}");
    expect(result.attempts).toBe(2);
    expect(calls).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(5000);
  });

  it("gives up after maxRetries on persistent 429s", async () => {
    const { adapter, calls, sleeps } = adapterWith(async () =>
      errorResponse(429, '{"error":{"code":"rate_limit","message":"slow"}}'),
    );
    const err = await adapter.complete(prompt()).catch((e: unknown) => e);
    expect(err as ModelError).toMatchObject({ category: "rate_limited", retryable: true });
    expect(calls).toHaveLength(3); // initial + 2 retries
    expect(sleeps).toHaveLength(2);
  });

  it("retries server errors and transport failures", async () => {
    let n = 0;
    const { adapter, calls } = adapterWith(async () => {
      n += 1;
      if (n === 1) {
        throw new TypeError("fetch failed");
      }
      if (n === 2) {
        return errorResponse(503, '{"error":{"code":"overloaded","message":"busy"}}');
      }
      return completedResponse(successBody("{}"));
    });
    const result = await adapter.complete(prompt());
    expect(result.text).toBe("{}");
    expect(calls).toHaveLength(3);
    expect(result.attempts).toBe(3);
  });

  it("maps aborts to retryable timeouts", async () => {
    const { adapter } = adapterWith(async () => {
      throw new DOMException("aborted", "AbortError");
    }, { maxRetries: 0 });
    const err = await adapter.complete(prompt()).catch((e: unknown) => e);
    expect(err as ModelError).toMatchObject({ category: "timeout", retryable: true });
  });

  it("rejects malformed JSON without retry", async () => {
    const { adapter, calls } = adapterWith(
      async () => new Response("not-json{", { status: 200 }),
    );
    const err = await adapter.complete(prompt()).catch((e: unknown) => e);
    expect(err as ModelError).toMatchObject({ category: "malformed_response" });
    expect(calls).toHaveLength(1);
  });

  it("rejects empty output_text", async () => {
    const { adapter } = adapterWith(async () =>
      completedResponse({ id: "r", status: "completed", output: [] }),
    );
    const err = await adapter.complete(prompt()).catch((e: unknown) => e);
    expect(err as ModelError).toMatchObject({ category: "empty_response" });
  });

  it("rejects refusals and incomplete responses", async () => {
    const { adapter: refusal } = adapterWith(async () =>
      completedResponse({
        id: "r",
        status: "completed",
        output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }],
      }),
    );
    await expect(refusal.complete(prompt())).rejects.toMatchObject({
      category: "refusal",
    });

    const { adapter: incomplete } = adapterWith(async () =>
      completedResponse({
        id: "r",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      }),
    );
    await expect(incomplete.complete(prompt())).rejects.toMatchObject({
      category: "incomplete",
    });
  });

  it("never exposes credentials in errors or logs", async () => {
    const { adapter, logs } = adapterWith(async () =>
      errorResponse(401, `{"error":{"code":"x","message":"key ${API_KEY} bad"}}`),
    );
    const err = (await adapter.complete(prompt()).catch((e: unknown) => e)) as ModelError;
    expect(err.message).not.toContain(API_KEY);
    expect(JSON.stringify(logs)).not.toContain(API_KEY);
    // Instructions / prompt text stay out of logs too.
    expect(JSON.stringify(logs)).not.toContain("test instructions");
  });

  it("ping resolves flagged-truncated when the provider cuts the reply off", async () => {
    const { adapter, calls } = adapterWith(async () =>
      completedResponse({
        id: "r",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      }),
    );
    const result = await adapter.ping();
    expect(result.truncated).toBe(true);
    expect(result.model).toBe(CONFIG.modelId);
    expect(calls).toHaveLength(1);
    expect(requestBody(calls).max_output_tokens).toBe(64);
  });

  it("ping still throws real connection failures", async () => {
    const { adapter } = adapterWith(async () =>
      errorResponse(401, `{"error":{"message":"bad key"}}`),
    );
    await expect(adapter.ping()).rejects.toMatchObject({ category: "auth" });
  });
});
