import { ModelError, type CompleteOptions } from "../models/types.js";
import type {
  SpeechSynthesisPolicy,
  SpeechSynthesisRequest,
  TextToSpeechProvider,
  TranscribeFileInput,
  TranscriptResult,
  TranscriptionProvider,
} from "../models/types.js";

/**
 * Exact-match transcription registry. Like ModelProviderRegistry,
 * unknown ids throw instead of silently substituting another model.
 */
export class TranscriptionRegistry {
  private readonly providers = new Map<string, TranscriptionProvider>();
  private defaultId: string | null = null;

  register(
    provider: TranscriptionProvider,
    options: { isDefault?: boolean } = {},
  ): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Transcription provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
    if (options.isDefault === true || this.defaultId === null) {
      this.defaultId = provider.id;
    }
  }

  get(id: string): TranscriptionProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      const known = [...this.providers.keys()].join(", ") || "(none)";
      throw new Error(`Unknown transcription provider: ${id}. Registered: ${known}.`);
    }
    return provider;
  }

  getDefault(): TranscriptionProvider {
    if (this.defaultId === null) {
      throw new Error("No transcription provider registered.");
    }
    return this.get(this.defaultId);
  }

  ids(): string[] {
    return [...this.providers.keys()];
  }
}

/**
 * Documented stub used when Meta voice credentials are absent. Every
 * call fails with a config error so routes can answer 501
 * "not configured" and point admins at META_API_KEY / the console.
 */
export class UnconfiguredTranscriptionProvider implements TranscriptionProvider {
  readonly id = "meta-voice";
  readonly configured = false;

  async transcribeFile(
    _input: TranscribeFileInput,
    _options?: CompleteOptions,
  ): Promise<TranscriptResult> {
    throw new ModelError(
      "config",
      "Voice transcription is not configured (META_API_KEY).",
    );
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Browser-first TTS relay. No verified Meta TTS API exists, so the
 * server returns a speak policy for window.speechSynthesis — text +
 * SSML, never audio bytes (audioBase64 is always null).
 */
export class BrowserSpeechSynthesisProvider implements TextToSpeechProvider {
  readonly id = "browser-speech-synthesis";

  async synthesizeSpeech(
    input: SpeechSynthesisRequest,
  ): Promise<SpeechSynthesisPolicy> {
    const language = input.language?.trim() || "en";
    const rate = input.rate ?? 1;
    const body = escapeXml(input.text);
    const ssml =
      rate === 1
        ? `<speak xml:lang="${escapeXml(language)}">${body}</speak>`
        : `<speak xml:lang="${escapeXml(language)}"><prosody rate="${rate}">${body}</prosody></speak>`;
    return {
      text: input.text,
      ssml,
      language,
      rate,
      voiceId: input.voiceId ?? null,
      mode: "browser-speech-synthesis",
      audioBase64: null,
    };
  }
}
