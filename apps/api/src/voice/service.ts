import type { Kysely } from "kysely";
import type { SafetyState, VoiceRole } from "@fieldfix/contracts";
import type {
  Database,
  DiagnosticSession,
  SpeechTranscription,
  VoiceInteraction,
} from "../db/database.js";
import { EventRepository } from "../db/repositories/events.js";
import { ModelRunRepository } from "../db/repositories/model-runs.js";
import { SafetyEventRepository } from "../db/repositories/safety.js";
import { SettingsRepository } from "../db/repositories/settings.js";
import {
  SpeechTranscriptionRepository,
  VoiceInteractionRepository,
  VoicePreferencesRepository,
} from "../db/repositories/voice.js";
import { ModelError, type TranscriptionMode } from "../models/types.js";
import type {
  SpeechSynthesisPolicy,
  TextToSpeechProvider,
  TranscriptionProvider,
  TranscriptResult,
} from "../models/types.js";
import { isLoopBlocked, type SafetyController } from "../safety/controller.js";
import { screenUserText } from "../safety/screen-user-text.js";
import type { SafetyScreeningService } from "../safety/screening.js";
import { ALLOWED_AUDIO_TYPES } from "../uploads/validate-file.js";

export type VoiceErrorCode = "voice_disabled" | "session_not_found";

export class VoiceError extends Error {
  readonly code: VoiceErrorCode;

  constructor(code: VoiceErrorCode, message: string) {
    super(message);
    this.name = "VoiceError";
    this.code = code;
  }
}

export interface VoiceServiceDeps {
  db: Kysely<Database>;
  stt: TranscriptionProvider;
  tts: TextToSpeechProvider;
  voiceModelId: string;
  maxAudioMb: number;
  maxAudioBytes: number;
  safety: SafetyController;
  screening?: SafetyScreeningService;
}

export interface TranscribeInput {
  session: DiagnosticSession;
  userId: string | null;
  audio: Buffer;
  mediaType: string;
  mode?: TranscriptionMode;
  languageBias?: string;
}

export interface TranscribeOutcome {
  result: TranscriptResult;
  transcription: SpeechTranscription;
  interaction: VoiceInteraction;
  modelRunId: string;
  safetyState: SafetyState;
  warnings: string[];
  blocked: boolean;
}

export interface LogInteractionOutcome {
  interaction: VoiceInteraction;
  safetyState: SafetyState;
  warnings: string[];
  blocked: boolean;
}

export interface SpeakOutcome {
  policy: SpeechSynthesisPolicy;
  substituted: boolean;
  safetyState: SafetyState | null;
  warnings: string[];
}

export interface CapabilitiesSnapshot {
  stt: {
    provider: string;
    modelId: string;
    configured: boolean;
    enabled: boolean;
    available: boolean;
    accepts: string[];
    maxAudioMb: number;
    maxAudioBytes: number;
  };
  tts: {
    provider: string;
    mode: "browser-speech-synthesis";
    serverAudio: false;
    configured: boolean;
  };
}

/**
 * Voice orchestration: transcribe -> persist -> safety-screen -> log.
 * Transcripts never advance the diagnostic loop directly; callers use
 * the existing analyze/test endpoints, which enforce isLoopBlocked.
 * Transcription stays OPEN during a safety stop (like evidence
 * upload): the transcript is returned with warnings, and loop
 * actions remain gated by the deterministic controller.
 */
export class VoiceService {
  private readonly runs: ModelRunRepository;
  private readonly transcriptions: SpeechTranscriptionRepository;
  private readonly interactions: VoiceInteractionRepository;
  private readonly preferences: VoicePreferencesRepository;
  private readonly events: EventRepository;
  private readonly safetyEvents: SafetyEventRepository;
  private readonly settings: SettingsRepository;

