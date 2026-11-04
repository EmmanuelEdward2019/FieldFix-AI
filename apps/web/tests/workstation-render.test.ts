import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => React.createElement("a", { href }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { DEMO_SESSIONS } from "../lib/demo-data";
import { SessionHeader } from "../components/workstation/session-header";
import { EvidenceCanvas } from "../components/workstation/evidence-canvas";
import { HypothesisPanel } from "../components/workstation/hypothesis-panel";
import { DiagnosticChecklist } from "../components/workstation/diagnostic-checklist";
import { ReferencePanel } from "../components/workstation/reference-panel";
import { SafetyStatus } from "../components/workstation/safety-status";
import { ActivityFeed } from "../components/workstation/activity-feed";
import { SidebarNav } from "../components/workstation/sidebar-nav";
import { EvidenceUpload } from "../components/workstation/evidence-upload";
import { NextAction } from "../components/workstation/next-action";
import { VisualWorkspace } from "../components/workstation/visual-workspace";

const noop = () => undefined;

describe("workstation panels render", () => {
  for (const session of DEMO_SESSIONS) {
    it(`renders panels for ${session.id.slice(0, 8)}`, () => {
      const trees = [
        React.createElement(SessionHeader, { session }),
        React.createElement(EvidenceCanvas, {
          files: session.evidence,
          observations: session.observations,
          deviceType: session.device_type,
          selectedFileId: null,
          onSelectFile: noop,
          showAnnotations: true,
          onToggleAnnotations: noop,
        }),
        React.createElement(HypothesisPanel, {
          hypotheses: session.hypotheses,
        }),
        React.createElement(DiagnosticChecklist, {
          tests: session.tests,
          safetyBlocked: false,
          activeTestId: null,
          onSelectTest: noop,
          captures: {},
          onCaptureChange: noop,
        }),
        React.createElement(ReferencePanel, {
          citations: session.citations,
        }),
        React.createElement(SafetyStatus, { session }),
        React.createElement(ActivityFeed, {
          events: session.events,
          modelRuns: session.model_runs,
        }),
      ];
      for (const tree of trees) {
        expect(() => renderToString(tree)).not.toThrow();
      }
    });
  }

  it("renders sidebar and uploader", () => {
    expect(() =>
      renderToString(
        React.createElement(SidebarNav, {
          sessions: DEMO_SESSIONS,
          realSessions: [],
          activeSessionId: DEMO_SESSIONS[0]?.id ?? "",
          onSelectSession: noop,
          onNewSession: noop,
        }),
      ),
    ).not.toThrow();
    expect(() =>
      renderToString(
        React.createElement(EvidenceUpload, {
          sessionId: "x",
          token: "y",
          onUploaded: noop,
        }),
      ),
    ).not.toThrow();
  });
});

describe("visual workspace", () => {
  const stubPanels = {
    safety: React.createElement("div", null, "safety-stub"),
    canvas: React.createElement("div", null, "canvas-stub"),
    hypotheses: React.createElement("div", null, "hypotheses-stub"),
    checklist: React.createElement("div", null, "checklist-stub"),
    refs: React.createElement("div", null, "refs-stub"),
    activity: React.createElement("div", null, "activity-stub"),
    report: React.createElement("div", null, "report-stub"),
    voice: React.createElement("div", null, "voice-stub"),
    parts: React.createElement("div", null, "parts-stub"),
  };

  for (const session of DEMO_SESSIONS) {
    it(`renders demo workspace for ${session.id.slice(0, 8)} with functional CTAs`, () => {
      const html = renderToString(
        React.createElement(VisualWorkspace, {
          session,
          isLive: false,
          panels: stubPanels,
        }),
      );
      // Session context is shown...
      expect(html).toContain(session.symptoms);
      // ...and demo calls-to-action are real links, never dead buttons
      // (safety-stop states intentionally carry no CTA).
      const elevated =
        session.safety_state === "critical_stop" || session.safety_state === "review_required";
      if (!elevated) {
        expect(html).toMatch(/href="(\/login|\/register)[^"]*"/);
      }
      expect(html).toContain("Demo data");
    });

    it(`renders live workspace for ${session.id.slice(0, 8)} without demo CTAs`, () => {
      const html = renderToString(
        React.createElement(VisualWorkspace, {
          session,
          isLive: true,
          nextLive: { sessionId: session.id, token: "tok", onChanged: noop },
          panels: stubPanels,
        }),
      );
      expect(html).toContain(session.symptoms);
      expect(html).not.toContain("/login");
      expect(html).not.toContain("/register");
      expect(html).toContain("Live session");
    });

    it(`renders next-action hero for ${session.id.slice(0, 8)}`, () => {
      const html = renderToString(React.createElement(NextAction, { session }));
      expect(html).toMatch(
        /Next recommended test|Stop — hazard|Review required|sample analysis|recorded|Analyse this session/,
      );
    });
  }

  it("places recognition above the hero and the voice bar below it", () => {
    const session = DEMO_SESSIONS[0];
    if (!session) {
      throw new Error("no fixture session");
    }
    const html = renderToString(
      React.createElement(VisualWorkspace, {
        session,
        isLive: false,
        panels: stubPanels,
      }),
    );
    const canvas = html.indexOf("canvas-stub");
    const voice = html.indexOf("voice-stub");
    expect(canvas).toBeGreaterThanOrEqual(0);
    // Canvas first (recognition), then the hero, then the voice bar —
    // voice left the side column, so it precedes the side refs stub.
    expect(voice).toBeGreaterThan(canvas);
    expect(voice).toBeLessThan(html.indexOf("refs-stub"));
    const recorded = session.tests.filter((t) => t.result != null).length;
    const blocked = session.tests.filter(
      (t) => t.safety_classification === "blocked",
    ).length;
    expect(html).toContain(
      `All tests (${recorded}/${session.tests.length} recorded${blocked > 0 ? ` · ${blocked} unavailable` : ""})`,
    );
  });

  it("states the recorded test count plainly in the header", () => {
    for (const session of DEMO_SESSIONS) {
      if (session.tests.length === 0) {
        continue;
      }
      // renderToString splits interpolated text with comment nodes; strip them.
      const html = renderToString(
        React.createElement(SessionHeader, { session }),
      ).replace(/<!-- -->/g, "");
      const recorded = session.tests.filter((t) => t.result != null).length;
      expect(html).toContain(`Tests: ${recorded}/${session.tests.length}`);
      // The Tests sublabel names the state; the session status badge may
      // still legitimately read "In progress".
      const blocked = session.tests.filter(
        (t) => t.safety_classification === "blocked",
      ).length;
      const sublabel =
        blocked > 0
          ? `${blocked} unavailable on safety grounds`
          : recorded === 0
            ? "No results recorded yet"
            : recorded === session.tests.length
              ? "All recorded"
              : "Recording results";
      expect(html).toContain(sublabel);
    }
  });

  it("scans live photos automatically with no manual locate step", () => {
    const session = DEMO_SESSIONS.find((s) =>
      s.evidence.some((f) => f.kind === "image"),
    );
    if (!session) {
      throw new Error("no photo fixture session");
    }
    const html = renderToString(
      React.createElement(EvidenceCanvas, {
        files: session.evidence,
        observations: session.observations,
        deviceType: session.device_type,
        selectedFileId: null,
        onSelectFile: noop,
        showAnnotations: true,
        onToggleAnnotations: noop,
        live: { sessionId: session.id, token: "tok" },
      }),
    );
    // The beam is on from the first paint; the manual trigger is gone.
    expect(html).toContain("Scanning photo");
    expect(html).not.toContain("Locate components");
  });
});

describe("safety-blocked tests", () => {
  const base = DEMO_SESSIONS.find((s) => s.safety_state === "normal");
  if (!base) {
    throw new Error("no normal fixture session");
  }
  const [first, second] = base.tests;
  if (!first || !second) {
    throw new Error("fixture needs two tests");
  }
  const blocked = {
    ...first,
    name: "Blocked first test",
    position: 0,
    result: null,
    status: "pending" as const,
    safety_classification: "blocked" as const,
  };
  const safe = {
    ...second,
    name: "Safe second test",
    position: 1,
    result: null,
    status: "pending" as const,
    safety_classification: "safe" as const,
  };

  it("hero skips blocked tests for the next actionable one", () => {
    // The backend refuses results for safety-blocked tests, so
    // offering one freezes the header count at 0/N with a 422 on
    // every Record attempt.
    const html = renderToString(
      React.createElement(NextAction, { session: { ...base, tests: [blocked, safe] } }),
    );
    expect(html).toContain("Safe second test");
    expect(html).not.toContain("Blocked first test");
  });

  it("hero explains when only blocked tests remain", () => {
    const html = renderToString(
      React.createElement(NextAction, { session: { ...base, tests: [blocked] } }),
    );
    expect(html).toContain("Remaining tests blocked");
    expect(html).toContain("remaining test");
    expect(html).toContain("blocked on safety grounds");
    expect(html).not.toContain("All 0 tests recorded");
  });

  it("checklist disables recording for blocked tests", () => {
    const html = renderToString(
      React.createElement(DiagnosticChecklist, {
        tests: [blocked],
        safetyBlocked: false,
        activeTestId: blocked.id,
        onSelectTest: noop,
        captures: {},
        onCaptureChange: noop,
      }),
    );
    expect(html).toContain("Blocked on safety grounds");
    expect(html).not.toContain("Record your result");
  });
});

describe("session header history", () => {
  const base = DEMO_SESSIONS.find((s) => s.safety_state === "normal");
  if (!base) {
    throw new Error("no normal fixture session");
  }

  it("shows the reported problem history instead of Unknown", () => {
    const html = renderToString(
      React.createElement(SessionHeader, {
        session: {
          ...base,
          problem_started_note: "Since the update",
          recent_events: "Dropped last week",
        },
      }),
    );
    expect(html).toContain("Since the update");
    expect(html).toContain("Dropped last week");
    expect(html).not.toContain("Unknown");
  });

  it("falls back honestly when no history was given", () => {
    const html = renderToString(
      React.createElement(SessionHeader, {
        session: { ...base, problem_started_note: undefined, recent_events: undefined },
      }),
    );
    expect(html).toContain("Unknown");
    expect(html).toContain("None reported");
  });
});
