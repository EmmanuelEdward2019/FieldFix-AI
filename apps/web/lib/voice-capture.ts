/**
 * Browser-native speech capture and playback for voice-guided
 * diagnostics. All recording happens in the browser (MediaRecorder /
 * Web Speech API); spoken instructions play through speechSynthesis.
 * Server transcription (/api/v1/voice/transcribe) is the fallback when
 * on-device recognition is unavailable — callers upload WAV only, since
 * the verified Meta file endpoint requires WAV mono 16-bit PCM.
 *
 * Every helper is safe to import in Node (SSR/tests): feature checks
 * return false and actions throw VoiceCaptureError with an explicit
 * code instead of touching missing globals.
 */

export type VoiceCaptureCode =
  | "speech_unsupported"
  | "synthesis_unsupported"
  | "recorder_unsupported"
  | "mic_denied"
  | "mic_unavailable"
  | "no_speech"
  | "recognition_failed"
  | "recording_failed"
  | "encode_failed"
  | "aborted";

export class VoiceCaptureError extends Error {
  readonly code: VoiceCaptureCode;

  constructor(code: VoiceCaptureCode, message: string) {
    super(message);
    this.name = "VoiceCaptureError";
    this.code = code;
  }
}

/** Human-readable message for each capture failure code. */
export function describeCaptureError(err: unknown): string {
  if (err instanceof VoiceCaptureError) {
    switch (err.code) {
      case "speech_unsupported":
        return "On-device speech recognition is not available in this browser.";
      case "synthesis_unsupported":
        return "Spoken responses are not available in this browser.";
      case "recorder_unsupported":
        return "Audio recording is not available in this browser.";
      case "mic_denied":
        return "Microphone access was denied. Allow the microphone or type your answer instead.";
      case "mic_unavailable":
        return "No microphone was found. Check your device or type your answer instead.";
      case "no_speech":
        return "No speech was detected. Try again or type your answer instead.";
      case "recognition_failed":
        return "Speech recognition failed. Try again or type your answer instead.";
      case "recording_failed":
        return "Recording failed. Try again or type your answer instead.";
      case "encode_failed":
        return "The recording could not be prepared for transcription. Try again or type your answer instead.";
      case "aborted":
        return "Voice input was cancelled.";
    }
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return "Voice input failed. Try again or type your answer instead.";
}

/** Browser speech confidence below this asks the user to repeat. */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

/** Default maximum for one voice clip (keeps uploads small). */
export const DEFAULT_MAX_CLIP_MS = 120_000;

/** Sample rate the server transcription path expects (WAV mono). */
export const TRANSCRIBE_SAMPLE_RATE = 16_000;

export interface VoiceSupport {
  speechRecognition: boolean;
  speechSynthesis: boolean;
  mediaRecorder: boolean;
  microphone: boolean;
}

type AnyRecord = Record<string, unknown>;

function getWindow(): (Window & AnyRecord) | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window as unknown as Window & AnyRecord;
}

function getNavigator(): (Navigator & AnyRecord) | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }
  return navigator as Navigator & AnyRecord;
}

/** Feature snapshot; all false outside a browser (SSR/Node). */
export function voiceSupport(): VoiceSupport {
  const win = getWindow();
  const nav = getNavigator();
  const mediaDevices = nav?.["mediaDevices"] as AnyRecord | undefined;
  return {
    speechRecognition:
      win != null &&
      (typeof win["SpeechRecognition"] === "function" ||
        typeof win["webkitSpeechRecognition"] === "function"),
    speechSynthesis:
      win != null &&
      typeof (win["speechSynthesis"] as unknown as AnyRecord | undefined)?.[
        "speak"
      ] === "function",
    mediaRecorder:
      win != null && typeof win["MediaRecorder"] === "function",
    microphone:
      typeof mediaDevices?.["getUserMedia"] === "function",
  };
}

export interface VoiceSynthesisVoice {
  voiceURI: string;
  name: string;
  lang: string;
}

function toVoiceShape(voice: unknown): VoiceSynthesisVoice | null {
  const record = voice as AnyRecord | null;
  if (
    record == null ||
    typeof record["voiceURI"] !== "string" ||
    typeof record["name"] !== "string" ||
    typeof record["lang"] !== "string"
  ) {
    return null;
  }
  return {
    voiceURI: record["voiceURI"],
    name: record["name"],
    lang: record["lang"],
  };
}

function getSynthesis(): AnyRecord | undefined {
  const win = getWindow();
  const synthesis = win?.["speechSynthesis"] as AnyRecord | undefined;
  return typeof synthesis?.["speak"] === "function" ? synthesis : undefined;
}

