import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertDemoIntegrity } from "../lib/demo-data";
import {
  applySampleAnalysis,
  buildGuestSession,
  loadGuestSessions,
  recordGuestResult,
  saveGuestSession,
  screenDemoHazards,
  type DemoWizardInput,
} from "../lib/demo-runner";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

const INPUT: DemoWizardInput = {
  device: "laptop",
  category: "power",
  manufacturer: "Acme",
  model: "AcmeBook 14",
  operatingSystem: "Windows 11",
  symptoms: "Laptop will not power on. No lights at all.",
  userMode: "everyday",
  photos: [{ name: "front.jpg", type: "image/jpeg", size: 120000 }],
};

describe("screenDemoHazards", () => {
  it("escalates swollen-battery phrasing to critical stop", () => {
    const screen = screenDemoHazards("The battery looks swollen and the case is lifting.");
    expect(screen.state).toBe("critical_stop");
    expect(screen.category).toBe("battery_swelling");
    expect(screen.safeSteps).toMatch(/power off/i);
  });

  it("escalates smoke and heat phrasing to critical stop", () => {
    expect(screenDemoHazards("There is smoke coming from the vent.").state).toBe("critical_stop");
    expect(screenDemoHazards("It gets too hot to touch.").state).toBe("critical_stop");
  });

  it("leaves ordinary symptoms normal", () => {
    expect(screenDemoHazards(INPUT.symptoms).state).toBe("normal");
  });
});

describe("guest session lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", memoryStorage());
  });

  it("builds an integrity-checked session from wizard input", () => {
    const session = buildGuestSession(INPUT);
    expect(() => assertDemoIntegrity([session])).not.toThrow();
    expect(session.device_type).toBe("laptop");
    expect(session.manufacturer).toBe("Acme");
    expect(session.safety_state).toBe("normal");
    expect(session.evidence).toHaveLength(1);
    expect(session.hypotheses).toHaveLength(0);
    expect(session.tests).toHaveLength(0);
  });

  it("builds a critical-stop session for hazard input", () => {
    const session = buildGuestSession({ ...INPUT, symptoms: "Battery is swollen." });
    expect(session.safety_state).toBe("critical_stop");
    expect(session.safety_events).toHaveLength(1);
    expect(() => assertDemoIntegrity([session])).not.toThrow();
  });

  it("sample analysis fills hypotheses, tests, and a demo model run", () => {
    const session = applySampleAnalysis(buildGuestSession(INPUT));
    expect(session.hypotheses.length).toBeGreaterThan(0);
    expect(session.tests.length).toBeGreaterThan(0);
    expect(session.status).toBe("in_progress");
    expect(session.model_runs).toHaveLength(1);
    expect(session.model_runs[0]?.origin).toBe("demo");
    expect(() => assertDemoIntegrity([session])).not.toThrow();
  });

  it("sample analysis refuses blocked sessions and repeats safely", () => {
    const stopped = buildGuestSession({ ...INPUT, symptoms: "I see smoke." });
    expect(applySampleAnalysis(stopped)).toBe(stopped);
    const once = applySampleAnalysis(buildGuestSession(INPUT));
    expect(applySampleAnalysis(once)).toBe(once);
  });

  it("records results locally and completes the session", () => {
    let session = applySampleAnalysis(buildGuestSession(INPUT));
    for (const test of session.tests) {
      session = recordGuestResult(session, test.id, test.result_options[0]?.value ?? "x", null);
    }
    expect(session.status).toBe("completed");
    expect(session.tests.every((t) => t.result != null)).toBe(true);
    expect(() => assertDemoIntegrity([session])).not.toThrow();
  });

  it("refuses recording on blocked sessions", () => {
    const stopped = buildGuestSession({ ...INPUT, symptoms: "Sparks from the port." });
    expect(recordGuestResult(stopped, "whatever", "x", null)).toBe(stopped);
  });

  it("round-trips guest sessions through session storage", () => {
    const session = applySampleAnalysis(buildGuestSession(INPUT));
    saveGuestSession(session);
    const loaded = loadGuestSessions();
    expect(loaded.map((s) => s.id)).toContain(session.id);
    expect(() => assertDemoIntegrity(loaded)).not.toThrow();
  });

  it("drops corrupt guest payloads instead of crashing", () => {
    sessionStorage.setItem("fieldfix.demo.guest-sessions", "not-json{");
    expect(loadGuestSessions()).toEqual([]);
    sessionStorage.setItem(
      "fieldfix.demo.guest-sessions",
      JSON.stringify([{ id: "x", nope: true }]),
    );
    expect(loadGuestSessions()).toEqual([]);
  });
});
