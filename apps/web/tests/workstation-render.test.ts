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
});
