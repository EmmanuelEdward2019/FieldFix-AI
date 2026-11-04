/**
 * Shared technician-handoff rules (Phase 5 frontend integration).
 *
 * There is no "inconclusive"/"unable-to-test" vocabulary in the
 * contracts — those states are DERIVED here from stored data so the
 * dashboard and the workspace agree on when to recommend a human:
 *
 * - critical_stop: the safety controller stopped the session. Always
 *   recommend professional help, never further DIY steps.
 * - inconclusive: no safe test remains AND nothing was verified. The
 *   diagnosis stalled (tests exhausted/blocked, hypotheses unverified).
 *
 * The CTA must NEVER show while a safe test remains.
 */

export type HandoffSignal = "critical_stop" | "inconclusive";

interface HandoffTest {
  result: unknown;
  status: string;
}

interface HandoffHypothesis {
  status: string;
}

const TERMINAL_TEST_STATUS = new Set(["blocked", "skipped"]);

/** True when at least one test can still be run safely. */
export function hasRemainingSafeTest(tests: HandoffTest[]): boolean {
  return tests.some((t) => t.result == null && !TERMINAL_TEST_STATUS.has(t.status));
}

/** True when every proposed cause stalled short of verification. */
export function hypothesesInconclusive(hypotheses: HandoffHypothesis[]): boolean {
  return hypotheses.length > 0 && hypotheses.every((h) => h.status !== "verified");
}

/**
 * Workspace-level signal from full session detail. Returns null when
 * the session should keep going on its own (a safe test remains, or
 * nothing has stalled yet).
 */
export function workspaceTechnicianSignal(input: {
  safety_state: string;
  tests: HandoffTest[];
  hypotheses: HandoffHypothesis[];
}): HandoffSignal | null {
  if (input.safety_state === "critical_stop") {
    return "critical_stop";
  }
  if (hasRemainingSafeTest(input.tests)) {
    return null;
  }
  const verified = input.hypotheses.some((h) => h.status === "verified");
  if (verified) {
    return null;
  }
  if (input.tests.length === 0 && input.hypotheses.length === 0) {
    return null;
  }
  return "inconclusive";
}

/**
 * Dashboard-level signal from a session list item (no hypothesis
 * detail available). A session whose tests are exhausted without
 * completing reads as inconclusive; critical_stop is explicit.
 */
export function sessionTechnicianSignal(item: {
  status: string;
  safety_state: string;
  test_count: number;
  tests_recorded: number;
}): HandoffSignal | null {
  if (item.safety_state === "critical_stop") {
    return "critical_stop";
  }
  if (item.status === "completed" || item.status === "archived") {
    return null;
  }
  if (item.test_count > 0 && item.tests_recorded >= item.test_count) {
    return "inconclusive";
  }
  return null;
}
