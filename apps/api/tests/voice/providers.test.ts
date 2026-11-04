import { describe, expect, it } from "vitest";
import {
  BrowserSpeechSynthesisProvider,
  TranscriptionRegistry,
  UnconfiguredTranscriptionProvider,
} from "../../src/voice/providers.js";
import { MetaVoiceTranscribeAdapter } from "../../src/models/meta/voice.js";
import { ModelError } from "../../src/models/types.js";

describe("TranscriptionRegistry", () => {
  it("looks up by exact id and throws on unknown ids", () => {
    const registry = new TranscriptionRegistry();
    const stub = new UnconfiguredTranscriptionProvider();
    registry.register(stub, { isDefault: true });
    expect(registry.get("meta-voice")).toBe(stub);
    expect(registry.getDefault()).toBe(stub);
    expect(() => registry.get("other")).toThrow(/Unknown transcription provider/);
  });

  it("rejects duplicate registration", () => {
    const registry = new TranscriptionRegistry();
    registry.register(new UnconfiguredTranscriptionProvider());
    expect(() => registry.register(new UnconfiguredTranscriptionProvider())).toThrow(
      /already registered/,
    );
  });
});

describe("UnconfiguredTranscriptionProvider", () => {
  it("fails every call with a config error (route maps to 501)", async () => {
    const stub = new UnconfiguredTranscriptionProvider();
    expect(stub.configured).toBe(false);
    const err = await stub
      .transcribeFile({ audio: Buffer.alloc(8), mediaType: "audio/wav" })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(ModelError);
    expect((err as ModelError).category).toBe("config");
  });
});

describe("MetaVoiceTranscribeAdapter without a key", () => {
  it("reports unconfigured and throws config, never touching the network", async () => {
    let calls = 0;
    const adapter = new MetaVoiceTranscribeAdapter(
      {
        baseUrl: "https://api.meta.ai/v1",
        modelId: "muse-voice-transcribe-1.0",
        timeoutMs: 1000,
        maxRetries: 0,
      },
      {
        fetchFn: (async () => {
          calls += 1;
          throw new Error("must not be called");
        }) as typeof fetch,
      },
    );
    expect(adapter.configured).toBe(false);
    await expect(
      adapter.transcribeFile({ audio: Buffer.alloc(8), mediaType: "audio/wav" }),
    ).rejects.toMatchObject({ category: "config" });
    expect(calls).toBe(0);
  });
});

describe("BrowserSpeechSynthesisProvider", () => {
  const tts = new BrowserSpeechSynthesisProvider();

  it("returns text + SSML policy with no audio bytes", async () => {
    const policy = await tts.synthesizeSpeech({ text: "Check the cable." });
    expect(policy.mode).toBe("browser-speech-synthesis");
    expect(policy.audioBase64).toBeNull();
    expect(policy.text).toBe("Check the cable.");
    expect(policy.ssml).toContain("Check the cable.");
    expect(policy.language).toBe("en");
    expect(policy.rate).toBe(1);
    expect(policy.voiceId).toBeNull();
  });

  it("escapes SSML metacharacters and honors rate", async () => {
    const policy = await tts.synthesizeSpeech({
      text: 'Use < 5V & "care".',
      rate: 1.5,
      language: "es",
      voiceId: "voice-1",
    });
    expect(policy.ssml).toContain("Use &lt; 5V &amp; &quot;care&quot;.");
    expect(policy.ssml).toContain('rate="1.5"');
    expect(policy.language).toBe("es");
    expect(policy.voiceId).toBe("voice-1");
  });
});
