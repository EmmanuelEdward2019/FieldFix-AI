import { sql } from "kysely";
import type {
  Db,
  NewSpeechTranscription,
  NewVoiceInteraction,
  SpeechTranscription,
  VoiceInteraction,
  VoicePreference,
} from "../database.js";

/** Per-user spoken-response settings (one row per user). */
export class VoicePreferencesRepository {
  constructor(private readonly db: Db) {}

  async getByUserId(userId: string): Promise<VoicePreference | undefined> {
    return this.db
      .selectFrom("voice_preferences")
      .selectAll()
      .where("user_id", "=", userId)
      .executeTakeFirst();
  }

  async upsert(
    userId: string,
    patch: {
      spoken_responses?: boolean;
      voice_id?: string | null;
      rate?: number;
      language?: string;
    },
  ): Promise<VoicePreference> {
    // PATCH semantics: merge over the stored row (or defaults) so an
    // omitted key keeps its value instead of resetting to the default.
    const existing = await this.getByUserId(userId);
    const merged = {
      spoken_responses: existing?.spoken_responses ?? true,
      voice_id: existing?.voice_id ?? null,
      rate: existing?.rate ?? 1,
      language: existing?.language ?? "en",
    };
    if (patch.spoken_responses !== undefined) {
      merged.spoken_responses = patch.spoken_responses;
    }
    if (patch.voice_id !== undefined) {
      merged.voice_id = patch.voice_id;
    }
    if (patch.rate !== undefined) {
      merged.rate = patch.rate;
    }
    if (patch.language !== undefined) {
      merged.language = patch.language;
    }
    return this.db
      .insertInto("voice_preferences")
      .values({ user_id: userId, ...merged })
      .onConflict((oc) =>
        oc.column("user_id").doUpdateSet((eb) => ({
          spoken_responses: eb.ref("excluded.spoken_responses"),
          voice_id: eb.ref("excluded.voice_id"),
          rate: eb.ref("excluded.rate"),
          language: eb.ref("excluded.language"),
          updated_at: sql`now()`,
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}

/** Session-linked conversation log (transcripts + readouts). */
export class VoiceInteractionRepository {
  constructor(private readonly db: Db) {}

  async create(
    input: Omit<NewVoiceInteraction, "id" | "created_at" | "updated_at">,
  ): Promise<VoiceInteraction> {
    return this.db
      .insertInto("voice_interactions")
      .values(input)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listBySession(
    sessionId: string,
    limit = 200,
  ): Promise<VoiceInteraction[]> {
    return this.db
      .selectFrom("voice_interactions")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "asc")
      .limit(limit)
      .execute();
  }
}

/** STT result log (transcript content; observability is in model_runs). */
export class SpeechTranscriptionRepository {
  constructor(private readonly db: Db) {}

  async create(
    input: Omit<NewSpeechTranscription, "id" | "created_at">,
  ): Promise<SpeechTranscription> {
    return this.db
      .insertInto("speech_transcriptions")
      .values(input)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listBySession(
    sessionId: string,
    limit = 200,
  ): Promise<SpeechTranscription[]> {
    return this.db
      .selectFrom("speech_transcriptions")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "asc")
      .limit(limit)
      .execute();
  }
}
