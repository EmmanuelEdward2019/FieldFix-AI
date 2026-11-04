import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AnnotationResponse } from "../lib/segmentation";
import {
  SegmentationLegend,
  SegmentationOverlay,
} from "../components/workstation/segmentation-layer";

function box(overrides: Partial<AnnotationResponse> = {}): AnnotationResponse {
  return {
    id: "3f2a9b1e-0a8c-4c3f-8e1d-9d2f3a4b5c6d",
    evidence_file_id: "7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
    kind: "box",
    coordinates: { x: 10, y: 20, width: 6, height: 4 },
    label: "battery",
    producer: "sam-3.1",
    image_width: 100,
    image_height: 80,
    model_run_id: "9a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
    svg_path: null,
    created_at: "2026-10-31T00:00:00.000Z",
    ...overrides,
  };
}

function mask(): AnnotationResponse {
  return box({
    id: "4f2a9b1e-0a8c-4c3f-8e1d-9d2f3a4b5c6d",
    kind: "mask",
    coordinates: {
      rows: 4,
      cols: 6,
      data: "!!!!!)Hl*&R0zEZ",
      bounds: { left: 10, top: 20, right: 16, bottom: 24 },
    },
    svg_path: "M0,0 L6,0 L6,4 Z",
  });
}

describe("SegmentationOverlay", () => {
  it("draws boxes in source pixels inside an image-sized viewBox", () => {
    const html = renderToString(
      React.createElement(SegmentationOverlay, {
        annotations: [box()],
        imageWidth: 100,
        imageHeight: 80,
      }),
    );
    expect(html).toContain('viewBox="0 0 100 80"');
    expect(html).toContain('x="10"');
    expect(html).toContain('y="20"');
    expect(html).toContain('width="6"');
    expect(html).toContain('height="4"');
    expect(html).toContain('aria-label="Located component regions: battery"');
  });

  it("places mask paths with the bounds transform", () => {
    const html = renderToString(
      React.createElement(SegmentationOverlay, {
        annotations: [mask()],
        imageWidth: 100,
        imageHeight: 80,
      }),
    );
    expect(html).toContain('transform="translate(10 20) scale(1 1)"');
    expect(html).toContain("<title>battery</title>");
  });

  it("renders nothing when there are no annotations", () => {
    const html = renderToString(
      React.createElement(SegmentationOverlay, {
        annotations: [],
        imageWidth: 100,
        imageHeight: 80,
      }),
    );
    expect(html).toBe("");
  });

  it("never embeds diagnostic claims in overlay markup", () => {
    const html = renderToString(
      React.createElement(SegmentationOverlay, {
        annotations: [box(), mask()],
        imageWidth: 100,
        imageHeight: 80,
      }),
    );
    expect(html.toLowerCase()).not.toContain("fault");
    expect(html.toLowerCase()).not.toContain("diagnos");
    expect(html.toLowerCase()).not.toContain("defect");
  });
});

describe("SegmentationLegend", () => {
  it("lists one entry per label", () => {
    const html = renderToString(
      React.createElement(SegmentationLegend, {
        annotations: [box(), mask(), box({ id: "other", label: "screen" })],
      }),
    );
    expect(html).toContain("battery");
    expect(html).toContain("screen");
  });

  it("renders nothing without annotations", () => {
    expect(
      renderToString(React.createElement(SegmentationLegend, { annotations: [] })),
    ).toBe("");
  });
});
