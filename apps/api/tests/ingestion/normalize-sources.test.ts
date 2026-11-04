import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_CHUNK_CHARS,
  detectSafetyTags,
  sectionsToChunks,
} from "../../src/ingestion/normalize.js";
import {
  assertSourcePermitted,
  PERMITTED_SOURCES,
} from "../../src/ingestion/sources.js";
import { IngestionError, type NormalizedSection } from "../../src/ingestion/types.js";

function section(overrides: Partial<NormalizedSection> = {}): NormalizedSection {
  return {
    heading: "H",
    pageNumber: 7,
    content: "Some content.",
    stepOrder: null,
    safetyTags: [],
    componentTags: [],
    modelApplicability: [],
    ...overrides,
  };
}

describe("sectionsToChunks", () => {
  it("preserves heading, page, and tags on short sections", () => {
    const chunks = sectionsToChunks([
      section({
        componentTags: ["battery"],
        modelApplicability: ["Acme Phone 12"],
      }),
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      chunk_index: 0,
      heading: "H",
      page_number: 7,
      component_tags: ["battery"],
      model_applicability: ["Acme Phone 12"],
    });
  });

  it("falls back to document-level model applicability", () => {
    const chunks = sectionsToChunks([section()], {
      defaultModelApplicability: ["AcmeBook Pro 14"],
    });
    expect(chunks[0]?.model_applicability).toEqual(["AcmeBook Pro 14"]);
  });

  it("splits long sections on paragraph boundaries with part headings", () => {
    const para = "x".repeat(1500);
    const chunks = sectionsToChunks(
      [section({ content: `${para}\n\n${para}\n\n${para}` })],
      { maxChars: 2000 },
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.content.length <= 2000)).toBe(true);
    expect(chunks[0]?.heading).toBe("H (part 1/3)");
    expect(chunks.map((c) => c.chunk_index)).toEqual([0, 1, 2]);
    expect(chunks.every((c) => c.page_number === 7)).toBe(true);
  });

  it("respects the default chunk cap", () => {
    expect(DEFAULT_MAX_CHUNK_CHARS).toBeLessThanOrEqual(20000);
  });

  it("merges parser tags with detected safety tags", () => {
    const chunks = sectionsToChunks([
      section({
        content: "If the swollen battery hisses, stop.",
        safetyTags: ["custom"],
      }),
    ]);
    expect(chunks[0]?.safety_tags).toEqual(
      expect.arrayContaining(["custom", "battery", "swelling"]),
    );
  });
});

describe("detectSafetyTags", () => {
  it("tags hazard keywords and ignores benign text", () => {
    expect(detectSafetyTags("Unplug the high-voltage capacitor.")).toEqual(
      expect.arrayContaining(["high_voltage"]),
    );
    expect(detectSafetyTags("Liquid spilled near the charging port.")).toContain("liquid");
    expect(detectSafetyTags("Verify the adapter LED glows steadily.")).toEqual([]);
  });
});

describe("permitted sources", () => {
  it("lists exactly the PRD-approved sources", () => {
    expect(Object.keys(PERMITTED_SOURCES).sort()).toEqual([
      "admin_upload",
      "ifixit_api",
      "manufacturer_docs",
      "myfixit_dataset",
    ]);
  });

  it("refuses unknown sources", () => {
    expect(() => assertSourcePermitted("random-blog-scrape", {})).toThrowError(
      expect.objectContaining({ code: "source_not_permitted" }),
    );
  });

  it("gates licensed connectors behind exact licence acks", () => {
    expect(() => assertSourcePermitted("myfixit_dataset", {})).toThrowError(
      expect.objectContaining({ code: "source_disabled" }),
    );
    expect(() =>
      assertSourcePermitted("myfixit_dataset", { MYFIXIT_LICENCE_ACK: "whatever" }),
    ).toThrowError(IngestionError);
    expect(
      assertSourcePermitted("myfixit_dataset", {
        MYFIXIT_LICENCE_ACK: "CC-BY-NC-SA-3.0",
      }).licence,
    ).toBe("CC BY-NC-SA 3.0");
    expect(() => assertSourcePermitted("ifixit_api", {})).toThrowError(
      expect.objectContaining({ code: "source_disabled" }),
    );
    expect(
      assertSourcePermitted("ifixit_api", { IFIXIT_INGEST_ACK: "CC-BY-NC-SA-3.0" }).id,
    ).toBe("ifixit_api");
  });

  it("allows admin uploads and manufacturer docs without an ack", () => {
    expect(assertSourcePermitted("admin_upload", {}).id).toBe("admin_upload");
    expect(assertSourcePermitted("manufacturer_docs", {}).id).toBe("manufacturer_docs");
  });
});
