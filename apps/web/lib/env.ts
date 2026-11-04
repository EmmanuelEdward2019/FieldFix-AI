const DEFAULT_API_BASE_URL = "http://localhost:3001";

/** Base URL of the FieldFix API. Same default as apps/api/.env.example. */
export function getApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!raw) {
    return DEFAULT_API_BASE_URL;
  }
  return raw.replace(/\/+$/, "");
}
