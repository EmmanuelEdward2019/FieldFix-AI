import { describe, expect, it } from "vitest";
import {
  annotationResponseSchema,
  listSegmentationsResponseSchema,
  segmentRequestSchema,
  segmentResponseSchema,
} from "../src/index.js";

const BOX_COORDS = { x: 10, y: 20, width: 6, height: 4 };
const MASK_COORDS = {
  rows: 4,
  cols: 6,
  data: "!!!!!)Hl*&R0zEZ",
  bounds: { left: 10, top: 20, right: 16, bottom: 24 },
};

function annotation(kind: "box" | "mask") {
  return {
    id: "3f2a9b1e-0a8c-4c3f-8e1d-9d2f3a4b5c6d",
    evidence_file_id: "7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
    kind,
    coordinates: kind === "box" ? BOX_COORDS : MASK_COORDS,
    label: "battery",
    producer: "sam-3.1",
    image_width: 100,
    image_height: 80,
    model_run_id: "9a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
    svg_path: kind === "mask" ? "M10,20 L16,20 L16,24 Z" : null,
    created_at: "2026-10-31T00:00:00.000Z",
  };
}

describe("segmentRequestSchema", () => {
  it("accepts omitted concepts (caller defaults apply)", () => {
    expect(segmentRequestSchema.safeParse({}).success).toBe(true);
  });

  it("accepts up to eight concepts", () => {
    expect(
      segmentRequestSchema.safeParse({ concepts: ["a", "b", "c", "d", "e", "f", "g", "h"] }).success,
    ).toBe(true);
  });

  it("rejects more than eight concepts", () => {
    expect(
      segmentRequestSchema.safeParse({
        concepts: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
      }).success,
    ).toBe(false);
  });

  it("rejects blank concepts and token-grammar smuggling characters", () => {
    expect(segmentRequestSchema.safeParse({ concepts: ["  "] }).success).toBe(false);
    expect(segmentRequestSchema.safeParse({ concepts: ["battery<|>screen"] }).success).toBe(false);
    expect(segmentRequestSchema.safeParse({ concepts: ["<", ">", "|"] }).success).toBe(false);
  });
});

describe("annotationResponseSchema", () => {
  it("accepts a box annotation delivered as a response", () => {
    expect(annotationResponseSchema.safeParse(annotation("box")).success).toBe(true);
  });

  it("accepts a mask annotation with a persisted raster and svg path", () => {
    expect(annotationResponseSchema.safeParse(annotation("mask")).success).toBe(true);
  });

  it("rejects degenerate boxes", () => {
    expect(
      annotationResponseSchema.safeParse({
        ...annotation("box"),
        coordinates: { x: 10, y: 20, width: 0, height: 4 },
      }).success,
    ).toBe(false);
  });

  it("rejects masks missing the encoded raster", () => {
    const { data: _dropped, ...withoutData } = MASK_COORDS;
    expect(
      annotationResponseSchema.safeParse({
        ...annotation("mask"),
        coordinates: withoutData,
      }).success,
    ).toBe(false);
  });
});

describe("segmentResponseSchema / listSegmentationsResponseSchema", () => {
  const run = {
    id: "9a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
    concept: "battery",
    status: "succeeded",
    model_id: "sam-3.1",
  };

  it("accepts a full segmentation response envelope", () => {
    expect(
      segmentResponseSchema.safeParse({
        annotations: [annotation("box"), annotation("mask")],
        runs: [run],
        concepts_used: ["battery"],
        warnings: [],
      }).success,
    ).toBe(true);
  });

  it("accepts a list response and a degraded mask read", () => {
    const degraded = { ...annotation("mask"), svg_path: null };
    const parsed = listSegmentationsResponseSchema.safeParse({
      image_width: 100,
      image_height: 80,
      annotations: [degraded],
    });
    expect(parsed.success).toBe(true);
  });
});