/** Voices currently known to speechSynthesis (empty when unsupported). */
export function listSpeechVoices(): VoiceSynthesisVoice[] {
  const synthesis = getSynthesis();
  const raw = synthesis?.["getVoices"];
  if (typeof raw !== "function") {
    return [];
  }
  const voices = (raw as () => unknown).call(synthesis);
  if (!Array.isArray(voices)) {
    return [];
  }
  const out: VoiceSynthesisVoice[] = [];
  for (const voice of voices) {
    const shaped = toVoiceShape(voice);
    if (shaped) {
      out.push(shaped);
    }
  }
  return out;
}

/**
 * Voices, waiting briefly for the async voiceschanged event when the
 * list starts empty (Chrome populates voices lazily).
 */
export function loadSpeechVoices(timeoutMs = 1500): Promise<VoiceSynthesisVoice[]> {
  const synthesis = getSynthesis();
  if (!synthesis) {
    return Promise.resolve([]);
  }
  const immediate = listSpeechVoices();
  if (immediate.length > 0) {
    return Promise.resolve(immediate);
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(listSpeechVoices());
    };
    const timer =
      typeof setTimeout === "function" ? setTimeout(done, timeoutMs) : undefined;
    const addListener = synthesis["addEventListener"];
    if (typeof addListener === "function") {
      (addListener as (type: string, listener: () => void, opts?: unknown) => void).call(
        synthesis,
        "voiceschanged",
        () => {
          if (timer !== undefined) {
            clearTimeout(timer);
          }
          done();
        },
        { once: true },
      );
    } else {
      done();
    }
  });
}

export interface SpeakOptions {
  voiceURI?: string | null;
  rate?: number;
  language?: string;
  onend?: () => void;
  onerror?: (message: string) => void;
}

function pickVoice(
  synthesis: AnyRecord,
  voiceURI: string | null | undefined,
): unknown {
  if (!voiceURI) {
    return undefined;
  }
  const raw = synthesis["getVoices"];
  if (typeof raw !== "function") {
    return undefined;
  }
  const voices = (raw as () => unknown).call(synthesis);
  if (!Array.isArray(voices)) {
    return undefined;
  }
  return voices.find(
    (voice) => (voice as AnyRecord)?.["voiceURI"] === voiceURI,
  );
}

/**
 * Speak text through speechSynthesis. Cancels any queued utterance
 * first so guidance never stacks. Returns a cancel function. Throws
 * VoiceCaptureError(synthesis_unsupported) outside a browser.
 */
export function speakText(text: string, opts: SpeakOptions = {}): () => void {
  const win = getWindow();
  const synthesis = getSynthesis();
  const Utterance = win?.["SpeechSynthesisUtterance"] as
    | (new (text: string) => AnyRecord)
    | undefined;
  if (!synthesis || typeof Utterance !== "function") {
    throw new VoiceCaptureError(
      "synthesis_unsupported",
      describeCaptureError(
        new VoiceCaptureError("synthesis_unsupported", ""),
      ),
    );
  }
  const cancel = synthesis["cancel"] as () => void;
  cancel.call(synthesis);
  const utterance = new Utterance(text);
  const rate = opts.rate ?? 1;
  if (Number.isFinite(rate)) {
    utterance["rate"] = Math.min(2, Math.max(0.5, rate));
  }
  if (opts.language) {
    utterance["lang"] = opts.language;
  }
  const voice = pickVoice(synthesis, opts.voiceURI ?? undefined);
  if (voice) {
    utterance["voice"] = voice;
  }
  utterance["onend"] = () => opts.onend?.();
  utterance["onerror"] = () => opts.onerror?.("Spoken playback failed.");
  (synthesis["speak"] as (utterance: unknown) => void).call(
    synthesis,
    utterance,
  );
  return () => cancelSpeech();
}

export function pauseSpeech(): boolean {
  const synthesis = getSynthesis();
  if (!synthesis || synthesis["speaking"] !== true) {
    return false;
  }
  (synthesis["pause"] as () => void).call(synthesis);
  return true;
}

export function resumeSpeech(): boolean {
  const synthesis = getSynthesis();
  if (!synthesis || synthesis["paused"] !== true) {
    return false;
  }
  (synthesis["resume"] as () => void).call(synthesis);
  return true;
}

export function cancelSpeech(): void {
  const synthesis = getSynthesis();
  const cancel = synthesis?.["cancel"];
  if (typeof cancel === "function") {
    cancel.call(synthesis);
  }
}

