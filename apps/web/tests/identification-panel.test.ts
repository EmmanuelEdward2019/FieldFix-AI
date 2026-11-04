import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AnnotationResponse, IdentificationResponse } from "@fieldfix/contracts";
import {
  IdentificationPanel,
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
  it("invites a first pass when idle and never fetches by itself", () => {
    const html = renderToString(
      React.createElement(IdentificationPanel, {
        state: state({ status: "idle", identification: null }),
        selectedLabel: null,
        onSelectLabel: noop,
        onLocalized: noop,
      }),
    );
    expect(html).toContain("Identify components");
    expect(html).not.toContain("Potential fault area");
  });

  it("renders device, components, the visual hypothesis, and unknowns", () => {
    const html = renderToString(
      React.createElement(IdentificationPanel, {
        state: state({}),
        selectedLabel: null,
        onSelectLabel: noop,
        onLocalized: noop,
      }),
    );
    expect(html).toContain("Test Laptop 14");
    expect(html).toContain("battery");
    expect(html).toContain("cooling fan");
    expect(html).toContain("High");
    expect(html).toContain("Potential fault area:");
    expect(html).toContain(">battery</p>");
    expect(html).toContain("Discolored connector.");
    expect(html).toContain("visual hypothesis only");
    expect(html).toContain("Could not confidently identify");
    expect(html).toContain("small bracket at the top edge");
  });

  it("marks the selected component pressed", () => {
    const html = renderToString(
      React.createElement(IdentificationPanel, {
        state: state({}),
        selectedLabel: "battery",
        onSelectLabel: noop,
        onLocalized: noop,
      }),
    );
    expect(html).toContain("aria-pressed=\"true\"");
  });

  it("explains failures with a retry action", () => {
    const html = renderToString(
      React.createElement(IdentificationPanel, {
        state: state({ status: "error", identification: null, message: "Vision down." }),
        selectedLabel: null,
        onSelectLabel: noop,
        onLocalized: noop,
      }),
    );
    expect(html).toContain("Component identification failed:");
    expect(html).toContain("Vision down.");
    expect(html).toContain("Retry");
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
