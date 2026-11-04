import { describe, expect, it } from "vitest";
import {
  createPartRecommendationSchema,
  createToolRecommendationSchema,
  listPartRecommendationsResponseSchema,
  listToolRecommendationsResponseSchema,
  partRecommendationResponseSchema,
  recommendationStatusSchema,
  toolRecommendationResponseSchema,
  updateRecommendationStatusSchema,
} from "../src/index.js";

const HYPOTHESIS_ID = "11111111-1111-4111-8111-111111111111";
const TEST_ID = "22222222-2222-4222-8222-222222222222";
const CHUNK_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date().toISOString();

describe("recommendationStatusSchema", () => {
  it("accepts the lifecycle states", () => {
    for (const status of ["proposed", "accepted", "dismissed"]) {
      expect(recommendationStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects unknown states", () => {
    expect(recommendationStatusSchema.safeParse("ordered").success).toBe(false);
  });
});

describe("createPartRecommendationSchema", () => {
  it("accepts a hypothesis-linked part with manual provenance", () => {
    const parsed = createPartRecommendationSchema.safeParse({
      hypothesis_id: HYPOTHESIS_ID,
      part_name: "AC adapter 65W",
      part_number: "AD-65W-19V",
      manufacturer: "Acme",
      model_compat: "FieldBook 14",
      chunk_id: CHUNK_ID,
      excerpt: "Replace with a 65W adapter.",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a test-linked part without provenance", () => {
    const parsed = createPartRecommendationSchema.safeParse({
      test_id: TEST_ID,
      part_name: "CMOS battery CR2032",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.part_number ?? null).toBeNull();
      expect(parsed.data.chunk_id ?? null).toBeNull();
    }
  });

  it("rejects zero or two links (exactly-one-of)", () => {
    expect(
      createPartRecommendationSchema.safeParse({ part_name: "Fan" }).success,
    ).toBe(false);
    expect(
      createPartRecommendationSchema.safeParse({
        hypothesis_id: HYPOTHESIS_ID,
        test_id: TEST_ID,
        part_name: "Fan",
      }).success,
    ).toBe(false);
  });

  it("rejects a chunk without an excerpt and vice versa", () => {
    expect(
      createPartRecommendationSchema.safeParse({
        hypothesis_id: HYPOTHESIS_ID,
        part_name: "Fan",
        chunk_id: CHUNK_ID,
      }).success,
    ).toBe(false);
    expect(
      createPartRecommendationSchema.safeParse({
        hypothesis_id: HYPOTHESIS_ID,
        part_name: "Fan",
        excerpt: "orphan excerpt",
      }).success,
    ).toBe(false);
  });

  it("rejects blank names and oversized fields", () => {
    expect(
      createPartRecommendationSchema.safeParse({
        hypothesis_id: HYPOTHESIS_ID,
        part_name: "  ",
      }).success,
    ).toBe(false);
    expect(
      createPartRecommendationSchema.safeParse({
        hypothesis_id: HYPOTHESIS_ID,
        part_name: "x".repeat(301),
      }).success,
    ).toBe(false);
  });

  it("has no price, stock, availability, or supplier fields", () => {
    const parsed = createPartRecommendationSchema.safeParse({
      hypothesis_id: HYPOTHESIS_ID,
      part_name: "Fan",
      price: 999,
      stock: 3,
      availability: "in_stock",
      supplier: "Acme Parts",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("price");
      expect(parsed.data).not.toHaveProperty("stock");
      expect(parsed.data).not.toHaveProperty("availability");
      expect(parsed.data).not.toHaveProperty("supplier");
    }
  });
});

describe("createToolRecommendationSchema", () => {
  it("accepts a tool with an optional test link and spec", () => {
    const parsed = createToolRecommendationSchema.safeParse({
      test_id: TEST_ID,
      tool_name: "Torx T5 screwdriver",
      spec: "Magnetic tip, ESD-safe handle",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an unlinked tool with manual provenance", () => {
    const parsed = createToolRecommendationSchema.safeParse({
      tool_name: "Spudger",
      chunk_id: CHUNK_ID,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects blank tool names", () => {
    expect(
      createToolRecommendationSchema.safeParse({ tool_name: "" }).success,
    ).toBe(false);
  });
});

describe("updateRecommendationStatusSchema", () => {
  it("accepts accept and dismiss only", () => {
    expect(
      updateRecommendationStatusSchema.safeParse({ status: "accepted" }).success,
    ).toBe(true);
    expect(
      updateRecommendationStatusSchema.safeParse({ status: "dismissed" })
        .success,
    ).toBe(true);
    expect(
      updateRecommendationStatusSchema.safeParse({ status: "proposed" })
        .success,
    ).toBe(false);
  });
});

describe("recommendation response schemas", () => {
  const part = {
    id: HYPOTHESIS_ID,
    session_id: TEST_ID,
    hypothesis_id: HYPOTHESIS_ID,
    test_id: null,
    part_name: "AC adapter 65W",
    part_number: null,
    manufacturer: null,
    model_compat: null,
    chunk_id: null,
    excerpt: null,
    status: "proposed",
    created_at: NOW,
  };
  const tool = {
    id: TEST_ID,
    session_id: TEST_ID,
    test_id: null,
    tool_name: "Spudger",
    spec: null,
    chunk_id: null,
    status: "proposed",
    created_at: NOW,
  };

  it("accepts single and list envelopes", () => {
    expect(
      partRecommendationResponseSchema.safeParse({ recommendation: part })
        .success,
    ).toBe(true);
    expect(
      listPartRecommendationsResponseSchema.safeParse({ recommendations: [part] })
        .success,
    ).toBe(true);
    expect(
      listPartRecommendationsResponseSchema.safeParse({ recommendations: [] })
        .success,
    ).toBe(true);
    expect(
      toolRecommendationResponseSchema.safeParse({ recommendation: tool })
        .success,
    ).toBe(true);
    expect(
      listToolRecommendationsResponseSchema.safeParse({ recommendations: [] })
        .success,
    ).toBe(true);
  });
});
