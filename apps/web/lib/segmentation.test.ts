import { describe, expect, it } from "vitest";
import {
  isRenderableAnnotation,
  legendLabels,
  maskOverlayTransform,
  overlayAriaLabel,
  summarizeAnnotations,
  type AnnotationResponse,
} from "./segmentation";

function annotation(overrides: Partial<AnnotationResponse> = {}): AnnotationResponse {
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

function mask(overrides: Partial<AnnotationResponse> = {}): AnnotationResponse {
  return annotation({
    kind: "mask",
    coordinates: {
      rows: 4,
      cols: 6,
      data: "!!!!!)Hl*&R0zEZ",
      bounds: { left: 10, top: 20, right: 16, bottom: 24 },
    },
    svg_path: "M0,0 L6,0 L6,4 Z",
    ...overrides,
  });
}

describe("maskOverlayTransform", () => {
  it("maps the raster onto its source-pixel bounds", () => {
    // 6x4 raster covering a 6x4 source box: unit scale at (10, 20).
    expect(maskOverlayTransform(mask())).toBe("translate(10 20) scale(1 1)");
  });

  it("scales up when the raster is smaller than its bounds", () => {
    const scaled = mask({
      coordinates: {
        rows: 2,
        cols: 3,
        data: "!!!!!)Hl*&R0zEZ",
        bounds: { left: 10, top: 20, right: 16, bottom: 24 },
      },
    });
    expect(maskOverlayTransform(scaled)).toBe("translate(10 20) scale(2 2)");
  });

  it("falls back to full-image scaling when bounds are absent", () => {
    const full = mask({
      coordinates: { rows: 40, cols: 50, data: "!!!!!)Hl*&R0zEZ" },
    });
    // 100x80 image over a 50x40 raster.
    expect(maskOverlayTransform(full)).toBe("scale(2 2)");
  });

  it("returns null for degenerate geometry", () => {
    expect(maskOverlayTransform(annotation())).toBeNull();
    expect(
      maskOverlayTransform(
        mask({
          coordinates: {
            rows: 4,
            cols: 6,
            data: "!!!!!)Hl*&R0zEZ",
            bounds: { left: 10, top: 20, right: 10, bottom: 24 },
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("summarizeAnnotations", () => {
  it("keeps renderable shapes and counts skipped ones", () => {
    const undecodable = mask({ svg_path: null });
    const summary = summarizeAnnotations([annotation(), mask(), undecodable]);
    expect(summary.renderable).toHaveLength(2);
    expect(summary.skipped).toBe(1);
    expect(isRenderableAnnotation(undecodable)).toBe(false);
  });
});

describe("overlay labels", () => {
  it("lists labels without implying a diagnosis", () => {
    const label = overlayAriaLabel([annotation(), mask(), annotation({ label: "battery" })]);
    expect(label).toBe("Located component regions: battery");
    expect(legendLabels([annotation(), mask({ label: "screen" })])).toEqual([
      "battery",
      "screen",
    ]);
  });

  it("names the empty state", () => {
    expect(overlayAriaLabel([])).toBe("No component regions located");
    expect(legendLabels([])).toEqual([]);
  });
});
