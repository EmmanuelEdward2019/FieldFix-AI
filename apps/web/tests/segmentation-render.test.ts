import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AnnotationResponse } from "../lib/segmentation";
import {
  SegmentationLabels,
  SegmentationLeaders,
  SegmentationLegend,
  SegmentationOverlay,
  labelCallouts,
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

describe("labelCallouts", () => {
  it("computes one ranked callout per distinct label", () => {
    const callouts = labelCallouts(
      [box(), box({ id: "other", label: "screen" }), box({ id: "again", label: "battery" })],
      100,
      80,
    );
    expect(callouts.map((c) => [c.label, c.rank])).toEqual([
      ["battery", 1],
      ["screen", 2],
    ]);
  });

  it("pins the circle on the region corner and the chip beside it", () => {
    const [callout] = labelCallouts([box()], 100, 80);
    // Box at x10/y20 in a 100x80 image → corner callout, chip right.
    expect(callout?.circleX).toBe(10);
    expect(callout?.circleY).toBe(25);
    expect(callout?.chipSide).toBe("right");
  });

  it("drops inside near the top edge and flips near the right edge", () => {
    const [top, right] = labelCallouts(
      [
        box({ id: "top", coordinates: { x: 5, y: 2, width: 6, height: 4 } }),
        box({
          id: "right",
          label: "screen",
          coordinates: { x: 70, y: 40, width: 20, height: 10 },
        }),
      ],
      100,
      80,
    );
    expect(top?.circleX).toBeCloseTo(7.5, 5);
    expect(top?.circleY).toBeCloseTo(9.5, 5);
    expect(right?.chipSide).toBe("left");
  });

  it("draws arrows only when the region is big enough to need one", () => {
    const [tiny] = labelCallouts([box()], 100, 80);
    expect(tiny?.leader).toBeNull();
    expect(tiny?.head).toBeNull();
    const [big] = labelCallouts(
      [box({ id: "big", coordinates: { x: 10, y: 10, width: 60, height: 40 } })],
      100,
      80,
    );
    expect(big?.leader).not.toBeNull();
    expect(big?.head).toHaveLength(3);
  });

  it("marks lower-confidence callouts as uncertain", () => {
    const callouts = labelCallouts([box(), box({ id: "other", label: "screen" })], 100, 80, [
      { name: "battery", confidence: "high" },
      { name: "screen", confidence: "medium" },
    ]);
    expect(callouts.map((c) => c.uncertain)).toEqual([false, true]);
  });

  it("staggers chips whose circles crowd the same zone", () => {
    const [first, second, far] = labelCallouts(
      [
        box({ id: "a", coordinates: { x: 50, y: 40, width: 6, height: 4 } }),
        box({ id: "b", label: "screen", coordinates: { x: 55, y: 42, width: 6, height: 4 } }),
        box({ id: "c", label: "fan", coordinates: { x: 5, y: 60, width: 6, height: 4 } }),
      ],
      100,
      80,
    );
    expect([first?.chipDyPx, second?.chipDyPx, far?.chipDyPx]).toEqual([0, -26, 0]);
  });
});

describe("SegmentationLabels", () => {
  it("renders a numbered circle plus a name chip per distinct label", () => {
    const html = renderToString(
      React.createElement(SegmentationLabels, {
        annotations: [
          box(),
          box({ id: "other", label: "screen" }),
          box({ id: "again", label: "battery" }),
        ],
        imageWidth: 100,
        imageHeight: 80,
      }),
    );
    expect(html).toContain("battery");
    expect(html).toContain("screen");
    expect(html).toContain(">1</span>");
    expect(html).toContain(">2</span>");
    // Duplicate labels reuse the first callout — battery appears once.
    expect(html.match(/battery<\/span>/g)).toHaveLength(1);
  });

  it("positions callouts in percent and adapts to edges", () => {
    const html = renderToString(
      React.createElement(SegmentationLabels, {
        annotations: [
          box({ id: "top", coordinates: { x: 5, y: 2, width: 6, height: 4 } }),
          box({
            id: "right",
            label: "screen",
            coordinates: { x: 70, y: 40, width: 20, height: 10 },
          }),
        ],
        imageWidth: 100,
        imageHeight: 80,
      }),
    );
    // Near-top circle drops inside the region instead of clipping.
    expect(html).toContain("left:7.5%");
    expect(html).toContain("top:9.5%");
    // Right-edge chip hangs left of its circle.
    expect(html).toContain("right:calc(30% + 20px)");
    expect(html).not.toContain("left:calc(70%");
  });

  it("rings uncertain badges instead of filling them", () => {
    const html = renderToString(
      React.createElement(SegmentationLabels, {
        annotations: [box(), box({ id: "other", label: "screen" })],
        imageWidth: 100,
        imageHeight: 80,
        components: [
          { name: "battery", confidence: "high" },
          { name: "screen", confidence: "low" },
        ],
      }),
    );
    expect(html).toContain("0 0 0 3px");
    expect(html).toContain("rgba(255,255,255,0.92)");
  });

  it("dims callouts whose label differs from the highlight", () => {
    const html = renderToString(
      React.createElement(SegmentationLabels, {
        annotations: [box(), box({ id: "other", label: "screen" })],
        imageWidth: 100,
        imageHeight: 80,
        highlightLabel: "battery",
      }),
    );
    expect(html).toContain("opacity-20");
  });

  it("renders nothing when no region has usable geometry", () => {
    expect(
      renderToString(
        React.createElement(SegmentationLabels, {
          annotations: [],
          imageWidth: 100,
          imageHeight: 80,
        }),
      ),
    ).toBe("");
  });

  it("never embeds diagnostic claims in label markup", () => {
    const html = renderToString(
      React.createElement(SegmentationLabels, {
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

describe("SegmentationLeaders", () => {
  const big = () =>
    labelCallouts(
      [box({ id: "big", coordinates: { x: 10, y: 10, width: 60, height: 40 } })],
      100,
      80,
    );

  it("draws a shaft plus an arrowhead per callout", () => {
    const html = renderToString(
      React.createElement(SegmentationLeaders, {
        callouts: big(),
        imageWidth: 100,
        imageHeight: 80,
      }),
    );
    expect(html).toContain("<line");
    expect(html).toContain("<polyline");
    expect(html).toContain('opacity="1"');
  });

  it("dims arrows whose label differs from the highlight", () => {
    const html = renderToString(
      React.createElement(SegmentationLeaders, {
        callouts: big(),
        imageWidth: 100,
        imageHeight: 80,
        highlightLabel: "something else",
      }),
    );
    expect(html).toContain('opacity="0.15"');
  });

  it("renders nothing when no callout needs an arrow", () => {
    const html = renderToString(
      React.createElement(SegmentationLeaders, {
        callouts: labelCallouts([box()], 100, 80),
        imageWidth: 100,
        imageHeight: 80,
      }),
    );
    expect(html).toBe("");
  });
});

describe("SegmentationLegend", () => {
  it("lists one numbered entry per label", () => {
    const html = renderToString(
      React.createElement(SegmentationLegend, {
        annotations: [box(), mask(), box({ id: "other", label: "screen" })],
      }),
    );
    expect(html).toContain("battery");
    expect(html).toContain("screen");
    expect(html).toContain(">1</span>");
    expect(html).toContain(">2</span>");
    expect(html).not.toContain("<button");
  });

  it("renders tappable entries that isolate on the photo", () => {
    const html = renderToString(
      React.createElement(SegmentationLegend, {
        annotations: [box(), box({ id: "other", label: "screen" })],
        selectedLabel: "battery",
        onSelectLabel: () => undefined,
        components: [{ name: "screen", confidence: "low" }],
      }),
    );
    expect(html).toContain("<button");
    expect(html).toContain("aria-pressed=\"true\"");
    expect(html).toContain("Tap a component to isolate it on the photo.");
    expect(html).toContain("Ringed badges are less certain");
  });

  it("renders nothing without annotations", () => {
    expect(
      renderToString(React.createElement(SegmentationLegend, { annotations: [] })),
    ).toBe("");
  });
});
