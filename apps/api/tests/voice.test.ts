import { randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import {
  apiErrorSchema,
  createSessionResponseSchema,
  logVoiceInteractionResponseSchema,
  speakPolicyResponseSchema,
  transcribeResponseSchema,
  voiceCapabilitiesSchema,
  voicePreferencesResponseSchema,
} from "@fieldfix/contracts";
import { createApp } from "../src/app.js";
import type { Database } from "../src/db/database.js";
import { setupTestDb, teardownTestDb, truncateAll } from "./db/setup.js";
import { hashUserToken } from "../src/auth/user-access.js";
import { UserSessionsRepository, UsersRepository } from "../src/db/repositories/users.js";
import { SettingsRepository } from "../src/db/repositories/settings.js";
import { EventRepository } from "../src/db/repositories/events.js";
import { ModelRunRepository } from "../src/db/repositories/model-runs.js";
import { SafetyEventRepository } from "../src/db/repositories/safety.js";
import {
  SpeechTranscriptionRepository,
  VoiceInteractionRepository,
} from "../src/db/repositories/voice.js";
import type { AppEnv } from "../src/env.js";
import { LocalStorageAdapter } from "../src/storage/local-adapter.js";
import type { StorageAdapter } from "../src/storage/types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ModelError,
  type TranscribeFileInput,
  type TranscriptResult,
  type TranscriptionProvider,
} from "../src/models/types.js";
import { UnconfiguredTranscriptionProvider } from "../src/voice/providers.js";

/** Minimal WAV container: RIFF....WAVE + filler. */
const WAV = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.alloc(4, 0),
  Buffer.from("WAVE", "ascii"),
  Buffer.alloc(64, 1),
]);

const WEBM = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.alloc(64, 2),
]);

const TEST_ENV: AppEnv = {
  NODE_ENV: "test",
  PORT: 3001,
  CORS_ORIGIN: "http://localhost:3000",
  API_VERSION: "0.1.0-test",
  STORAGE_DRIVER: "local",
  MAX_UPLOAD_MB: 10,
  IFIXIT_API_BASE_URL: "https://www.ifixit.com/api/2.0",
  META_MODEL_ID: "muse-spark-1.3",
  SAM_MODEL_ID: "sam-3.1",
  META_API_BASE_URL: "https://api.meta.ai/v1",
  META_REQUEST_TIMEOUT_MS: 60000,
  META_MAX_RETRIES: 3,
  META_REASONING_EFFORT: "medium",
  META_MAX_OUTPUT_TOKENS: 4000,
  META_MAX_IMAGES_PER_REQUEST: 8,
  META_MAX_IMAGE_BYTES: 10 * 1024 * 1024,
  VOICE_MODEL_ID: "muse-voice-transcribe-1.0",
  VOICE_MAX_AUDIO_MB: 32,
  EMAIL_FROM: "FieldFix AI <tests@example.com>",
  APP_BASE_URL: "http://localhost:3000",
};

/** Scripted STT — never touches the network. */
class FakeStt implements TranscriptionProvider {
  readonly id = "meta-voice";
  readonly configured = true;
  transcript = "The screen flickers when I move the lid.";
  failure: ModelError | null = null;
  seen: TranscribeFileInput[] = [];

  async transcribeFile(input: TranscribeFileInput): Promise<TranscriptResult> {
    this.seen.push(input);
    if (this.failure) {
      throw this.failure;
    }
    return {
      transcript: this.transcript,
      audioDurationMs: 1500,
      turns: [
        { turnId: "t1", startMs: 0, endMs: 1500, transcript: this.transcript },
      ],
      providerResponseId: "session-fake-1",
      model: "muse-voice-transcribe-1.0",
      latencyMs: 12,
      attempts: 1,
    };
  }
}

let db: Kysely<Database>;
let storageDir: string;
let storage: StorageAdapter;
let stt: FakeStt;

