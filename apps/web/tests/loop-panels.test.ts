import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReportResponse } from "@fieldfix/contracts";
import { DEMO_SESSIONS } from "../lib/demo-data";
import { ReportBody } from "../components/workstation/report-panel";
import { SafetyStatus } from "../components/workstation/safety-status";
import { HypothesisPanel } from "../components/workstation/hypothesis-panel";

const REPORT: ReportResponse = {
  id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  session_id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
  status: "ready",
  report_data: {
    device: {
      device_type: "laptop",
      manufacturer: "Acme",
      model: "AcmeBook Pro 14",
      operating_system: null,
    },
    symptoms: "Will not power on.",
    evidence_ids: [],
    observable_facts: ["user_reported: Loud fan reported."],
    hypotheses: [
      {
        id: "cccccccc-3333-4333-8333-cccccccccccc",
        title: "Failing battery",
        status: "proposed",
        confidence_label: "medium",
        supporting_observations: [{ kind: "note", id: null, note: "Swollen" }],
        contradicting_observations: [],
      },
    ],
    tests_performed: [
      {
        test_id: "dddddddd-4444-4444-8444-dddddddddddd",
        name: "Charger swap",
        result: "option_1",
        observation: null,
        source: "user_reported",
      },
    ],
    sources: [
      {
        citation_id: "eeeeeeee-5555-4555-8555-eeeeeeeeeeee",
        document_title: "Acme Service Manual",
        page_number: 12,
        excerpt: "Check the battery connector.",
      },
    ],
    remaining_uncertainty: [],
    recommended_next_steps: ["Swap the charger."],
    safety_summary: [],
    assessment: "Session covers a laptop. No fault has been independently verified.",
  },
  error_message: null,
  created_at: "2026-10-31T00:02:00.000Z",
  updated_at: "2026-10-31T00:02:00.000Z",
};

describe("ReportBody", () => {
  it("renders every report section with provenance labels", () => {
    const html = renderToString(React.createElement(ReportBody, { report: REPORT }));
    for (const expected of [
      "User-reported symptoms",
      "Will not power on",
      "Assessment",
      "No fault has been independently verified",
      "Failing battery",
      "Charger swap",
      "user-reported",
      "Acme Service Manual",
      "Recommended next steps",
    ]) {
      expect(html).toContain(expected);
    }
  });
});

describe("live panel actions", () => {
  const demo = DEMO_SESSIONS[0];
  if (!demo) {
    throw new Error("demo fixture missing");
  }

  it("shows the analysis trigger for live sessions only", () => {
    const liveHtml = renderToString(
      React.createElement(HypothesisPanel, {
        hypotheses: demo.hypotheses,
        live: {
          sessionId: demo.id,
          token: "tok",
          safetyBlocked: false,
          userMode: "everyday",
          onChanged: () => undefined,
        },
      }),
    );
    expect(liveHtml).toContain("Run AI analysis");
    const demoHtml = renderToString(
      React.createElement(HypothesisPanel, { hypotheses: demo.hypotheses }),
    );
    expect(demoHtml).not.toContain("Run AI analysis");
  });

  it("withholds the analysis prompt until identification lands", () => {
    // Server render never observes the readiness event, so the prompt
    // and animation stay off by default; they switch on live in the
    // browser once the photo reports named components.
    const html = renderToString(
      React.createElement(HypothesisPanel, {
        hypotheses: [],
        live: {
          sessionId: demo.id,
          token: "tok",
          safetyBlocked: false,
          userMode: "everyday",
          onChanged: () => undefined,
        },
      }),
    );
    expect(html).toContain("Run AI analysis");
    expect(html).not.toContain("Components identified above");
    expect(html).not.toContain("animate-attention");
  });

  it("gates safety transitions behind technician mode", () => {
    const techHtml = renderToString(
      React.createElement(SafetyStatus, {
        session: { ...demo, user_mode: "technician" },
        live: { sessionId: demo.id, token: "tok", onChanged: () => undefined },
      }),
    );
    expect(techHtml).toContain("Request transition");
    const everydayHtml = renderToString(
      React.createElement(SafetyStatus, {
        session: demo,
        live: { sessionId: demo.id, token: "tok", onChanged: () => undefined },
      }),
    );
    expect(everydayHtml).toContain("require a technician session");
    expect(everydayHtml).not.toContain("Request transition");
  });
});
