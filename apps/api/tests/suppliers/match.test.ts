import { describe, expect, it } from "vitest";
import {
  normalizePartNumber,
  normalizeTerm,
  outboundSearchUrl,
  scoreProduct,
} from "../../src/suppliers/match.js";

describe("normalizeTerm", () => {
  it("lowercases, strips punctuation, drops stopwords and single letters", () => {
    expect(normalizeTerm("Laptop Battery — Replacement (Original)!")).toEqual([
      "laptop",
      "battery",
    ]);
  });

  it("returns no terms for pure noise", () => {
    expect(normalizeTerm("The & new part!")).toEqual([]);
  });
});

describe("normalizePartNumber", () => {
  it("folds case and punctuation", () => {
    expect(normalizePartNumber("AB-123/X")).toBe("ab123x");
  });
});

describe("scoreProduct", () => {
  it("prefers exact part-number matches", () => {
    const score = scoreProduct("Laptop battery", "AB-123", {
      name: "Something unrelated",
      part_number: "ab123",
    });
    expect(score).toMatchObject({ kind: "part_number", score: 1 });
  });

  it("scores keyword overlap as a fraction of recommendation terms", () => {
    const score = scoreProduct("HP laptop charger 65W", null, {
      name: "HP Laptop Charger 65W 45W Smart Blue Tip Power Adapter",
      part_number: null,
    });
    expect(score?.kind).toBe("keywords");
    expect(score?.score).toBe(1);
    expect(score?.matchedTerms).toEqual(
      expect.arrayContaining(["hp", "laptop", "charger", "65w"]),
    );
  });

  it("rejects weak overlap below the 0.5 threshold", () => {
    const score = scoreProduct("laptop battery charger adapter", null, {
      name: "Laptop stand",
      part_number: null,
    });
    expect(score).toBeNull();
  });

  it("rejects empty-term recommendations", () => {
    const score = scoreProduct("The new part", null, {
      name: "The new part",
      part_number: null,
    });
    expect(score).toBeNull();
  });
});

describe("outboundSearchUrl", () => {
  it("fills and encodes the template query", () => {
    expect(outboundSearchUrl("https://shop.example/catalog/?q={q}", "https://shop.example", "laptop battery & charger")).toBe(
      "https://shop.example/catalog/?q=laptop%20battery%20%26%20charger",
    );
  });

  it("falls back to the website without a template", () => {
    expect(outboundSearchUrl(null, "https://shop.example/products", "x")).toBe(
      "https://shop.example/products",
    );
  });
});
