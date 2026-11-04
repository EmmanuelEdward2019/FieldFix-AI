import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiagnosisWizard } from "../components/diagnosis-wizard";
import { HypothesisPanel } from "../components/workstation/hypothesis-panel";
import type { DemoLoopActions } from "../components/workstation/demo-actions";
import { DEMO_SESSIONS } from "../lib/demo-data";

const DEMO_LOOP: DemoLoopActions = {
  analyzing: false,
  analysisStep: 0,
  runSampleAnalysis: () => undefined,
  recordResult: () => undefined,
  recordingId: null,
  safetyBlocked: false,
};

describe("diagnosis wizard parity", () => {
  const base = {
    initialDevice: "laptop" as const,
    starting: false,
    startStep: 0,
    startError: null as string | null,
    onStart: () => undefined,
  };

  it("renders the same guided steps for live and demo modes", () => {
    for (const demo of [false, true]) {
      const html = renderToString(React.createElement(DiagnosisWizard, { ...base, demo }));
      for (const step of ["Device", "Problem", "Details", "Review"]) {
        expect(html).toContain(step);
      }
      for (const device of ["Laptop", "Desktop", "Smartphone"]) {
        expect(html).toContain(device);
      }
    }
  });

  it("labels the demo run as a sample, never a real diagnosis", () => {
    const demoHtml = renderToString(React.createElement(DiagnosisWizard, { ...base, demo: true }));
    expect(demoHtml).toContain("Try a Sample Diagnosis");
    expect(demoHtml).toContain("Sample run with fictional data");
    const liveHtml = renderToString(React.createElement(DiagnosisWizard, { ...base }));
    expect(liveHtml).toContain("New Diagnosis");
    expect(liveHtml).not.toContain("Sample run with fictional data");
  });
});

describe("demo panel actions", () => {
  const demo = DEMO_SESSIONS[0];
  if (!demo) {
    throw new Error("demo fixture missing");
  }

  it("offers sample analysis in demo mode without live wording", () => {
    const html = renderToString(
      React.createElement(HypothesisPanel, {
        hypotheses: [],
        demo: DEMO_LOOP,
        deviceType: demo.device_type,
      }),
    );
    expect(html).toContain("Run sample analysis");
    expect(html).not.toContain("Run AI analysis");
  });

  it("hides the sample trigger once hypotheses exist", () => {
    const html = renderToString(
      React.createElement(HypothesisPanel, {
        hypotheses: demo.hypotheses,
        demo: DEMO_LOOP,
        deviceType: demo.device_type,
      }),
    );
    expect(html).not.toContain("Run sample analysis");
  });
});
