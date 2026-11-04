import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  earnedMilestones,
  recordMilestone,
  subscribeMilestones,
} from "../lib/milestones";

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

describe("milestones", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  it("earns each badge once and notifies subscribers", () => {
    const seen: string[] = [];
    const stop = subscribeMilestones((m) => void seen.push(m.event));
    try {
      const first = recordMilestone("user:1", "session_started");
      expect(first?.event).toBe("session_started");
      expect(recordMilestone("user:1", "session_started")).toBeNull();
      expect(seen).toEqual(["session_started"]);
      expect(earnedMilestones("user:1")).toEqual(["session_started"]);
    } finally {
      stop();
    }
  });

  it("keeps live and guest progress separate", () => {
    recordMilestone("guest", "analysis_run");
    expect(earnedMilestones("guest")).toEqual(["analysis_run"]);
    expect(earnedMilestones("user:1")).toEqual([]);
  });

  it("survives corrupt stored payloads", () => {
    localStorage.setItem("fieldfix.milestones.user:1", "not-json{");
    expect(earnedMilestones("user:1")).toEqual([]);
    expect(recordMilestone("user:1", "result_recorded")?.event).toBe("result_recorded");
  });
});
