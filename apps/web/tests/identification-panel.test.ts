import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AnnotationResponse, IdentificationResponse } from "@fieldfix/contracts";
import {
  IdentificationPanel,
  analysisAttention,
  type IdentificationState,
} from "../components/workstation/identification-panel";
import { SegmentationOverlay } from "../components/workstation/segmentation-layer";

function identification(): IdentificationResponse {
  return {
    id: "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa",
    session_id: "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb",
    evidence_file_id: "cccccccc-0000-4000-8000-cccccccccccc",
    device_name: "Test Laptop 14",
    components: [
      { name: "battery", confidence: "high", note: "Bottom compartment." },
      { name: "cooling fan", confidence: "medium", note: null },
    ],
    suspected_fault_area: { component_name: "battery", rationale: "Discolored connector." },
    unidentifiable: ["small bracket at the top edge"],
    model_run_id: null,
    created_at: "2026-11-03T12:00:00.000Z",
  };
}

function state(overrides: Partial<IdentificationState> = {}): IdentificationState {
  return {
    status: "ready",
    identification: identification(),
    warnings: [],
    message: null,
    identify: () => undefined,
    retry: () => undefined,
    ...overrides,
  };
}

function box(id: string, label: string): AnnotationResponse {
  return {
    id,
    evidence_file_id: "cccccccc-0000-4000-8000-cccccccccccc",
    kind: "box",
    coordinates: { x: 10, y: 20, width: 6, height: 4 },
    label,
    producer: "sam-3.1",
    image_width: 100,
    image_height: 80,
    model_run_id: null,
    svg_path: null,
    created_at: "2026-11-03T12:00:00.000Z",
  };
}

const noop = () => undefined;

describe("IdentificationPanel", () => {
  it("runs automatically when idle instead of showing a trigger button", () => {
    const html = renderToString(
      React.createElement(IdentificationPanel, {
        state: state({ status: "idle", identification: null }),
        onLocalized: noop,
        labelledCount: 0,
      }),
    );
    // The hook auto-starts the pass on a missing identification; the
    // panel only narrates progress — there is no manual trigger.
    expect(html).toContain("Identifying components automatically");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Potential fault area");
  });

  it("summarizes graphically without a typed component list", () => {
    const html = renderToString(
      React.createElement(IdentificationPanel, {
        state: state({}),
        onLocalized: noop,
        labelledCount: 1,
      }),
    );
    expect(html).toContain("Test Laptop 14");
    expect(html).toContain("2 named · 1 outlined on the photo above");
    // Components live on the photo (circles, arrows, boxes) plus the
    // tappable legend — the panel keeps only the device line, the
    // framing chip, and the fault-area callout.
    expect(html).not.toContain("cooling fan");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Could not confidently identify");
    expect(html).not.toContain("small bracket at the top edge");
    expect(html).toContain("Potential fault area:");
    expect(html).toContain("Discolored connector.");
    expect(html).toContain("visual hypothesis only");
  });

  it("says so honestly when nothing could be outlined", () => {
    const html = renderToString(
      React.createElement(IdentificationPanel, {
        state: state({}),
        onLocalized: noop,
        labelledCount: 0,
      }),
    );
    expect(html).toContain("none could be outlined on this photo");
    expect(html).not.toContain("labelled on the photo above");
  });

  it("frames recognition as distinct from diagnosis", () => {
    const html = renderToString(
      React.createElement(IdentificationPanel, {
        state: state({}),
        onLocalized: noop,
        labelledCount: 2,
      }),
    );
    expect(html).toContain("Recognition — not a diagnosis");
  });

  it("explains failures with a retry action", () => {
    const html = renderToString(
      React.createElement(IdentificationPanel, {
        state: state({ status: "error", identification: null, message: "Vision down." }),
        onLocalized: noop,
        labelledCount: 0,
      }),
    );
    expect(html).toContain("Component identification failed:");
    expect(html).toContain("Vision down.");
    expect(html).toContain("Retry");
  });
});

describe("analysisAttention", () => {
  const base = {
    live: true,
    identificationReady: true,
    hypothesisCount: 0,
    busy: false,
    blocked: false,
  };

  it("lights up when identified with nothing diagnosed yet", () => {
    expect(analysisAttention(base)).toBe(true);
  });

  it("stays calm when any precondition is missing", () => {
    expect(analysisAttention({ ...base, live: false })).toBe(false);
    expect(analysisAttention({ ...base, identificationReady: false })).toBe(false);
    expect(analysisAttention({ ...base, hypothesisCount: 2 })).toBe(false);
    expect(analysisAttention({ ...base, busy: true })).toBe(false);
    expect(analysisAttention({ ...base, blocked: true })).toBe(false);
  });
});

describe("SegmentationOverlay highlight", () => {
  it("dims shapes whose label differs from the highlight", () => {
    const html = renderToString(
      React.createElement(SegmentationOverlay, {
        annotations: [box("a1", "battery"), box("a2", "cooling fan")],
        imageWidth: 100,
        imageHeight: 80,
        highlightLabel: "battery",
      }),
    );
    expect(html).toContain("opacity=\"0.15\"");
    expect(html).toContain("opacity=\"1\"");
  });

  it("renders everything full-strength without a highlight", () => {
    const html = renderToString(
      React.createElement(SegmentationOverlay, {
        annotations: [box("a1", "battery")],
        imageWidth: 100,
        imageHeight: 80,
      }),
    );
    expect(html).not.toContain("opacity=\"0.15\"");
  });
});
