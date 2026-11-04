import { describe, expect, it } from "vitest";
import {
  getRealSessionToken,
  listRealSessions,
  removeRealSession,
  saveRealSession,
  type KeyValueStore,
  type StoredRealSession,
} from "./session-store";

function memoryStore(initial?: Record<string, string>): KeyValueStore {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const SESSION_A: StoredRealSession = {
  id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  token: "token-a",
  device_type: "laptop",
  model: "AcmeBook Pro 14",
  symptoms: "Will not power on.",
  status: "open",
  safety_state: "normal",
  updatedAt: "2026-10-30T09:00:00.000Z",
};

const SESSION_B: StoredRealSession = {
  ...SESSION_A,
  id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
  token: "token-b",
  updatedAt: "2026-10-30T10:00:00.000Z",
};

describe("session store", () => {
  it("saves, lists newest-first, and looks up tokens", () => {
    const store = memoryStore();
    expect(listRealSessions(store)).toEqual([]);
    saveRealSession(store, SESSION_A);
    saveRealSession(store, SESSION_B);
    expect(listRealSessions(store).map((s) => s.id)).toEqual([
      SESSION_B.id,
      SESSION_A.id,
    ]);
    expect(getRealSessionToken(store, SESSION_A.id)).toBe("token-a");
    expect(getRealSessionToken(store, "missing")).toBeNull();
  });

  it("upserts on re-save and removes by id", () => {
    const store = memoryStore();
    saveRealSession(store, SESSION_A);
    saveRealSession(store, { ...SESSION_A, token: "rotated" });
    expect(listRealSessions(store)).toHaveLength(1);
    expect(getRealSessionToken(store, SESSION_A.id)).toBe("rotated");
    removeRealSession(store, SESSION_A.id);
    expect(listRealSessions(store)).toEqual([]);
  });

  it("accepts desktop sessions", () => {
    const store = memoryStore();
    saveRealSession(store, { ...SESSION_A, device_type: "desktop" });
    expect(listRealSessions(store)[0]?.device_type).toBe("desktop");
  });

  it("treats corrupt or foreign payloads as empty", () => {
    expect(listRealSessions(memoryStore({ "fieldfix.realSessions.v1": "%%%" }))).toEqual(
      [],
    );
    expect(
      listRealSessions(
        memoryStore({ "fieldfix.realSessions.v1": JSON.stringify({ a: 1 }) }),
      ),
    ).toEqual([]);
    expect(
      listRealSessions(
        memoryStore({
          "fieldfix.realSessions.v1": JSON.stringify([{ id: "x" }, SESSION_A]),
        }),
      ),
    ).toEqual([SESSION_A]);
  });
});