function app(env: AppEnv = TEST_ENV, provider: TranscriptionProvider | null = null) {
  return createApp(env, {
    db,
    storage,
    transcriptionProvider: provider ?? stt,
  });
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createSession(
  extra: Record<string, unknown> = {},
  token?: string,
) {
  const req = request(app()).post("/api/v1/sessions").send({
    device_type: "laptop",
    symptoms: "Will not power on.",
    user_mode: "everyday",
    ...extra,
  });
  if (token) {
    req.set(bearer(token));
  }
  const res = await req;
  expect(res.status).toBe(201);
  const parsed = createSessionResponseSchema.safeParse(res.body);
  expect(parsed.success).toBe(true);
  if (!parsed.success) {
    throw new Error("create session response failed contract validation");
  }
  return parsed.data;
}

let userCounter = 0;

async function createLoginUser(): Promise<{ id: string; token: string; email: string }> {
  userCounter += 1;
  const email = `voice-user-${userCounter}-${Date.now()}@example.com`;
  const user = await new UsersRepository(db).create({
    email,
    name: "Voice User",
    password_hash: "test-hash",
  });
  const token = randomBytes(32).toString("hex");
  await new UserSessionsRepository(db).create(
    user.id,
    hashUserToken(token),
    new Date(Date.now() + 3600_000),
  );
  return { id: user.id, token, email };
}

beforeAll(async () => {
  db = await setupTestDb();
  storageDir = await mkdtemp(path.join(tmpdir(), "fieldfix-voice-"));
  storage = new LocalStorageAdapter(storageDir);
});

afterAll(async () => {
  await teardownTestDb(db);
  await rm(storageDir, { recursive: true, force: true });
});

beforeEach(async () => {
  stt = new FakeStt();
  await truncateAll(db);
});

describe("POST /api/v1/voice/transcribe", () => {
  it("transcribes WAV audio and persists transcript + interaction + run + event", async () => {
    const session = await createSession();
    const res = await request(app())
      .post("/api/v1/voice/transcribe")
      .set(bearer(session.accessToken))
      .field("session_id", session.session.id)
      .attach("audio", WAV, { filename: "clip.wav", contentType: "audio/wav" });

    expect(res.status).toBe(201);
    const parsed = transcribeResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error("transcribe response failed contract validation");
    }
    expect(parsed.data.transcript).toBe(stt.transcript);
    expect(parsed.data.provider).toBe("meta-voice");
    expect(parsed.data.safety_state).toBe("normal");
    expect(parsed.data.blocked).toBe(false);

    const runs = await new ModelRunRepository(db).listBySession(session.session.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      provider: "meta-voice",
      task_type: "transcription",
      status: "succeeded",
    });
    const transcripts = await new SpeechTranscriptionRepository(db).listBySession(
      session.session.id,
    );
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0]).toMatchObject({
      transcript: stt.transcript,
      confidence: null,
      model_run_id: runs[0]?.id,
    });
    const interactions = await new VoiceInteractionRepository(db).listBySession(
      session.session.id,
    );
    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({ role: "user", audio_storage_key: null });
    const events = await new EventRepository(db).listBySession(session.session.id);
    expect(events.map((e) => e.event_type)).toContain("voice_transcribed");
  });

  it("screens transcripts through the safety controller and blocks the loop", async () => {
    const session = await createSession();
    stt.transcript = "The battery is swollen and smoking badly.";
    const res = await request(app())
      .post("/api/v1/voice/transcribe")
      .set(bearer(session.accessToken))
      .field("session_id", session.session.id)
      .attach("audio", WAV, { filename: "clip.wav", contentType: "audio/wav" });

    expect(res.status).toBe(201);
    expect(res.body.safety_state).toBe("critical_stop");
    expect(res.body.blocked).toBe(true);
    expect(res.body.warnings.length).toBeGreaterThan(0);

    // The transcript never bypasses the loop gate: analyze now 422s.
    const analyze = await request(app())
      .post(`/api/v1/sessions/${session.session.id}/analyze`)
      .set(bearer(session.accessToken))
      .send({});
    expect(analyze.status).toBe(422);
    expect(analyze.body.error.code).toBe("safety_block");
  });

  it("stays open during a pre-existing stop and returns warnings", async () => {
    const session = await createSession({ symptoms: "Battery swollen, screen lifting." });
    expect(session.session.safety_state).toBe("critical_stop");
    const res = await request(app())
      .post("/api/v1/voice/transcribe")
      .set(bearer(session.accessToken))
      .field("session_id", session.session.id)
      .attach("audio", WAV, { filename: "clip.wav", contentType: "audio/wav" });

    expect(res.status).toBe(201);
    expect(res.body.blocked).toBe(true);
    expect(res.body.warnings.length).toBeGreaterThan(0);
    const safetyEvents = await new SafetyEventRepository(db).listBySession(
      session.session.id,
    );
    expect(safetyEvents.length).toBeGreaterThan(0);
  });

  it("rejects unknown sessions, bad tokens, and missing auth", async () => {
    const session = await createSession();
    const unknown = await request(app())
      .post("/api/v1/voice/transcribe")
      .set(bearer(session.accessToken))
      .field("session_id", "00000000-0000-4000-8000-000000000000")
      .attach("audio", WAV, { filename: "clip.wav", contentType: "audio/wav" });
    expect(unknown.status).toBe(404);

    const badToken = await request(app())
      .post("/api/v1/voice/transcribe")
      .set(bearer("deadbeef"))
      .field("session_id", session.session.id)
      .attach("audio", WAV, { filename: "clip.wav", contentType: "audio/wav" });
    expect(badToken.status).toBe(403);

    const noAuth = await request(app())
      .post("/api/v1/voice/transcribe")
      .field("session_id", session.session.id)
      .attach("audio", WAV, { filename: "clip.wav", contentType: "audio/wav" });
    expect(noAuth.status).toBe(403);

    const malformed = await request(app())
      .post("/api/v1/voice/transcribe")
      .set(bearer(session.accessToken))
      .field("session_id", "not-a-uuid")
      .attach("audio", WAV, { filename: "clip.wav", contentType: "audio/wav" });
    expect(malformed.status).toBe(404);
  });

  it("accepts the owning user's login token instead of the session token", async () => {
    const user = await createLoginUser();
    const session = await createSession({}, user.token);
    const res = await request(app())
      .post("/api/v1/voice/transcribe")
      .set(bearer(user.token))
      .field("session_id", session.session.id)
      .attach("audio", WAV, { filename: "clip.wav", contentType: "audio/wav" });
    expect(res.status).toBe(201);

    const stranger = await createLoginUser();
    const denied = await request(app())
      .post("/api/v1/voice/transcribe")
      .set(bearer(stranger.token))
      .field("session_id", session.session.id)
      .attach("audio", WAV, { filename: "clip.wav", contentType: "audio/wav" });
    expect(denied.status).toBe(403);
  });

  it("rejects webm audio and oversized uploads", async () => {
    const session = await createSession();
    const webm = await request(app())
      .post("/api/v1/voice/transcribe")
      .set(bearer(session.accessToken))
      .field("session_id", session.session.id)
      .attach("audio", WEBM, { filename: "clip.webm", contentType: "audio/webm" });
    expect(webm.status).toBe(415);
    expect(webm.body.error.code).toBe("unsupported_media_type");

    const tinyEnv: AppEnv = { ...TEST_ENV, VOICE_MAX_AUDIO_MB: 1 };
    const big = Buffer.concat([WAV, Buffer.alloc(1024 * 1024, 5)]);
    const oversized = await request(app(tinyEnv))
      .post("/api/v1/voice/transcribe")
      .set(bearer(session.accessToken))
      .field("session_id", session.session.id)
      .attach("audio", big, { filename: "big.wav", contentType: "audio/wav" });
    expect(oversized.status).toBe(413);
  });

  it("rejects bad mode and missing audio with 400", async () => {
    const session = await createSession();
    const badMode = await request(app())
      .post("/api/v1/voice/transcribe")
      .set(bearer(session.accessToken))
      .field("session_id", session.session.id)
      .field("mode", "STREAMING")
      .attach("audio", WAV, { filename: "clip.wav", contentType: "audio/wav" });
    expect(badMode.status).toBe(400);

    const noAudio = await request(app())
      .post("/api/v1/voice/transcribe")
      .set(bearer(session.accessToken))
      .field("session_id", session.session.id);
    expect(noAudio.status).toBe(400);
    expect(noAudio.body.error.code).toBe("file_missing");
  });

  it("returns 503 when the kill-switch is off and 501 when unconfigured", async () => {
    const session = await createSession();
    await new SettingsRepository(db).set("ai.voice.enabled", false, null);
    const disabled = await request(app())
      .post("/api/v1/voice/transcribe")
      .set(bearer(session.accessToken))
      .field("session_id", session.session.id)
      .attach("audio", WAV, { filename: "clip.wav", contentType: "audio/wav" });
    expect(disabled.status).toBe(503);
    expect(disabled.body.error.code).toBe("voice_disabled");

    await new SettingsRepository(db).set("ai.voice.enabled", true, null);
    const bare = await request(app(TEST_ENV, new UnconfiguredTranscriptionProvider()))
      .post("/api/v1/voice/transcribe")
      .set(bearer(session.accessToken))
      .field("session_id", session.session.id)
      .attach("audio", WAV, { filename: "clip.wav", contentType: "audio/wav" });
    expect(bare.status).toBe(501);
    expect(bare.body.error.code).toBe("stt_not_configured");
  });

  it("maps provider rate limits to 429 with Retry-After", async () => {
    const session = await createSession();
    stt.failure = new ModelError("rate_limited", "Slow down.", {
      retryable: true,
      retryAfterMs: 7000,
    });
    const res = await request(app())
      .post("/api/v1/voice/transcribe")
      .set(bearer(session.accessToken))
      .field("session_id", session.session.id)
      .attach("audio", WAV, { filename: "clip.wav", contentType: "audio/wav" });
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("7");
    const runs = await new ModelRunRepository(db).listBySession(session.session.id);
    expect(runs[0]).toMatchObject({ status: "failed", error_category: "rate_limited" });
  });
});