export type SpeechPlaybackState = "speaking" | "paused" | "idle";

export function speechPlaybackState(): SpeechPlaybackState {
  const synthesis = getSynthesis();
  if (!synthesis) {
    return "idle";
  }
  if (synthesis["paused"] === true) {
    return "paused";
  }
  return synthesis["speaking"] === true ? "speaking" : "idle";
}

export interface RecognitionResult {
  transcript: string;
  /**
   * Browser confidence 0..1. Browsers that report no confidence yield
   * 1 (not low) so guidance treats the transcript as acceptable.
   */
  confidence: number;
}

export interface RecognizeOptions {
  language?: string;
  /** Interim (non-final) transcript updates while speaking. */
  oninterim?: (text: string) => void;
  signal?: AbortSignal;
}

interface RecognitionInstance extends AnyRecord {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  abort: () => void;
}

/**
 * One-shot on-device speech recognition. Resolves with the final
 * transcript or rejects with a coded VoiceCaptureError.
 */
export function recognizeOnce(
  opts: RecognizeOptions = {},
): Promise<RecognitionResult> {
  const win = getWindow();
  const Ctor = (
    win != null
      ? (win["SpeechRecognition"] ?? win["webkitSpeechRecognition"])
      : undefined
  ) as (new () => RecognitionInstance) | undefined;
  if (!Ctor) {
    return Promise.reject(
      new VoiceCaptureError(
        "speech_unsupported",
        "On-device speech recognition is not available in this browser.",
      ),
    );
  }
  return new Promise<RecognitionResult>((resolve, reject) => {
    let settled = false;
    const done = (
      value:
        | { ok: true; result: RecognitionResult }
        | { ok: false; error: VoiceCaptureError },
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      opts.signal?.removeEventListener("abort", onAbort);
      if (value.ok) {
        resolve(value.result);
      } else {
        reject(value.error);
      }
    };
    let recognition: RecognitionInstance;
    try {
      recognition = new Ctor();
    } catch {
      done({
        ok: false,
        error: new VoiceCaptureError(
          "recognition_failed",
          "Speech recognition failed. Try again or type your answer instead.",
        ),
      });
      return;
    }
    const onAbort = () => {
      try {
        recognition.abort();
      } catch {
        // Ignore: abort is best-effort cleanup.
      }
      done({
        ok: false,
        error: new VoiceCaptureError("aborted", "Voice input was cancelled."),
      });
    };
    if (opts.signal?.aborted) {
      onAbort();
      return;
    }
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    recognition.lang = opts.language?.trim() || "en";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition["onresult"] = (event: unknown) => {
      const record = event as AnyRecord | null;
      const results = record?.["results"] as ArrayLike<unknown> | undefined;
      if (results == null || typeof results.length !== "number") {
        return;
      }
      let interim = "";
      for (let i = 0; i < results.length; i += 1) {
        const result = results[i] as AnyRecord | null;
        const alternative = result?.[0] as AnyRecord | null;
        const text =
          typeof alternative?.["transcript"] === "string"
            ? (alternative["transcript"] as string)
            : "";
        if (result?.["isFinal"] === true) {
          const rawConfidence = alternative?.["confidence"];
          const confidence =
            typeof rawConfidence === "number" && Number.isFinite(rawConfidence)
              ? rawConfidence
              : 1;
          try {
            recognition.abort();
          } catch {
            // Already ended; ignore.
          }
          done({ ok: true, result: { transcript: text, confidence } });
          return;
        }
        interim += text;
      }
      if (interim.trim()) {
        opts.oninterim?.(interim);
      }
    };
    recognition["onerror"] = (event: unknown) => {
      const code = (event as AnyRecord | null)?.["error"];
      if (code === "aborted") {
        done({
          ok: false,
          error: new VoiceCaptureError("aborted", "Voice input was cancelled."),
        });
        return;
      }
      if (code === "not-allowed" || code === "service-not-allowed") {
        done({
          ok: false,
          error: new VoiceCaptureError(
            "mic_denied",
            "Microphone access was denied. Allow the microphone or type your answer instead.",
          ),
        });
        return;
      }
      if (code === "no-speech") {
        done({
          ok: false,
          error: new VoiceCaptureError(
            "no_speech",
            "No speech was detected. Try again or type your answer instead.",
          ),
        });
        return;
      }
      done({
        ok: false,
        error: new VoiceCaptureError(
          "recognition_failed",
          "Speech recognition failed. Try again or type your answer instead.",
        ),
      });
    };
    recognition["onend"] = () => {
      done({
        ok: false,
        error: new VoiceCaptureError(
          "no_speech",
          "No speech was detected. Try again or type your answer instead.",
        ),
      });
    };
    try {
      recognition.start();
    } catch {
      done({
        ok: false,
        error: new VoiceCaptureError(
          "recognition_failed",
          "Speech recognition failed. Try again or type your answer instead.",
        ),
      });
    }
  });
}

