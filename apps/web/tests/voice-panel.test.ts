import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEMO_SESSIONS, type DemoSession } from "../lib/demo-data";
import { nextGuidedTest } from "../lib/voice-guidance";
import { VoicePanel } from "../components/workstation/voice-panel";

const demo = DEMO_SESSIONS.find(
  (candidate) =>
    (candidate.safety_state === "normal" ||
      candidate.safety_state === "caution") &&
    nextGuidedTest(candidate.tests) != null,
);
if (!demo) {
  throw new Error("demo fixture missing a guidable session");
}

const LIVE = { sessionId: demo.id, token: "tok", onChanged: () => undefined };

function withSession(overrides: Partial<DemoSession>): DemoSession {
  // demo supplies every required field; the spread only narrows optionality.
  return { ...demo, ...overrides } as DemoSession;
}

describe("VoicePanel demo mode", () => {
  it("shows a placeholder and never offers live controls", () => {
    const html = renderToString(React.createElement(VoicePanel, { session: demo }));
    expect(html).toContain("Voice guidance");
    expect(html).toContain("live sessions");
    expect(html).not.toContain("Start voice input");
    expect(html).not.toContain("Play instruction");
    expect(html).not.toContain("Play safety warning");
  });
});

describe("VoicePanel live mode", () => {
  it("shows the current instruction with a next-step indicator", () => {
    const step = nextGuidedTest(demo.tests);
    if (!step) {
      throw new Error("demo fixture needs an unrecorded test");
    }
    const html = renderToString(
      React.createElement(VoicePanel, { session: demo, live: LIVE }),
    );
    expect(html).toContain("Voice guidance");
    // renderToString splits interpolated text with comment nodes; strip them.
    const text = html.replace(/<!-- -->/g, "");
    expect(text).toContain(`Test ${step.stepNumber} of ${step.total}`);
    expect(html).toContain(step.test.name);
    expect(html).toMatch(/Up next:|Last test in this session\./);
    // Settings load after mount; the shell reports its loading state.
    expect(html).toContain("Loading voice settings");
  });

  it("offers spoken-response mute control", () => {
    const html = renderToString(
      React.createElement(VoicePanel, { session: demo, live: LIVE }),
    );
    expect(html).toContain("Turn spoken responses off");
  });

  it("halts guidance and warns on critical stop", () => {
    const stopped = withSession({
      safety_state: "critical_stop",
      safety_events: [
        {
          id: "s1",
          previous_state: "caution",
          new_state: "critical_stop",
          trigger_type: "policy_rule",
          trigger_detail: "Swollen battery wording detected.",
          blocked_action: "record_result",
          safe_next_steps: "Unplug the device and move it away.",
          createdAt: "2026-11-01T00:00:00.000Z",
        },
      ],
    });
    const html = renderToString(
      React.createElement(VoicePanel, { session: stopped, live: LIVE }),
    );
    expect(html).toContain("Stop — hazard identified");
    expect(html).toContain("Swollen battery wording detected.");
    expect(html).toContain("Unplug the device and move it away.");
    expect(html).toContain("Play safety warning");
    expect(html).not.toContain("Start voice input");
    expect(html).not.toMatch(/Test \d+ of/);
  });

  it("pauses guidance while review is required", () => {
    const html = renderToString(
      React.createElement(VoicePanel, {
        session: withSession({ safety_state: "review_required" }),
        live: LIVE,
      }),
    );
    expect(html).toContain("paused until the review completes");
    expect(html).not.toContain("Start voice input");
  });

  it("shows an empty state when no tests exist", () => {
    const html = renderToString(
      React.createElement(VoicePanel, {
        session: withSession({ tests: [] }),
        live: LIVE,
      }),
    );
    expect(html).toContain("No tests to guide yet");
  });

  it("reports completion when every test is recorded", () => {
    const recorded = withSession({
      tests: demo.tests.map((test, index) => ({
        ...test,
        status: "completed" as const,
        result: {
          id: `r${index}`,
          selected_option: test.result_options[0]?.value ?? "done",
          reportedAt: "2026-11-01T00:00:00.000Z",
        },
      })),
    });
    const html = renderToString(
      React.createElement(VoicePanel, { session: recorded, live: LIVE }),
    );
    expect(html).toContain("All tests are recorded");
  });

  it("never claims translation or server-generated audio", () => {
    const html = renderToString(
      React.createElement(VoicePanel, { session: demo, live: LIVE }),
    );
    expect(html.toLowerCase()).not.toContain("translat");
    expect(html.toLowerCase()).not.toContain("multilingual");
  });
});