describe("voice preferences", () => {
  it("serves defaults, then persists PUT round-trips with PATCH semantics", async () => {
    const user = await createLoginUser();
    const defaults = await request(app())
      .get("/api/v1/voice/preferences")
      .set(bearer(user.token));
    expect(defaults.status).toBe(200);
    expect(voicePreferencesResponseSchema.safeParse(defaults.body).success).toBe(true);
    expect(defaults.body.preferences).toMatchObject({
      user_id: user.id,
      spoken_responses: true,
      voice_id: null,
      rate: 1,
      language: "en",
    });

    const updated = await request(app())
      .put("/api/v1/voice/preferences")
      .set(bearer(user.token))
      .send({ spoken_responses: false, language: "es", rate: 1.25 });
    expect(updated.status).toBe(200);
    expect(updated.body.preferences).toMatchObject({
      spoken_responses: false,
      language: "es",
      rate: 1.25,
    });

    // Partial update keeps the other keys (no reset-to-default).
    const partial = await request(app())
      .put("/api/v1/voice/preferences")
      .set(bearer(user.token))
      .send({ language: "de" });
    expect(partial.status).toBe(200);
    expect(partial.body.preferences).toMatchObject({
      spoken_responses: false,
      rate: 1.25,
      language: "de",
    });
  });

  it("validates input and requires login", async () => {
    const user = await createLoginUser();
    const bad = await request(app())
      .put("/api/v1/voice/preferences")
      .set(bearer(user.token))
      .send({ rate: 99 });
    expect(bad.status).toBe(400);

    const anon = await request(app()).get("/api/v1/voice/preferences");
    expect(anon.status).toBe(401);
    expect(apiErrorSchema.safeParse(anon.body).success).toBe(true);
  });
});