export interface AudioRecorder {
  readonly mimeType: string;
  readonly state: "recording" | "stopped";
  stop: () => Promise<Blob>;
  cancel: () => void;
}

interface MediaRecorderInstance extends AnyRecord {
  readonly state: string;
  readonly mimeType: string;
  start: (timeslice?: number) => void;
  stop: () => void;
}

function mapGetUserMediaError(err: unknown): VoiceCaptureError {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new VoiceCaptureError(
      "mic_denied",
      "Microphone access was denied. Allow the microphone or type your answer instead.",
    );
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return new VoiceCaptureError(
      "mic_unavailable",
      "No microphone was found. Check your device or type your answer instead.",
    );
  }
  return new VoiceCaptureError(
    "mic_unavailable",
    "The microphone could not be opened. Check your device or type your answer instead.",
  );
}

/**
 * Record one audio clip with MediaRecorder. The clip stays in memory
 * and must be transcoded to WAV (transcodeToWavMono16k) before server
 * upload. Stopping releases the microphone tracks.
 */
export async function startRecording(
  opts: { maxDurationMs?: number } = {},
): Promise<AudioRecorder> {
  const win = getWindow();
  const nav = getNavigator();
  const mediaDevices = nav?.["mediaDevices"] as AnyRecord | undefined;
  const getUserMedia = mediaDevices?.["getUserMedia"] as
    | ((constraints: unknown) => Promise<unknown>)
    | undefined;
  const Recorder = win?.["MediaRecorder"] as
    | (new (stream: unknown, options?: unknown) => MediaRecorderInstance)
    | undefined;
  if (!Recorder || !getUserMedia) {
    throw new VoiceCaptureError(
      "recorder_unsupported",
      "Audio recording is not available in this browser.",
    );
  }
  let stream: AnyRecord;
  try {
    stream = (await (getUserMedia as (constraints: unknown) => Promise<unknown>).call(
      mediaDevices,
      { audio: true },
    )) as AnyRecord;
  } catch (err) {
    throw mapGetUserMediaError(err);
  }
  const stopTracks = () => {
    const tracks = stream["getTracks"];
    if (typeof tracks === "function") {
      for (const track of (tracks as () => unknown[]).call(stream)) {
        const stop = (track as AnyRecord)["stop"];
        if (typeof stop === "function") {
          stop.call(track);
        }
      }
    }
  };
  const isTypeSupported = (Recorder as unknown as AnyRecord)[
    "isTypeSupported"
  ];
  let mimeType = "";
  if (typeof isTypeSupported === "function") {
    const supported = (mime: string): boolean => {
      try {
        return (
          (isTypeSupported as (mime: string) => boolean).call(Recorder, mime) ===
          true
        );
      } catch {
        return false;
      }
    };
    mimeType = supported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : supported("audio/webm")
        ? "audio/webm"
        : supported("audio/mp4")
          ? "audio/mp4"
          : "";
  }
  let recorder: MediaRecorderInstance;
  try {
    recorder = mimeType
      ? new Recorder(stream, { mimeType })
      : new Recorder(stream);
  } catch {
    stopTracks();
    throw new VoiceCaptureError(
      "recording_failed",
      "Recording failed. Try again or type your answer instead.",
    );
  }
  const chunks: Blob[] = [];
  let finished: Promise<Blob> | null = null;
  let finishResolve: ((blob: Blob) => void) | null = null;
  let finishReject: ((err: VoiceCaptureError) => void) | null = null;
  let recorderState: "recording" | "stopped" = "recording";
  const finish = () => {
    if (finished) {
      return finished;
    }
    finished = new Promise<Blob>((resolve, reject) => {
      finishResolve = resolve;
      finishReject = reject;
    });
    return finished;
  };
  recorder["ondataavailable"] = (event: unknown) => {
    const data = (event as AnyRecord | null)?.["data"] as Blob | undefined;
    if (data && data.size > 0) {
      chunks.push(data);
    }
  };
  recorder["onerror"] = () => {
    finishReject?.(
      new VoiceCaptureError(
        "recording_failed",
        "Recording failed. Try again or type your answer instead.",
      ),
    );
  };
  recorder["onstop"] = () => {
    recorderState = "stopped";
    stopTracks();
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    try {
      finishResolve?.(new Blob(chunks, { type: recorder.mimeType || mimeType }));
    } catch {
      finishReject?.(
        new VoiceCaptureError(
          "recording_failed",
          "Recording failed. Try again or type your answer instead.",
        ),
      );
    }
  };
  const maxDurationMs = opts.maxDurationMs ?? DEFAULT_MAX_CLIP_MS;
  const timer =
    typeof setTimeout === "function"
      ? setTimeout(() => {
          if (recorder.state === "recording") {
            try {
              recorder.stop();
            } catch {
              // Ignore: onstop/onerror settles the promise.
            }
          }
        }, maxDurationMs)
      : undefined;
  try {
    recorder.start(250);
  } catch {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    stopTracks();
    throw new VoiceCaptureError(
      "recording_failed",
      "Recording failed. Try again or type your answer instead.",
    );
  }
  return {
    get mimeType() {
      return recorder.mimeType || mimeType;
    },
    get state() {
      return recorderState;
    },
    stop: () => {
      const pending = finish();
      if (recorder.state === "recording") {
        try {
          recorder.stop();
        } catch {
          // onstop/onerror settles the promise.
        }
      }
      return pending;
    },
    cancel: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      finishReject?.(
        new VoiceCaptureError("aborted", "Voice input was cancelled."),
      );
      try {
        if (recorder.state === "recording") {
          recorder.stop();
        }
      } catch {
        // Ignore: tracks are released below regardless.
      }
      stopTracks();
    },
  };
}

