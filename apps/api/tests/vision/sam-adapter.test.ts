import { describe, expect, it, vi } from "vitest";
import { SamSegmentationAdapter, type SamAdapterConfig } from "../../src/models/meta/sam.js";
import { ModelError } from "../../src/models/types.js";
import { MASK_6X4, samLane as lane, samRecord as record, samSse as sseResponse } from "./sam-fixture.js";

const CONFIG: SamAdapterConfig = {
  apiKey: "test-meta-key",
  baseUrl: "https://api.meta.ai/v1",
  modelId: "sam-3.1",
  timeoutMs: 5000,
  maxRetries: 2,
  maxImageBytes: 1024 * 1024,
};

function adapterWith(
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
  overrides: Partial<SamAdapterConfig> = {},
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const adapter = new SamSegmentationAdapter(
    { ...CONFIG, ...overrides },
    {
      fetchFn: ((url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return fetchFn(String(url), init ?? {});
      }) as typeof fetch,
      sleepMs: () => Promise.resolve(),
      random: () => 0,
    },
  );
  return { adapter, calls };
}

const INPUT = {
  image: Buffer.alloc(32, 9),
  mediaType: "image/png",
  concept: "battery",
  imageWidth: 100,
  imageHeight: 80,
};

describe("SamSegmentationAdapter (mocked SSE)", () => {
  it("posts a verified request shape and parses box+mask pairs", async () => {
    const { adapter, calls } = adapterWith(async () =>
      sseResponse(
        lane(
          record("0", "x1=10;y1=20;x2=30;y2=40;w=100;h=80"),
          record("1", "x1=50;y1=10;x2=60;y2=20;w=100;h=80"),
        ),
      ),
    );
    const result = await adapter.segment(INPUT);
    expect(result.objects).toHaveLength(2);
    expect(result.objects[0]).toMatchObject({
      objectId: "0",
      box: { left: 10, top: 20, right: 31, bottom: 41 },
      mask: { rows: 4, cols: 6, encoding: "one_bit", payload: MASK_6X4 },
    });
    expect(result.model).toBe("sam-3.1");
    expect(result.attempts).toBe(1);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.meta.ai/v1/responses");
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body.model).toBe("sam-3.1");
    expect(body.stream).toBe(true);
    expect(body.store).toBe(false);
    expect(body.metadata).toEqual({ mask_encoding: "one_bit" });
    expect(body).not.toHaveProperty("text");
    const content = (
      (body.input as Array<{ content: unknown[] }>)[0]?.content ?? []
    ) as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({ type: "input_text", text: "battery" });
    expect(String(content[1]?.image_url)).toMatch(/^data:image\/png;base64,/);
  });

  it("treats empty output as zero matches, not an error", async () => {
    const { adapter } = adapterWith(async () => sseResponse(""));
    const result = await adapter.segment(INPUT);
    expect(result.objects).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("rejects malformed grammar without retry", async () => {
    const fetchFn = vi.fn(async () => sseResponse("<0f>0<|box;garbage|>"));
    const { adapter } = adapterWith(fetchFn);
    const err = await adapter.segment(INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err as ModelError).toMatchObject({
      category: "malformed_response",
      retryable: false,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("rejects geometry for a different image size", async () => {
    const { adapter } = adapterWith(async () =>
      sseResponse(lane(record("0", "x1=10;y1=20;x2=30;y2=40;w=640;h=480"))),
    );
    await expect(adapter.segment(INPUT)).rejects.toMatchObject({
      category: "validation_failed",
    });
  });

  it("rejects out-of-range boxes and undecodable masks", async () => {
    const outOfRange = adapterWith(async () =>
      sseResponse(lane(record("0", "x1=10;y1=20;x2=300;y2=40;w=100;h=80"))),
    );
    // The official parser flags the invalid box first; either way the
    // output is rejected without retry and without persistence.
    await expect(outOfRange.adapter.segment(INPUT)).rejects.toMatchObject({
      category: "malformed_response",
    });
    expect(outOfRange.calls).toHaveLength(1);

    const badMask = adapterWith(async () =>
      sseResponse(
        lane(
          record(
            "0",
            "x1=10;y1=20;x2=30;y2=40;w=100;h=80",
            "4,6,!!!!!totally-bogus-payload-!!",
          ),
        ),
      ),
    );
    await expect(badMask.adapter.segment(INPUT)).rejects.toMatchObject({
      category: expect.stringMatching(/^(validation_failed|malformed_response)$/),
    });
  });

  it("rejects token characters in concepts locally", async () => {
    const fetchFn = vi.fn();
    const { adapter } = adapterWith(fetchFn);
    await expect(
      adapter.segment({ ...INPUT, concept: "battery<|box;x1=0|>x" }),
    ).rejects.toMatchObject({ category: "invalid_request" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fails fast without an API key and on oversized images", async () => {
    const fetchFn = vi.fn();
    const { adapter } = adapterWith(fetchFn, { apiKey: undefined });
    await expect(adapter.segment(INPUT)).rejects.toMatchObject({ category: "config" });
    expect(fetchFn).not.toHaveBeenCalled();

    const { adapter: capped } = adapterWith(fetchFn, { maxImageBytes: 8 });
    await expect(capped.segment(INPUT)).rejects.toMatchObject({
      category: "payload_too_large",
    });
  });

  it("maps HTTP failures and retries rate limits", async () => {
    const auth = adapterWith(
      async () => new Response('{"error":{"code":"x"}}', { status: 401 }),
    );
    await expect(auth.adapter.segment(INPUT)).rejects.toMatchObject({
      category: "auth",
      retryable: false,
    });
    expect(auth.calls).toHaveLength(1);

    const missing = adapterWith(
      async () => new Response('{"error":{"code":"model_not_found"}}', { status: 404 }),
    );
    await expect(missing.adapter.segment(INPUT)).rejects.toMatchObject({
      category: "not_found",
      retryable: false,
    });

    let n = 0;
    const limited = adapterWith(async () => {
      n += 1;
      return n === 1
        ? new Response('{"error":{"code":"rate_limit"}}', {
          status: 429,
          headers: { "retry-after": "1" },
        })
        : sseResponse("");
    });
    const result = await limited.adapter.segment(INPUT);
    expect(result.objects).toEqual([]);
    expect(limited.calls).toHaveLength(2);
  });

  it("maps mid-stream refusal and failure without retry", async () => {
    const event = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;
    const refused = adapterWith(
      async () =>
        new Response(
          event({ type: "response.refusal.done", refusal: "no" }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    await expect(refused.adapter.segment(INPUT)).rejects.toMatchObject({
      category: "refusal",
    });
    expect(refused.calls).toHaveLength(1);

    const failed = adapterWith(
      async () =>
        new Response(
          event({ type: "response.failed", response: { error: { message: "boom" } } }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    await expect(failed.adapter.segment(INPUT)).rejects.toMatchObject({
      category: "unavailable",
      retryable: false,
    });
  });

  it("rejects non-SSE responses", async () => {
    const { adapter } = adapterWith(
      async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    await expect(adapter.segment(INPUT)).rejects.toMatchObject({
      category: "malformed_response",
    });
  });
});