describe("POST /api/v1/voice/interactions/log", () => {
  it("logs turns, screens them, and appends session events", async () => {
    const session = await createSession();
    const res = await request(app())
      .post("/api/v1/voice/interactions/log")
      .set(bearer(session.accessToken))
      .send({ session_id: session.session.id, role: "assistant", text: "Check the power cable." });
    expect(res.status).toBe(201);
    expect(logVoiceInteractionResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.interaction.role).toBe("assistant");
    expect(res.body.blocked).toBe(false);

    const hazard = await request(app())
      .post("/api/v1/voice/interactions/log")
      .set(bearer(session.accessToken))
      .send({ session_id: session.session.id, role: "user", text: "The battery is swollen and smoking." });
    expect(hazard.status).toBe(201);
    expect(hazard.body.safety_state).toBe("critical_stop");
    expect(hazard.body.blocked).toBe(true);

    const events = await new EventRepository(db).listBySession(session.session.id);
    expect(events.filter((e) => e.event_type === "voice_interaction_logged")).toHaveLength(2);
  });

  it("validates input and enforces ownership", async () => {
    const session = await createSession();
    const bad = await request(app())
      .post("/api/v1/voice/interactions/log")
      .set(bearer(session.accessToken))
      .send({ session_id: session.session.id, role: "system", text: "hi" });
    expect(bad.status).toBe(400);

    const denied = await request(app())
      .post("/api/v1/voice/interactions/log")
      .set(bearer("deadbeef"))
      .send({ session_id: session.session.id, role: "user", text: "hi" });
    expect(denied.status).toBe(403);
  });
});

