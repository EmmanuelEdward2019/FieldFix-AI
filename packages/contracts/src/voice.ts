import { z } from "zod";
import { safetyStateSchema } from "./diagnostics.js";

/**
 * Voice-guidance contracts (Phase 1, backend).
 *
 * STT accepts WAV only (the verified Meta file endpoint requires WAV
 * mono 16-bit PCM); TTS is browser-first — the server returns a speak
 * policy (text + SSML), never audio bytes, because no Meta TTS API
 * exists in the verified official docs.
 */

export const voiceRoleSchema = z.enum(["user", "assistant"]);
export type VoiceRole = z.infer<typeof voiceRoleSchema>;

/** Verified Meta ASR file modes (official speech-to-text docs). */
export const transcribeModeSchema = z.enum([
  "PUSH_TO_TALK",
  "ENDPOINTING",
  "DIARIZATION",
]);
export type TranscribeMode = z.infer<typeof transcribeModeSchema>;

const languageTagSchema = z.string().trim().min(2).max(20);

/* Per-user spoken-response preferences. */

export const voicePreferencesSchema = z.object({
  user_id: z.string().uuid(),
  spoken_responses: z.boolean(),
  voice_id: z.string().max(200).nullable(),
  rate: z.number().min(0.5).max(2),
  language: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type VoicePreferences = z.infer<typeof voicePreferencesSchema>;

export const voicePreferencesResponseSchema = z.object({
  preferences: voicePreferencesSchema,
});
export type VoicePreferencesResponse = z.infer<
  typeof voicePreferencesResponseSchema
>;

export const updateVoicePreferencesSchema = z.object({
  spoken_responses: z.boolean().optional(),
  voice_id: z.string().trim().min(1).max(200).nullable().optional(),
  rate: z.number().min(0.5).max(2).optional(),
  language: languageTagSchema.optional(),
});
export type UpdateVoicePreferences = z.infer<
  typeof updateVoicePreferencesSchema
>;

/* Session-linked conversation log. */

export const logVoiceInteractionSchema = z.object({
  session_id: z.string().uuid(),
  role: voiceRoleSchema,
  text: z.string().trim().min(1).max(8000),
});
export type LogVoiceInteraction = z.infer<typeof logVoiceInteractionSchema>;

export const voiceInteractionSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  role: voiceRoleSchema,
  text: z.string(),
  audio_storage_key: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type VoiceInteraction = z.infer<typeof voiceInteractionSchema>;

export const logVoiceInteractionResponseSchema = z.object({
  interaction: voiceInteractionSchema,
  safety_state: safetyStateSchema,
  warnings: z.array(z.string()),
  blocked: z.boolean(),
});
export type LogVoiceInteractionResponse = z.infer<
  typeof logVoiceInteractionResponseSchema
>;

/* Transcription (multipart audio -> transcript). */

export const transcriptTurnSchema = z.object({
  turn_id: z.string(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  transcript: z.string(),
  speaker: z.string().max(120).nullable(),
});
export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;

export const transcribeResponseSchema = z.object({
  transcript: z.string(),
  audio_duration_ms: z.number().int().nonnegative().nullable(),
  turns: z.array(transcriptTurnSchema),
  provider: z.string(),
  model_id: z.string(),
  transcription_id: z.string().uuid(),
  interaction_id: z.string().uuid(),
  model_run_id: z.string().uuid(),
  safety_state: safetyStateSchema,
  warnings: z.array(z.string()),
  blocked: z.boolean(),
});
export type TranscribeResponse = z.infer<typeof transcribeResponseSchema>;

/* Capability discovery (booleans only — never secrets). */

export const voiceCapabilitiesSchema = z.object({
  stt: z.object({
    provider: z.string(),
    model_id: z.string(),
    configured: z.boolean(),
    enabled: z.boolean(),
    available: z.boolean(),
    accepts: z.array(z.string()),
    max_audio_mb: z.number().int().positive(),
    max_audio_bytes: z.number().int().positive(),
  }),
  tts: z.object({
    provider: z.string(),
    mode: z.literal("browser-speech-synthesis"),
    server_audio: z.literal(false),
    configured: z.boolean(),
  }),
});
export type VoiceCapabilities = z.infer<typeof voiceCapabilitiesSchema>;

/* Speak policy (browser speechSynthesis input — no audio bytes). */

export const speakRequestSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  session_id: z.string().uuid().optional(),
  voice_id: z.string().trim().min(1).max(200).optional(),
  rate: z.number().min(0.5).max(2).optional(),
  language: languageTagSchema.optional(),
});
export type SpeakRequest = z.infer<typeof speakRequestSchema>;

export const speakPolicyResponseSchema = z.object({
  text: z.string(),
  ssml: z.string(),
  language: z.string(),
  rate: z.number(),
  voice_id: z.string().nullable(),
  mode: z.literal("browser-speech-synthesis"),
  audio_base64: z.null(),
  substituted: z.boolean(),
  safety_state: safetyStateSchema.nullable(),
  warnings: z.array(z.string()),
});
export type SpeakPolicyResponse = z.infer<typeof speakPolicyResponseSchema>;
