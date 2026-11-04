import { describe, expect, it } from "vitest";
import type { TestResultOption } from "@fieldfix/contracts";
import type { DemoTest } from "./demo-data";
import {
  buildInstructionSpeech,
  DEFAULT_VOICE_LANGUAGE,
  guidanceStateFor,
  matchTranscriptToOption,
  MAX_SPEAK_CHARS,
  nextGuidedTest,
  truncateForSpeech,
} from "./voice-guidance";

function makeTest(overrides: Partial<DemoTest> = {}): DemoTest {
  return {
    id: "t1",
    name: "Charger swap",
    objective: "Rule out the charger.",
    required_tools: [],
    skill_level: "beginner",
    safety_classification: "safe",
    instructions: [
      { step: 2, text: "Plug in the known-good charger." },
      { step: 1, text: "Unplug the current charger." },
    ],
    result_options: [
      { value: "powers_on", label: "Powers on" },
      { value: "still_dead", label: "Still dead" },
    ],
    position: 0,
    status: "awaiting_result",
    result: null,
    ...overrides,
  };
}

const OPTIONS: TestResultOption[] = [
  { value: "powers_on", label: "Powers on" },
  { value: "still_dead", label: "Still dead" },
  { value: "not_sure", label: "Not sure" },
];

describe("nextGuidedTest", () => {
  it("picks the first unrecorded test in position order", () => {
    const step = nextGuidedTest([
      makeTest({ id: "b", position: 1, name: "Second" }),
      makeTest({ id: "a", position: 0, name: "First" }),
    ]);
    expect(step?.test.id).toBe("a");
    expect(step?.stepNumber).toBe(1);
    expect(step?.total).toBe(2);
    expect(step?.nextTest?.id).toBe("b");
  });

  it("skips recorded, blocked, and skipped tests", () => {
    const step = nextGuidedTest([
      makeTest({
        id: "done",
        position: 0,
        status: "completed",
        result: {
          id: "r",
          selected_option: "powers_on",
          reportedAt: "2026-11-01T00:00:00.000Z",
        },
      }),
      makeTest({ id: "blocked", position: 1, status: "blocked" }),
      makeTest({ id: "skipped", position: 2, status: "skipped" }),
      makeTest({ id: "next", position: 3 }),
    ]);
    expect(step?.test.id).toBe("next");
    expect(step?.stepNumber).toBe(4);
    expect(step?.nextTest).toBeNull();
  });

  it("returns null when every test is recorded", () => {
    expect(
      nextGuidedTest([
        makeTest({
          id: "done",
          status: "completed",
          result: {
            id: "r",
            selected_option: "powers_on",
            reportedAt: "2026-11-01T00:00:00.000Z",
          },
        }),
      ]),
    ).toBeNull();
  });
});

describe("guidanceStateFor", () => {
  const tests = [makeTest()];

  it("reports safety states first", () => {
    expect(
      guidanceStateFor({ safety_state: "critical_stop", tests }).kind,
    ).toBe("critical_stop");
    expect(
      guidanceStateFor({ safety_state: "review_required", tests }).kind,
    ).toBe("review_required");
  });

  it("reports no_tests, all_done, and next_test", () => {
    expect(guidanceStateFor({ safety_state: "normal", tests: [] }).kind).toBe(
      "no_tests",
    );
    expect(
      guidanceStateFor({ safety_state: "caution", tests }).kind,
    ).toBe("next_test");
    expect(
      guidanceStateFor({ safety_state: "normal", tests }).step?.test.id,
    ).toBe("t1");
    const recorded = makeTest({
      status: "completed",
      result: {
        id: "r",
        selected_option: "powers_on",
        reportedAt: "2026-11-01T00:00:00.000Z",
      },
    });
    expect(
      guidanceStateFor({ safety_state: "normal", tests: [recorded] }).kind,
    ).toBe("all_done");
  });
});

describe("buildInstructionSpeech", () => {
  it("reads steps in order with a next-step indicator", () => {
    const speech = buildInstructionSpeech({
      test: makeTest(),
      stepNumber: 2,
      total: 4,
    });
    expect(speech).toContain("Test 2 of 4");
    expect(speech).toContain("Charger swap");
    expect(speech.indexOf("Step 1")).toBeLessThan(speech.indexOf("Step 2"));
  });

  it("truncates past the server speak cap", () => {
    const speech = buildInstructionSpeech({
      test: makeTest({
        instructions: [
          { step: 1, text: "x".repeat(MAX_SPEAK_CHARS + 100) },
        ],
      }),
      stepNumber: 1,
      total: 1,
    });
    expect(speech.length).toBeLessThanOrEqual(MAX_SPEAK_CHARS);
  });
});

describe("truncateForSpeech", () => {
  it("passes short text through and marks truncation", () => {
    expect(truncateForSpeech("hello")).toBe("hello");
    expect(truncateForSpeech("hello world", 6)).toBe("hello…");
  });
});

describe("matchTranscriptToOption", () => {
  it("matches exact values and labels case-insensitively", () => {
    expect(matchTranscriptToOption("powers_on", OPTIONS)?.value).toBe(
      "powers_on",
    );
    expect(matchTranscriptToOption("Still Dead!", OPTIONS)?.value).toBe(
      "still_dead",
    );
  });

  it("matches partial answers containing a label", () => {
    expect(
      matchTranscriptToOption("yeah it still dead I think", OPTIONS)?.value,
    ).toBe("still_dead");
  });

  it("maps ordinals to option positions", () => {
    expect(matchTranscriptToOption("option two", OPTIONS)?.value).toBe(
      "still_dead",
    );
    expect(matchTranscriptToOption("3", OPTIONS)?.value).toBe("not_sure");
    expect(matchTranscriptToOption("first", OPTIONS)?.value).toBe("powers_on");
  });

  it("returns null when nothing matches", () => {
    expect(matchTranscriptToOption("the fan is loud", OPTIONS)).toBeNull();
    expect(matchTranscriptToOption("  ", OPTIONS)).toBeNull();
    expect(matchTranscriptToOption("powers on", [])).toBeNull();
    expect(matchTranscriptToOption("option nine", OPTIONS)).toBeNull();
  });
});

describe("voice language default", () => {
  it("starts English", () => {
    expect(DEFAULT_VOICE_LANGUAGE).toBe("en");
  });
});