describe("GET /api/v1/voice/capabilities", () => {
  it("reports actual STT/TTS configuration without secrets", async () => {
    const user = await createLoginUser();
    const res = await request(app())
      .get("/api/v1/voice/capabilities")
      .set(bearer(user.token));
    expect(res.status).toBe(200);
    expect(voiceCapabilitiesSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.stt).toMatchObject({
      provider: "meta-voice",
      model_id: "muse-voice-transcribe-1.0",
      configured: true,
      enabled: true,
      available: true,
      max_audio_mb: 32,
    });
    expect(res.body.tts).toMatchObject({
      mode: "browser-speech-synthesis",
      server_audio: false,
    });
    expect(JSON.stringify(res.body)).not.toContain("META_API_KEY");
  });

  it("reflects the kill-switch and unconfigured providers", async () => {
    const user = await createLoginUser();
    await new SettingsRepository(db).set("ai.voice.enabled", false, null);
    const off = await request(app())
      .get("/api/v1/voice/capabilities")
      .set(bearer(user.token));
    expect(off.body.stt.enabled).toBe(false);
    expect(off.body.stt.available).toBe(false);

    await new SettingsRepository(db).set("ai.voice.enabled", true, null);
    const bare = await request(app(TEST_ENV, new UnconfiguredTranscriptionProvider()))
      .get("/api/v1/voice/capabilities")
      .set(bearer(user.token));
    expect(bare.body.stt.configured).toBe(false);
    expect(bare.body.stt.available).toBe(false);
  });
});

describe("POST /api/v1/voice/speak", () => {
  it("returns a speak policy with no audio bytes", async () => {
    const user = await createLoginUser();
    await request(app())
      .put("/api/v1/voice/preferences")
      .set(bearer(user.token))
      .send({ language: "es", rate: 1.5 });
    const res = await request(app())
      .post("/api/v1/voice/speak")
      .set(bearer(user.token))
      .send({ text: "Check the <cable> & adapter." });
    expect(res.status).toBe(200);
    expect(speakPolicyResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.audio_base64).toBeNull();
    expect(res.body.mode).toBe("browser-speech-synthesis");
    expect(res.body.language).toBe("es");
    expect(res.body.rate).toBe(1.5);
    expect(res.body.ssml).toContain("Check the &lt;cable&gt; &amp; adapter.");
    expect(res.body.substituted).toBe(false);
  });

  it("substitutes safety warnings in blocked sessions", async () => {
    const session = await createSession({ symptoms: "Battery swollen, screen lifting." });
    const res = await request(app())
      .post("/api/v1/voice/speak")
      .set(bearer(session.accessToken))
      .send({ session_id: session.session.id, text: "Continue the diagnosis." });
    expect(res.status).toBe(200);
    expect(res.body.substituted).toBe(true);
    expect(res.body.safety_state).toBe("critical_stop");
    expect(res.body.warnings.length).toBeGreaterThan(0);
    expect(res.body.text).not.toContain("Continue the diagnosis.");
  });
});
