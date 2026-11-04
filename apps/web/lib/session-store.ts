import type { SafetyState, SessionStatus } from "@fieldfix/contracts";

/** A live session the user created, with its access token. */
export interface StoredRealSession {
  id: string;
  token: string;
  device_type: "laptop" | "desktop" | "smartphone";
  model: string | null;
  symptoms: string;
  status: SessionStatus;
  safety_state: SafetyState;
  updatedAt: string;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY = "fieldfix.realSessions.v1";
const MAX_STORED = 20;

function isStoredSession(value: unknown): value is StoredRealSession {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.token === "string" &&
    (v.device_type === "laptop" ||
      v.device_type === "desktop" ||
      v.device_type === "smartphone") &&
    (v.model === null || typeof v.model === "string") &&
    typeof v.symptoms === "string" &&
    typeof v.updatedAt === "string"
  );
}

/** List stored sessions, newest first. Garbage in storage reads as empty. */
export function listRealSessions(store: KeyValueStore): StoredRealSession[] {
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(isStoredSession)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export function saveRealSession(
  store: KeyValueStore,
  session: StoredRealSession,
): StoredRealSession[] {
  const rest = listRealSessions(store).filter((s) => s.id !== session.id);
  const next = [session, ...rest].slice(0, MAX_STORED);
  store.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function removeRealSession(
  store: KeyValueStore,
  id: string,
): StoredRealSession[] {
  const next = listRealSessions(store).filter((s) => s.id !== id);
  store.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function getRealSessionToken(
  store: KeyValueStore,
  id: string,
): string | null {
  return listRealSessions(store).find((s) => s.id === id)?.token ?? null;
}

/** Browser localStorage, or null outside the browser (SSR/tests). */
export function getBrowserStore(): KeyValueStore | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  return window.localStorage;
}
