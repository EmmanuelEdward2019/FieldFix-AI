import { describe, expect, it } from "vitest";
import {
  logVoiceInteractionSchema,
  speakPolicyResponseSchema,
  speakRequestSchema,
  transcribeModeSchema,
  transcribeResponseSchema,
  updateVoicePreferencesSchema,
  voiceCapabilitiesSchema,
  voicePreferencesSchema,
  voiceRoleSchema,
} from "../src/index.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

describe("voiceRoleSchema", () => {
  it("accepts user and assistant turns", () => {
    expect(voiceRoleSchema.safeParse("user").success).toBe(true);
    expect(voiceRoleSchema.safeParse("assistant").success).toBe(true);
  });

  it("rejects unknown roles", () => {
    expect(voiceRoleSchema.safeParse("system").success).toBe(false);
  });
});

describe("transcribeModeSchema", () => {
  it("accepts the verified Meta ASR modes", () => {
    for (const mode of ["PUSH_TO_TALK", "ENDPOINTING", "DIARIZATION"]) {
      expect(transcribeModeSchema.safeParse(mode).success).toBe(true);
    }
  });

  it("rejects unknown modes", () => {
    expect(transcribeModeSchema.safeParse("STREAMING").success).toBe(false);
  });
});

describe("updateVoicePreferencesSchema", () => {
  it("accepts a partial update", () => {
    const parsed = updateVoicePreferencesSchema.safeParse({
      spoken_responses: false,
      language: "en",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects out-of-range rates and blank languages", () => {
    expect(updateVoicePreferencesSchema.safeParse({ rate: 99 }).success).toBe(
      false,
    );
    expect(updateVoicePreferencesSchema.safeParse({ rate: 0.1 }).success).toBe(
      false,
    );
    expect(updateVoicePreferencesSchema.safeParse({ language: "x" }).success).toBe(
      false,
    );
  });
});

describe("voicePreferencesSchema", () => {
  it("accepts a full preference row", () => {
    const parsed = voicePreferencesSchema.safeParse({
      user_id: USER_ID,
      spoken_responses: true,
      voice_id: null,
      rate: 1,
      language: "en",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
  });
});

describe("logVoiceInteractionSchema", () => {
  it("accepts a session-linked turn", () => {
    const parsed = logVoiceInteractionSchema.safeParse({
      session_id: SESSION_ID,
      role: "user",
      text: "The laptop clicks when I press power.",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects blank text, oversized text, and bad ids", () => {
    expect(
      logVoiceInteractionSchema.safeParse({
        session_id: SESSION_ID,
        role: "user",
        text: "  ",
      }).success,
    ).toBe(false);
    expect(
      logVoiceInteractionSchema.safeParse({
        session_id: SESSION_ID,
        role: "user",
        text: "x".repeat(8001),
      }).success,
    ).toBe(false);
    expect(
      logVoiceInteractionSchema.safeParse({
        session_id: "not-a-uuid",
        role: "user",
        text: "hello",
      }).success,
    ).toBe(false);
  });
});

describe("transcribeResponseSchema", () => {
  it("accepts a full transcription result", () => {
    const parsed = transcribeResponseSchema.safeParse({
      transcript: "hello",
      audio_duration_ms: 1200,
      turns: [
        {
          turn_id: "t1",
          start_ms: 0,
          end_ms: 1200,
          transcript: "hello",
          speaker: null,
        },
      ],
      provider: "meta-voice",
      model_id: "muse-voice-transcribe-1.0",
      transcription_id: SESSION_ID,
      interaction_id: SESSION_ID,
      model_run_id: SESSION_ID,
      safety_state: "normal",
      warnings: [],
      blocked: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a missing transcript", () => {
    const parsed = transcribeResponseSchema.safeParse({
      audio_duration_ms: null,
      turns: [],
      provider: "meta-voice",
      model_id: "muse-voice-transcribe-1.0",
      transcription_id: SESSION_ID,
      interaction_id: SESSION_ID,
      model_run_id: SESSION_ID,
      safety_state: "normal",
      warnings: [],
      blocked: false,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("voiceCapabilitiesSchema", () => {
  it("accepts a capability snapshot without secrets", () => {
    const parsed = voiceCapabilitiesSchema.safeParse({
      stt: {
        provider: "meta-voice",
        model_id: "muse-voice-transcribe-1.0",
        configured: true,
        enabled: true,
        available: true,
        accepts: ["audio/wav", "audio/x-wav"],
        max_audio_mb: 32,
        max_audio_bytes: 33554432,
      },
      tts: {
        provider: "browser-speech-synthesis",
        mode: "browser-speech-synthesis",
        server_audio: false,
        configured: true,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("never advertises server audio", () => {
    const parsed = voiceCapabilitiesSchema.safeParse({
      stt: {
        provider: "meta-voice",
        model_id: "muse-voice-transcribe-1.0",
        configured: false,
        enabled: true,
        available: false,
        accepts: ["audio/wav"],
        max_audio_mb: 32,
        max_audio_bytes: 33554432,
      },
      tts: {
        provider: "browser-speech-synthesis",
        mode: "browser-speech-synthesis",
        server_audio: true,
        configured: true,
      },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("speak schemas", () => {
  it("accepts a speak request and policy", () => {
    expect(
      speakRequestSchema.safeParse({ text: "Check the power cable." }).success,
    ).toBe(true);
    const parsed = speakPolicyResponseSchema.safeParse({
      text: "Check the power cable.",
      ssml: "<speak>Check the power cable.</speak>",
      language: "en",
      rate: 1,
      voice_id: null,
      mode: "browser-speech-synthesis",
      audio_base64: null,
      substituted: false,
      safety_state: null,
      warnings: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects blank or oversized speak text", () => {
    expect(speakRequestSchema.safeParse({ text: "  " }).success).toBe(false);
    expect(
      speakRequestSchema.safeParse({ text: "x".repeat(2001) }).success,
    ).toBe(false);
  });
});
