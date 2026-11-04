import request from "supertest";
import { describe, expect, it } from "vitest";
import { healthResponseSchema, apiErrorSchema } from "@fieldfix/contracts";
import { createApp } from "../src/app.js";

const app = createApp({
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
});

describe("GET /health", () => {
  it("returns 200 with a contract-valid payload", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    const parsed = healthResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    expect(res.body.service).toBe("fieldfix-api");
    expect(res.body.version).toBe("0.1.0-test");
  });
});

describe("unknown routes", () => {
  it("returns the 404 error envelope", async () => {
    const res = await request(app).get("/does-not-exist");
    expect(res.status).toBe(404);
    expect(apiErrorSchema.safeParse(res.body).success).toBe(true);
  });
});
