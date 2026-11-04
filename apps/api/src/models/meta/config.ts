import type { AppEnv } from "../../env.js";

export interface MetaAdapterConfig {
  apiKey?: string;
  baseUrl: string;
  modelId: string;
  timeoutMs: number;
  maxRetries: number;
  reasoningEffort: string;
  maxOutputTokens: number;
  maxImagesPerRequest: number;
  maxImageBytes: number;
}

export function loadMetaConfig(env: AppEnv): MetaAdapterConfig {
  return {
    apiKey: env.META_API_KEY,
    baseUrl: env.META_API_BASE_URL.replace(/\/+$/, ""),
    modelId: env.META_MODEL_ID,
    timeoutMs: env.META_REQUEST_TIMEOUT_MS,
    maxRetries: env.META_MAX_RETRIES,
    reasoningEffort: env.META_REASONING_EFFORT,
    maxOutputTokens: env.META_MAX_OUTPUT_TOKENS,
    maxImagesPerRequest: env.META_MAX_IMAGES_PER_REQUEST,
    maxImageBytes: env.META_MAX_IMAGE_BYTES,
  };
}

/** Log-safe view of the config: the key is never included. */
export function describeMetaConfig(config: MetaAdapterConfig): Record<string, unknown> {
  return {
    baseUrl: config.baseUrl,
    modelId: config.modelId,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    reasoningEffort: config.reasoningEffort,
    maxOutputTokens: config.maxOutputTokens,
    apiKeyConfigured: config.apiKey !== undefined,
  };
}
