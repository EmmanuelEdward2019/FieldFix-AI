import { z } from "zod";

const connectionStringSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === "postgres:" || url.protocol === "postgresql:";
      } catch {
        return false;
      }
    },
    { message: "must be a postgres:// or postgresql:// connection string" },
  );

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  CORS_ORIGIN: z.string().min(1).default("http://localhost:3000"),
  API_VERSION: z.string().min(1).default("0.1.0"),
  DATABASE_URL: connectionStringSchema.optional(),
  DATABASE_URL_TEST: connectionStringSchema.optional(),
  STORAGE_DRIVER: z.enum(["local"]).default("local"),
  STORAGE_DIR: z.string().min(1).optional(),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(10),
  SUPER_ADMIN_EMAILS: z.string().max(2000).optional(),
  MFA_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "must be 32 bytes as 64 hex chars")
    .optional(),
  RESEND_API_KEY: z.string().min(1).max(256).optional(),
  EMAIL_FROM: z.string().min(3).max(256).default("FieldFix AI <onboarding@resend.dev>"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  IFIXIT_API_BASE_URL: z.string().url().default("https://www.ifixit.com/api/2.0"),
  META_API_KEY: z.string().min(1).optional(),
  META_MODEL_ID: z.string().min(1).max(120).default("muse-spark-1.3"),
  SAM_MODEL_ID: z.string().min(1).max(120).default("sam-3.1"),
  VOICE_MODEL_ID: z.string().min(1).max(120).default("muse-voice-transcribe-1.0"),
  VOICE_MAX_AUDIO_MB: z.coerce.number().int().min(1).max(32).default(32),
  META_API_BASE_URL: z.string().url().default("https://api.meta.ai/v1"),
  META_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(60000),
  META_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(3),
  META_REASONING_EFFORT: z
    .enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
    .default("medium"),
  // The Responses API counts reasoning + output tokens against this budget,
  // so vision analyses with medium effort need headroom above 4000.
  META_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(16).max(100000).default(16000),
  META_MAX_IMAGES_PER_REQUEST: z.coerce.number().int().min(0).max(20).default(8),
  META_MAX_IMAGE_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(50 * 1024 * 1024)
    .default(10 * 1024 * 1024),
});

export type AppEnv = z.infer<typeof envSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * Validate process.env at startup. Throws on invalid config so the
 * service fails fast with a readable message instead of misbehaving.
 */
export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid API environment: ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}
