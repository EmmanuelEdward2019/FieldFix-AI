import { ModelError, type ModelErrorCategory } from "../types.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function parseEnvelope(bodyText: string): {
  message?: string;
  type?: string;
  code?: string;
} {
  try {
    const root = asRecord(JSON.parse(bodyText) as unknown);
    const err = root ? asRecord(root.error) : null;
    if (!err) {
      return {};
    }
    const pick = (v: unknown): string | undefined =>
      typeof v === "string" && v.length > 0 ? v : undefined;
    return {
      message: pick(err.message),
      type: pick(err.type),
      code: pick(err.code),
    };
  } catch {
    return {};
  }
}

/**
 * Categorize a failed Meta HTTP call from status + envelope (branches on
 * status, then type, then code — code is often null per the docs).
 * Returned messages are safe: provider messages are truncated and only
 * ever logged, never holding secrets.
 */
export function categorizeHttpFailure(
  status: number,
  bodyText: string,
): ModelError {
  const envelope = parseEnvelope(bodyText);
  const detail = envelope.message ? `: ${truncate(envelope.message, 300)}` : "";
  const base = { status, providerCode: envelope.code };

  if (envelope.code === "model_not_found") {
    return new ModelError(
      "not_found",
      `Configured model is unavailable${detail}. Check META_MODEL_ID; no substitute was used.`,
      base,
    );
  }

  let category: ModelErrorCategory;
  let message: string;
  let retryable = false;
  switch (status) {
    case 400:
      category = "invalid_request";
      message = `Provider rejected the request${detail}.`;
      break;
    case 401:
      category = "auth";
      message = "Provider authentication failed. Check META_API_KEY.";
      break;
    case 402:
    case 403:
      category = "forbidden";
      message = `Provider refused the request (HTTP ${status})${detail}.`;
      break;
    case 404:
      category = "not_found";
      message = `Provider resource not found${detail || ": check the endpoint and model id"}.`;
      break;
    case 413:
      category = "payload_too_large";
      message = `Request exceeded provider limits${detail}.`;
      break;
    case 429:
      category = "rate_limited";
      retryable = true;
      message = `Rate limited by the provider${detail}.`;
      break;
    case 500:
    case 502:
    case 503:
      category = "unavailable";
      retryable = true;
      message = `Provider service error (HTTP ${status})${detail}.`;
      break;
    case 504:
      category = "timeout";
      retryable = true;
      message = "Provider timed out (HTTP 504).";
      break;
    default:
      category = status >= 500 ? "unavailable" : "unknown";
      retryable = status >= 500;
      message = `Unexpected provider response (HTTP ${status})${detail}.`;
  }
  return new ModelError(category, message, { ...base, retryable });
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
