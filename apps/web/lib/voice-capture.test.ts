import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelSpeech,
  describeCaptureError,
  encodeWavPcm16,
  listSpeechVoices,
  loadSpeechVoices,
  pauseSpeech,
  recognizeOnce,
  resumeSpeech,
  speechPlaybackState,
  speakText,
  startRecording,
  transcodeToWavMono16k,
  voiceSupport,
  VoiceCaptureError,
  type VoiceCaptureCode,
} from "./voice-capture";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("voiceSupport", () => {
  it("reports no capabilities outside a browser", () => {
    expect(voiceSupport()).toEqual({
      speechRecognition: false,
      speechSynthesis: false,
      mediaRecorder: false,
      microphone: false,
    });
  });

  it("detects stubbed browser speech globals", () => {
    vi.stubGlobal("window", {
      SpeechRecognition: class {},
      speechSynthesis: { speak: () => undefined },
      MediaRecorder: class {},
    });
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: () => Promise.resolve({}) },
    });
    expect(voiceSupport()).toEqual({
      speechRecognition: true,
      speechSynthesis: true,
      mediaRecorder: true,
      microphone: true,
    });
  });
});

describe("node fallbacks", () => {
  it("lists no voices and resolves empty voice loads", async () => {
    expect(listSpeechVoices()).toEqual([]);
    await expect(loadSpeechVoices(5)).resolves.toEqual([]);
  });

  it("throws synthesis_unsupported when speaking", () => {
    expect(() => speakText("hello")).toThrowError(VoiceCaptureError);
    try {
      speakText("hello");
    } catch (err) {
      expect((err as VoiceCaptureError).code).toBe("synthesis_unsupported");
    }
  });

  it("parks playback controls when unsupported", () => {
    expect(pauseSpeech()).toBe(false);
    expect(resumeSpeech()).toBe(false);
    expect(speechPlaybackState()).toBe("idle");
    expect(() => cancelSpeech()).not.toThrow();
  });

  it("rejects recognition and recording with coded errors", async () => {
    await expect(recognizeOnce()).rejects.toMatchObject({
      code: "speech_unsupported",
    });
    await expect(startRecording()).rejects.toMatchObject({
      code: "recorder_unsupported",
    });
    await expect(transcodeToWavMono16k(new Blob(["x"]))).rejects.toMatchObject(
      { code: "recorder_unsupported" },
    );
  });
});

describe("describeCaptureError", () => {
  it("explains every code without leaking internals", () => {
    const codes: VoiceCaptureCode[] = [
      "speech_unsupported",
      "synthesis_unsupported",
      "recorder_unsupported",
      "mic_denied",
      "mic_unavailable",
      "no_speech",
      "recognition_failed",
      "recording_failed",
      "encode_failed",
      "aborted",
    ];
    for (const code of codes) {
      const message = describeCaptureError(new VoiceCaptureError(code, code));
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toContain(code);
    }
    expect(describeCaptureError(new Error("boom"))).toBe("boom");
    expect(describeCaptureError(null).length).toBeGreaterThan(0);
  });
});