/**
 * Encode mono float samples as 16-bit PCM WAV. Pure function (no
 * browser globals) so the byte layout is unit-testable.
 */
export function encodeWavPcm16(
  samples: Float32Array,
  sampleRate: number,
): ArrayBuffer {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new VoiceCaptureError("encode_failed", "Invalid WAV sample rate.");
  }
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.min(1, Math.max(-1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return buffer;
}

/**
 * Transcode a recorded clip to WAV mono 16 kHz for server upload.
 * Requires Web Audio; rejects encode_failed on decode problems.
 */
export async function transcodeToWavMono16k(blob: Blob): Promise<Blob> {
  const win = getWindow();
  const AudioCtx = (
    win != null
      ? (win["AudioContext"] ?? win["webkitAudioContext"])
      : undefined
  ) as (new () => AnyRecord) | undefined;
  const OfflineCtx = win?.["OfflineAudioContext"] as
    | (new (
        channels: number,
        length: number,
        sampleRate: number,
      ) => AnyRecord)
    | undefined;
  if (!AudioCtx || !OfflineCtx) {
    throw new VoiceCaptureError(
      "recorder_unsupported",
      "Audio recording is not available in this browser.",
    );
  }
  let ctx: AnyRecord | null = null;
  try {
    const bytes = await blob.arrayBuffer();
    ctx = new AudioCtx() as AnyRecord;
    const decode = ctx["decodeAudioData"] as (
      data: ArrayBuffer,
    ) => Promise<AnyRecord>;
    // decodeAudioData detaches its input; decode a copy.
    const decoded = await decode.call(ctx, bytes.slice(0));
    const duration = decoded["duration"] as number;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("empty audio");
    }
    const length = Math.max(
      1,
      Math.ceil(duration * TRANSCRIBE_SAMPLE_RATE),
    );
    const offline = new OfflineCtx(1, length, TRANSCRIBE_SAMPLE_RATE);
    const source = (
      offline["createBufferSource"] as () => AnyRecord
    ).call(offline);
    source["buffer"] = decoded;
    (source["connect"] as (dest: unknown) => void).call(
      source,
      offline["destination"],
    );
    (source["start"] as () => void).call(source);
    const rendered = await (
      offline["startRendering"] as () => Promise<AnyRecord>
    ).call(offline);
    const channel = (
      rendered["getChannelData"] as (channel: number) => Float32Array
    ).call(rendered, 0);
    return new Blob([encodeWavPcm16(channel, TRANSCRIBE_SAMPLE_RATE)], {
      type: "audio/wav",
    });
  } catch (err) {
    if (err instanceof VoiceCaptureError) {
      throw err;
    }
    throw new VoiceCaptureError(
      "encode_failed",
      "The recording could not be prepared for transcription. Try again or type your answer instead.",
    );
  } finally {
    try {
      await (ctx?.["close"] as (() => Promise<void>) | undefined)?.call(ctx);
    } catch {
      // Cleanup only; ignore.
    }
  }
}
