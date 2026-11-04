import type { TestResultOption } from "@fieldfix/contracts";
import type { DemoSession, DemoTest } from "./demo-data";

/**
 * Pure voice-guidance logic: which test to guide, what to speak, and
 * how a spoken answer maps to a recorded result. No DOM access, so the
 * whole module is unit-testable in Node.
 */

/** Initial recognition/synthesis language; plumbed, never translated. */
export const DEFAULT_VOICE_LANGUAGE = "en";

/** Server /speak text cap; longer instructions are truncated. */
export const MAX_SPEAK_CHARS = 2000;

export interface GuidedStep {
  test: DemoTest;
  /** 1-based position of the test within the session's ordering. */
  stepNumber: number;
  total: number;
  /** The test after this one, for the next-step indicator. */
  nextTest: DemoTest | null;
}

/**
 * First test still needing a result, in position order — the same
 * selection rule as the NextAction hero (skips recorded, blocked,
 * and skipped tests).
 */
export function nextGuidedTest(tests: DemoTest[]): GuidedStep | null {
  const ordered = [...tests].sort((a, b) => a.position - b.position);
  const recordable = ordered.filter(
    (test) =>
      test.result == null &&
      test.status !== "blocked" &&
      test.status !== "skipped",
  );
  const current = recordable[0];
  if (!current) {
    return null;
  }
  return {
    test: current,
    stepNumber: ordered.indexOf(current) + 1,
    total: ordered.length,
    nextTest: recordable[1] ?? null,
  };
}

export type GuidanceKind =
  | "critical_stop"
  | "review_required"
  | "next_test"
  | "all_done"
  | "no_tests";

export interface GuidanceState {
  kind: GuidanceKind;
  step: GuidedStep | null;
}

/** Safety-first guidance state mirroring the NextAction tones. */
export function guidanceStateFor(input: {
  safety_state: DemoSession["safety_state"];
  tests: DemoTest[];
}): GuidanceState {
  if (input.safety_state === "critical_stop") {
    return { kind: "critical_stop", step: null };
  }
  if (input.safety_state === "review_required") {
    return { kind: "review_required", step: null };
  }
  if (input.tests.length === 0) {
    return { kind: "no_tests", step: null };
  }
  const step = nextGuidedTest(input.tests);
  if (!step) {
    return { kind: "all_done", step: null };
  }
  return { kind: "next_test", step };
}

/** Bound spoken text to the server /speak cap with a marker. */
export function truncateForSpeech(text: string, max = MAX_SPEAK_CHARS): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** Spoken form of the current instruction + next-step indicator. */
export function buildInstructionSpeech(input: {
  test: DemoTest;
  stepNumber: number;
  total: number;
}): string {
  const steps = [...input.test.instructions]
    .sort((a, b) => a.step - b.step)
    .map((instruction) => `Step ${instruction.step}: ${instruction.text}`)
    .join(" ");
  return truncateForSpeech(
    `Test ${input.stepNumber} of ${input.total}: ${input.test.name}. ${steps}`,
  );
}

function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ORDINAL_WORDS: Record<string, number> = {
  one: 0,
  first: 0,
  two: 1,
  second: 1,
  three: 2,
  third: 2,
  four: 3,
  fourth: 3,
  five: 4,
  fifth: 4,
  six: 5,
  sixth: 5,
};

function ordinalIndex(normalized: string): number | null {
  const match = /^(?:option\s+|number\s+|choice\s+)?([a-z]+|\d+)(?:st|nd|rd|th)?$/.exec(
    normalized,
  );
  const token = match?.[1];
  if (!token) {
    return null;
  }
  if (/^\d+$/.test(token)) {
    const index = Number.parseInt(token, 10) - 1;
    return Number.isInteger(index) && index >= 0 ? index : null;
  }
  const index = ORDINAL_WORDS[token];
  return index === undefined ? null : index;
}

/**
 * Map a spoken (or typed) answer to one of the test's result options.
 * Returns null when nothing matches — callers must ask the user to
 * repeat or pick manually, never record a guessed option.
 */
export function matchTranscriptToOption(
  transcript: string,
  options: TestResultOption[],
): TestResultOption | null {
  if (options.length === 0) {
    return null;
  }
  const normalized = normalizeTranscript(transcript);
  if (!normalized) {
    return null;
  }
  for (const option of options) {
    if (
      normalized === normalizeTranscript(option.value) ||
      normalized === normalizeTranscript(option.label)
    ) {
      return option;
    }
  }
  for (const option of options) {
    const label = normalizeTranscript(option.label);
    if (
      label.length >= 3 &&
      (normalized.includes(label) || label.includes(normalized))
    ) {
      return option;
    }
  }
  const index = ordinalIndex(normalized);
  if (index !== null && index < options.length) {
    return options[index] ?? null;
  }
  return null;
}
