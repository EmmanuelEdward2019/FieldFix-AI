import { describe, expect, it } from "vitest";
import { MetaVoiceTranscribeAdapter } from "../../src/models/meta/voice.js";
import { ModelError } from "../../src/models/types.js";

const CONFIG = {
  apiKey: "test-key",
  baseUrl: "https://api.meta.ai/v1",
  modelId: "muse-voice-transcribe-1.0",
  timeoutMs: 5000,
  maxRetries: 2,
};

const AUDIO = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.alloc(4, 0),
  Buffer.from("WAVE", "ascii"),
  Buffer.alloc(64, 1),
]);

interface ScriptedReply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

function scriptFetch(replies: ScriptedReply[]) {
  const seen: Array<{ url: string; init: Record<string, unknown> }> = [];
  let calls = 0;
  const fetchFn = (async (url: unknown, init: unknown) => {
    seen.push({ url: String(url), init: (init ?? {}) as Record<string, unknown> });
    const reply = replies[Math.min(calls, replies.length - 1)] as ScriptedReply;
    calls += 1;
    const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: {
        get: (name: string) => reply.headers?.[name.toLowerCase()] ?? null,
      },
      text: async () => text,
    };
  }) as unknown as typeof fetch;
  return { fetchFn, seen, calls: () => calls };
}

function adapterFor(
  replies: ScriptedReply[],
  overrides: Partial<typeof CONFIG> = {},
) {
  const script = scriptFetch(replies);
  const adapter = new MetaVoiceTranscribeAdapter(
    { ...CONFIG, ...overrides },
    {
      fetchFn: script.fetchFn,
      sleepMs: async () => undefined,
      random: () => 0,
      now: () => 1000,
    },
  );
  return { adapter, script };
}

describe("MetaVoiceTranscribeAdapter", () => {
  it("POSTs multipart request+audio to the verified file endpoint", async () => {
    const { adapter, script } = adapterFor([
      {
        status: 200,
        body: {
          sessionId: "s-1",
          transcript: "the screen flickers",
          audioDurationMs: 1500,
          turns: [
            { turnId: "t1", startMs: 0, endMs: 1500, transcript: "the screen flickers" },
          ],
        },
      },
    ]);
    const result = await adapter.transcribeFile({ audio: AUDIO, mediaType: "audio/wav" });
    expect(result.transcript).toBe("the screen flickers");
    expect(result.audioDurationMs).toBe(1500);
    expect(result.turns).toHaveLength(1);
    expect(result.providerResponseId).toBe("s-1");
    expect(result.attempts).toBe(1);

    expect(script.seen).toHaveLength(1);
    expect(script.seen[0]?.url).toBe("https://api.meta.ai/v1/asr/transcribe");
    const headers = script.seen[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    const body = script.seen[0]?.init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.has("request")).toBe(true);
    expect(body.has("audio")).toBe(true);
  });

  it("rejects non-WAV input without calling the provider", async () => {
    const { adapter, script } = adapterFor([{ status: 200, body: {} }]);
    await expect(
      adapter.transcribeFile({ audio: AUDIO, mediaType: "audio/webm" }),
    ).rejects.toMatchObject({ category: "invalid_request" });
    expect(script.calls()).toBe(0);
  });

  it("maps 406 to invalid_request (adapter-level, no unknown leak)", async () => {
    const { adapter } = adapterFor([
      { status: 406, body: { error: { message: "unsupported sample rate" } } },
    ]);
    const err = await adapter
      .transcribeFile({ audio: AUDIO, mediaType: "audio/wav" })
      .then(
        () => null,
        (e: unknown) => e as ModelError,
      );
    expect(err?.category).toBe("invalid_request");
    expect(err?.retryable).toBe(false);
  });

  it("maps 413 to payload_too_large", async () => {
    const { adapter } = adapterFor([
      { status: 413, body: { error: { message: "too large" } } },
    ]);
    await expect(
      adapter.transcribeFile({ audio: AUDIO, mediaType: "audio/wav" }),
    ).rejects.toMatchObject({ category: "payload_too_large" });
  });

  it("retries 429s honoring Retry-After, then succeeds", async () => {
    const delays: number[] = [];
    const script = scriptFetch([
      { status: 429, body: { error: { message: "slow down" } }, headers: { "retry-after": "2" } },
      { status: 200, body: { sessionId: "s-2", transcript: "ok", audioDurationMs: 500 } },
    ]);
    const adapter = new MetaVoiceTranscribeAdapter(CONFIG, {
      fetchFn: script.fetchFn,
      sleepMs: async (ms) => {
        delays.push(ms);
      },
      random: () => 0,
      now: () => 1000,
    });
    const result = await adapter.transcribeFile({ audio: AUDIO, mediaType: "audio/wav" });
    expect(result.transcript).toBe("ok");
    expect(result.attempts).toBe(2);
    expect(delays).toEqual([2000]);
  });

  it("accepts empty transcripts (silence) but rejects missing ones", async () => {
    const silent = adapterFor([
      { status: 200, body: { sessionId: "s-3", transcript: "", audioDurationMs: 900 } },
    ]);
    const result = await silent.adapter.transcribeFile({
      audio: AUDIO,
      mediaType: "audio/wav",
    });
    expect(result.transcript).toBe("");

    const broken = adapterFor([{ status: 200, body: { sessionId: "s-4" } }]);
    await expect(
      broken.adapter.transcribeFile({ audio: AUDIO, mediaType: "audio/wav" }),
    ).rejects.toMatchObject({ category: "malformed_response" });
  });

  it("drops malformed turns instead of failing the transcript", async () => {
    const { adapter } = adapterFor([
      {
        status: 200,
        body: {
          sessionId: "s-5",
          transcript: "full text",
          turns: [
            { turnId: "t1", startMs: 0, endMs: 400, transcript: "full" },
            { turnId: "bad", startMs: "now" },
            "nope",
          ],
        },
      },
    ]);
    const result = await adapter.transcribeFile({ audio: AUDIO, mediaType: "audio/wav" });
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]?.turnId).toBe("t1");
  });

  it("maps transport failures to retryable unavailable", async () => {
    const adapter = new MetaVoiceTranscribeAdapter(
      { ...CONFIG, maxRetries: 0 },
      {
        fetchFn: (async () => {
          throw new Error("boom");
        }) as unknown as typeof fetch,
        sleepMs: async () => undefined,
        random: () => 0,
        now: () => 1000,
      },
    );
    const err = await adapter
      .transcribeFile({ audio: AUDIO, mediaType: "audio/wav" })
      .then(
        () => null,
        (e: unknown) => e as ModelError,
      );
    expect(err?.category).toBe("unavailable");
    expect(err?.retryable).toBe(true);
  });
});