  constructor(private readonly deps: VoiceServiceDeps) {
    this.runs = new ModelRunRepository(deps.db);
    this.transcriptions = new SpeechTranscriptionRepository(deps.db);
    this.interactions = new VoiceInteractionRepository(deps.db);
    this.preferences = new VoicePreferencesRepository(deps.db);
    this.events = new EventRepository(deps.db);
    this.safetyEvents = new SafetyEventRepository(deps.db);
    this.settings = new SettingsRepository(deps.db);
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeOutcome> {
    const enabled = await this.voiceEnabled();
    if (!enabled) {
      throw new VoiceError(
        "voice_disabled",
        "Voice transcription is disabled by the administrator.",
      );
    }
    const run = await this.runs.create({
      session_id: input.session.id,
      provider: this.deps.stt.id,
      model_id: this.deps.voiceModelId,
      task_type: "transcription",
      origin: "live",
    });
    let result: TranscriptResult;
    try {
      result = await this.deps.stt.transcribeFile({
        audio: input.audio,
        mediaType: input.mediaType,
        mode: input.mode,
        languageBias: input.languageBias,
      });
    } catch (err) {
      const category = err instanceof ModelError ? err.category : "unknown";
      const message =
        err instanceof ModelError ? err.message : "Transcription failed.";
      await this.runs.update(run.id, {
        status: category === "timeout" ? "timeout" : "failed",
        error_category: category,
        error_message: message.slice(0, 4000),
      });
      throw err;
    }
    await this.runs.update(run.id, {
      status: "succeeded",
      latency_ms: result.latencyMs,
      provider_response_id: result.providerResponseId ?? null,
      diagnostic_stage: "voice_transcription",
    });

    const transcription = await this.transcriptions.create({
      session_id: input.session.id,
      provider: this.deps.stt.id,
      model_id: result.model,
      transcript: result.transcript,
      // Meta Voice Transcribe reports no confidence score.
      confidence: null,
      audio_duration_ms: result.audioDurationMs ?? null,
      model_run_id: run.id,
    });

    // Screen the transcript like any other user-supplied text, then
    // log it as the user's turn (truncated: the log caps at 8000 chars
    // while the full transcript above is unbounded).
    const screened = await screenUserText(
      this.deps.safety,
      this.deps.screening,
      input.session.id,
      result.transcript,
      { deviceType: input.session.device_type },
    );
    const interaction = await this.interactions.create({
      session_id: input.session.id,
      user_id: input.userId,
      role: "user",
      text: truncateForLog(result.transcript),
      // Phase 1 retains no audio bytes: memory -> provider -> discard.
      audio_storage_key: null,
    });
    const safety = await this.safetyView(screened.session);
    await this.events.append(input.session.id, {
      event_type: "voice_transcribed",
      payload: {
        transcription_id: transcription.id,
        interaction_id: interaction.id,
        model_run_id: run.id,
        provider: this.deps.stt.id,
        mode: input.mode ?? null,
        safety_state: safety.safetyState,
        blocked: safety.blocked,
      },
    });
    return {
      result,
      transcription,
      interaction,
      modelRunId: run.id,
      safetyState: safety.safetyState,
      warnings: safety.warnings,
      blocked: safety.blocked,
    };
  }

  async logInteraction(input: {
    session: DiagnosticSession;
    userId: string | null;
    role: VoiceRole;
    text: string;
  }): Promise<LogInteractionOutcome> {
    const screened = await screenUserText(
      this.deps.safety,
      this.deps.screening,
      input.session.id,
      input.text,
      { deviceType: input.session.device_type },
    );
    const interaction = await this.interactions.create({
      session_id: input.session.id,
      user_id: input.userId,
      role: input.role,
      text: input.text,
      audio_storage_key: null,
    });
    const safety = await this.safetyView(screened.session);
    await this.events.append(input.session.id, {
      event_type: "voice_interaction_logged",
      payload: {
        interaction_id: interaction.id,
        role: input.role,
        safety_state: safety.safetyState,
        blocked: safety.blocked,
      },
    });
    return {
      interaction,
      safetyState: safety.safetyState,
      warnings: safety.warnings,
      blocked: safety.blocked,
    };
  }

  /**
   * Speak policy for browser speechSynthesis. In a blocked session the
   * requested text is replaced by the safety guidance (warnings only).
   */
  async speak(input: {
    text: string;
    session?: DiagnosticSession;
    userId?: string | null;
    voiceId?: string;
    rate?: number;
    language?: string;
  }): Promise<SpeakOutcome> {
    let prefs: { voice_id: string | null; rate: number; language: string } | null =
      null;
    if (input.userId) {
      const row = await this.preferences.getByUserId(input.userId).catch(() => null);
      if (row) {
        prefs = { voice_id: row.voice_id, rate: row.rate, language: row.language };
      }
    }
    let text = input.text;
    let substituted = false;
    let warnings: string[] = [];
    const safetyState = input.session?.safety_state ?? null;
    if (input.session && isLoopBlocked(input.session.safety_state)) {
      const latest = await this.safetyEvents.getLatest(input.session.id);
      text =
        latest?.safe_next_steps ??
        `Session is ${input.session.safety_state}; diagnostic actions are blocked.`;
      substituted = true;
      warnings = [text];
    }
    const policy = await this.deps.tts.synthesizeSpeech({
      text,
      language: input.language ?? prefs?.language ?? "en",
      rate: input.rate ?? prefs?.rate ?? 1,
      voiceId: input.voiceId ?? prefs?.voice_id ?? null,
    });
    return { policy, substituted, safetyState, warnings };
  }

  async describeCapabilities(): Promise<CapabilitiesSnapshot> {
    const enabled = await this.voiceEnabled();
    const configured = this.deps.stt.configured;
    return {
      stt: {
        provider: this.deps.stt.id,
        modelId: this.deps.voiceModelId,
        configured,
        enabled,
        available: configured && enabled,
        accepts: [...ALLOWED_AUDIO_TYPES],
        maxAudioMb: this.deps.maxAudioMb,
        maxAudioBytes: this.deps.maxAudioBytes,
      },
      tts: {
        provider: this.deps.tts.id,
        mode: "browser-speech-synthesis",
        serverAudio: false,
        configured: true,
      },
    };
  }

  private async voiceEnabled(): Promise<boolean> {
    try {
      const value = await this.settings.get("ai.voice.enabled");
      return value === undefined ? true : value === true;
    } catch {
      return true;
    }
  }

  private async safetyView(session: DiagnosticSession): Promise<{
    safetyState: SafetyState;
    warnings: string[];
    blocked: boolean;
  }> {
    const blocked = isLoopBlocked(session.safety_state);
    if (!blocked) {
      return { safetyState: session.safety_state, warnings: [], blocked: false };
    }
    const latest = await this.safetyEvents.getLatest(session.id);
    const warnings = [
      latest?.safe_next_steps ??
        `Session is ${session.safety_state}; diagnostic actions are blocked.`,
    ];
    return { safetyState: session.safety_state, warnings, blocked: true };
  }
}

/** Bound interaction text to the 8000-char log CHECK with a marker. */
function truncateForLog(text: string): string {
  if (text.length <= 8000) {
    return text;
  }
  return `${text.slice(0, 7980)}…[truncated]`;
}