describe("encodeWavPcm16", () => {
  function ascii(view: DataView, offset: number, length: number): string {
    let out = "";
    for (let i = 0; i < length; i += 1) {
      out += String.fromCharCode(view.getUint8(offset + i));
    }
    return out;
  }

  it("writes a mono 16-bit PCM RIFF header", () => {
    const buffer = encodeWavPcm16(new Float32Array([0, 0.5, -0.5]), 16000);
    expect(buffer.byteLength).toBe(44 + 3 * 2);
    const view = new DataView(buffer);
    expect(ascii(view, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + 3 * 2);
    expect(ascii(view, 8, 4)).toBe("WAVE");
    expect(ascii(view, 12, 4)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(ascii(view, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(3 * 2);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(Math.round(0.5 * 32767));
    expect(view.getInt16(48, true)).toBe(Math.round(-0.5 * 32767));
  });

  it("clamps out-of-range samples", () => {
    const buffer = encodeWavPcm16(new Float32Array([1.5, -1.5]), 16000);
    const view = new DataView(buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32767);
  });

  it("rejects invalid sample rates", () => {
    expect(() => encodeWavPcm16(new Float32Array([0]), 0)).toThrowError(
      VoiceCaptureError,
    );
  });
});

describe("mocked speechSynthesis", () => {
  interface FakeVoice {
    voiceURI: string;
    name: string;
    lang: string;
  }

  function stubSynthesis(voices: FakeVoice[] = []) {
    const spoken: Array<Record<string, unknown>> = [];
    const synthesis = {
      speaking: false,
      paused: false,
      cancelCount: 0,
      getVoices: () => [...voices, { malformed: true }],
      cancel() {
        this.cancelCount += 1;
        this.speaking = false;
        this.paused = false;
      },
      speak(utterance: Record<string, unknown>) {
        spoken.push(utterance);
        this.speaking = true;
      },
      pause() {
        this.paused = true;
      },
      resume() {
        this.paused = false;
      },
    };
    class FakeUtterance {
      rate = 1;
      lang = "";
      voice: unknown = undefined;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    vi.stubGlobal("window", {
      speechSynthesis: synthesis,
      SpeechSynthesisUtterance: FakeUtterance,
    });
    return { synthesis, spoken };
  }

  it("speaks with the requested voice, rate, and language", () => {
    const { synthesis, spoken } = stubSynthesis([
      { voiceURI: "v1", name: "Voice One", lang: "en-US" },
    ]);
    const onend = vi.fn();
    const cancel = speakText("hello there", {
      voiceURI: "v1",
      rate: 1.5,
      language: "en",
      onend,
    });
    expect(synthesis.cancelCount).toBe(1);
    expect(spoken).toHaveLength(1);
    const utterance = spoken[0];
    expect(utterance?.["text"]).toBe("hello there");
    expect(utterance?.["rate"]).toBe(1.5);
    expect(utterance?.["lang"]).toBe("en");
    expect(
      (utterance?.["voice"] as FakeVoice | undefined)?.voiceURI,
    ).toBe("v1");
    expect(typeof cancel).toBe("function");
    (utterance?.["onend"] as (() => void) | null)?.();
    expect(onend).toHaveBeenCalledTimes(1);
  });

  it("clamps the rate and skips unknown voices", () => {
    const { spoken } = stubSynthesis([]);
    speakText("hi", { rate: 9 });
    expect(spoken[0]?.["rate"]).toBe(2);
    expect(spoken[0]?.["voice"]).toBeUndefined();
  });

  it("lists well-formed voices only and drives pause/resume", () => {
    stubSynthesis([{ voiceURI: "v1", name: "Voice One", lang: "en" }]);
    expect(listSpeechVoices()).toEqual([
      { voiceURI: "v1", name: "Voice One", lang: "en" },
    ]);
    speakText("hi");
    expect(speechPlaybackState()).toBe("speaking");
    expect(pauseSpeech()).toBe(true);
    expect(speechPlaybackState()).toBe("paused");
    expect(resumeSpeech()).toBe(true);
    cancelSpeech();
    expect(speechPlaybackState()).toBe("idle");
  });
});

describe("mocked speech recognition", () => {
  class FakeRecognition {
    static last: FakeRecognition | null = null;
    lang = "";
    interimResults = false;
    maxAlternatives = 1;
    started = false;
    aborted = false;
    onresult: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onend: (() => void) | null = null;

    start() {
      this.started = true;
      FakeRecognition.last = this;
    }

    abort() {
      this.aborted = true;
    }
  }

  function stubRecognition() {
    FakeRecognition.last = null;
    vi.stubGlobal("window", { SpeechRecognition: FakeRecognition });
  }

  function finalResult(transcript: string, confidence: number | undefined) {
    return {
      results: [
        {
          isFinal: true,
          length: 1,
          0: { transcript, confidence },
        },
      ],
    };
  }

  it("resolves the final transcript with confidence", async () => {
    stubRecognition();
    const interim = vi.fn();
    const pending = recognizeOnce({ language: "en", oninterim: interim });
    const rec = FakeRecognition.last;
    expect(rec?.started).toBe(true);
    expect(rec?.lang).toBe("en");
    rec?.onresult?.({
      results: [
        { isFinal: false, length: 1, 0: { transcript: "hel", confidence: 0.2 } },
      ],
    });
    expect(interim).toHaveBeenCalledWith("hel");
    rec?.onresult?.(finalResult("hello world", 0.82));
    await expect(pending).resolves.toEqual({
      transcript: "hello world",
      confidence: 0.82,
    });
  });

  it("treats missing confidence as acceptable, not low", async () => {
    stubRecognition();
    const pending = recognizeOnce();
    FakeRecognition.last?.onresult?.(finalResult("hi", undefined));
    await expect(pending).resolves.toEqual({ transcript: "hi", confidence: 1 });
  });

  it("maps denial, silence, and abort to codes", async () => {
    stubRecognition();
    const denied = recognizeOnce();
    FakeRecognition.last?.onerror?.({ error: "not-allowed" });
    await expect(denied).rejects.toMatchObject({ code: "mic_denied" });

    const silent = recognizeOnce();
    FakeRecognition.last?.onerror?.({ error: "no-speech" });
    await expect(silent).rejects.toMatchObject({ code: "no_speech" });

    const controller = new AbortController();
    const cancelled = recognizeOnce({ signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: "aborted" });
  });
});

describe("mocked media recording", () => {
  class FakeMediaRecorder {
    static last: FakeMediaRecorder | null = null;
    static supported = new Set(["audio/webm;codecs=opus"]);
    static isTypeSupported(mime: string): boolean {
      return FakeMediaRecorder.supported.has(mime);
    }

    state = "inactive";
    mimeType = "audio/webm;codecs=opus";
    ondataavailable: ((event: unknown) => void) | null = null;
    onerror: (() => void) | null = null;
    onstop: (() => void) | null = null;

    constructor(
      public stream: unknown,
      public options: unknown,
    ) {
      FakeMediaRecorder.last = this;
    }

    start() {
      this.state = "recording";
    }

    stop() {
      this.state = "inactive";
      this.onstop?.();
    }
  }

  function stubRecorder(getUserMediaImpl?: () => Promise<unknown>) {
    FakeMediaRecorder.last = null;
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] };
    vi.stubGlobal("window", { MediaRecorder: FakeMediaRecorder });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: getUserMediaImpl ?? (() => Promise.resolve(stream)),
      },
    });
    return { stopTrack };
  }

  it("records chunks and releases the microphone on stop", async () => {
    const { stopTrack } = stubRecorder();
    const handle = await startRecording({ maxDurationMs: 60_000 });
    expect(handle.state).toBe("recording");
    expect(handle.mimeType).toBe("audio/webm;codecs=opus");
    FakeMediaRecorder.last?.ondataavailable?.({ data: new Blob(["ab"]) });
    FakeMediaRecorder.last?.ondataavailable?.({ data: new Blob(["c"]) });
    const blob = await handle.stop();
    expect(blob.size).toBe(3);
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(handle.state).toBe("stopped");
  });

  it("maps denied and missing microphones to codes", async () => {
    const denied = new Error("denied");
    denied.name = "NotAllowedError";
    stubRecorder(() => Promise.reject(denied));
    await expect(startRecording()).rejects.toMatchObject({
      code: "mic_denied",
    });

    const missing = new Error("missing");
    missing.name = "NotFoundError";
    stubRecorder(() => Promise.reject(missing));
    await expect(startRecording()).rejects.toMatchObject({
      code: "mic_unavailable",
    });
  });

  it("transcodes decoded audio to WAV mono 16k", async () => {
    class FakeAudioContext {
      async decodeAudioData(_data: ArrayBuffer): Promise<{ duration: number }> {
        return { duration: 0.5 };
      }

      async close(): Promise<void> {}
    }
    class FakeOfflineContext {
      destination = {};
      constructor(
        public channels: number,
        public length: number,
        public rate: number,
      ) {}

      createBufferSource() {
        return {
          buffer: null as unknown,
          connect() {},
          start() {},
        };
      }

      async startRendering(): Promise<{
        getChannelData: (channel: number) => Float32Array;
      }> {
        return {
          getChannelData: () => new Float32Array(8000).fill(0.5),
        };
      }
    }
    vi.stubGlobal("window", {
      AudioContext: FakeAudioContext,
      OfflineAudioContext: FakeOfflineContext,
    });
    const wav = await transcodeToWavMono16k(new Blob(["fake-audio"]));
    expect(wav.type).toBe("audio/wav");
    const bytes = new Uint8Array(await wav.arrayBuffer());
    expect(bytes.length).toBe(44 + 8000 * 2);
    const ascii = (offset: number, length: number): string =>
      Array.from(bytes.slice(offset, offset + length))
        .map((b) => String.fromCharCode(b))
        .join("");
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
  });
});
