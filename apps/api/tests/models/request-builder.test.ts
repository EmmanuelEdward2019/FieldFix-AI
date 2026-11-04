import { describe, expect, it } from "vitest";
import type { ReasoningContext } from "@fieldfix/contracts";
import {
  DEFAULT_BUILDER_LIMITS,
  ModelRequestBuilder,
} from "../../src/models/meta/request-builder.js";
import { ModelError } from "../../src/models/types.js";

const DOC_ID = "11111111-1111-4111-8111-111111111111";

function context(overrides: Partial<ReasoningContext> = {}): ReasoningContext {
  return {
    device_category: "laptop",
    device_type: "laptop",
    manufacturer: "Acme",
    model: "Book 14",
    operating_system: "FieldOS 3.2",
    symptoms: "Laptop overheats and shuts down under load.",
    observations: [],
    test_history: [],
    current_hypotheses: [],
    doc_excerpts: [],
    safety: { state: "normal", restrictions: [] },
    stage: "initial_assessment",
    question: "What is the most likely cause of the overheating?",
    ...overrides,
  };
}

function sectionHeadings(built: { prompt: { textSections: Array<{ heading: string }> } }): string[] {
  return built.prompt.textSections.map((s) => s.heading);
}

describe("ModelRequestBuilder", () => {
  it("builds a full device-agnostic prompt for laptop overheating", () => {
    const builder = new ModelRequestBuilder();
    const built = builder.build(
      {
        context: context({
          observations: [{ source: "user", body: "Fan is loud." }],
          test_history: [
            { name: "Vent inspection", result: "dusty", observation: "Vents clogged." },
          ],
          current_hypotheses: [
            { title: "Dust-clogged heatsink", status: "proposed", confidence: "medium" },
          ],
          doc_excerpts: [
            { document_id: DOC_ID, title: "Service manual", page: 12, excerpt: "Clean vents." },
          ],
          safety: { state: "caution", restrictions: ["Let the unit cool first."] },
        }),
        evidence: [],
      },
      { effort: "medium", maxOutputTokens: 4000 },
    );

    expect(sectionHeadings(built)).toEqual([
      "Device",
      "Reported symptoms",
      "Evidence",
      "Prior observations",
      "Test history",
      "Current hypotheses",
      "Document excerpts (untrusted reference data)",
      "Safety",
      "Diagnostic stage and question",
    ]);
    const byHeading = Object.fromEntries(
      built.prompt.textSections.map((s) => [s.heading, s.body]),
    );
    expect(byHeading.Device).toContain("Category: laptop");
    expect(byHeading.Device).toContain("Manufacturer: Acme");
    expect(byHeading["Reported symptoms"]).toContain("overheats");
    expect(byHeading["Prior observations"]).toContain("[user] Fan is loud.");
    expect(byHeading["Test history"]).toContain("Vent inspection — result: dusty");
    expect(byHeading["Current hypotheses"]).toContain("Dust-clogged heatsink");
    expect(byHeading["Document excerpts (untrusted reference data)"]).toContain(
      `id=${DOC_ID}`,
    );
    expect(byHeading.Safety).toContain("State: caution");
    expect(byHeading["Diagnostic stage and question"]).toContain("Stage: initial_assessment");
    expect(built.prompt.effort).toBe("medium");
    expect(built.prompt.jsonSchema.strict).toBe(true);
    expect(built.prompt.instructions).toContain("Never present an inferred fault as confirmed");
    expect(built.skipped).toEqual([]);
  });

  it("serves desktop and smartphone contexts through the same interface", () => {
    const builder = new ModelRequestBuilder();
    for (const category of ["desktop", "smartphone"] as const) {
      const built = builder.build(
        {
          context: context({
            device_category: category,
            device_type: category === "desktop" ? "desktop" : "smartphone",
            symptoms: category === "desktop" ? "No POST beeps." : "Touch dead spots.",
            question: "What should I check next?",
          }),
          evidence: [],
        },
        { effort: "low", maxOutputTokens: 1000 },
      );
      const device = built.prompt.textSections.find((s) => s.heading === "Device")?.body ?? "";
      expect(device).toContain(`Category: ${category}`);
      expect(built.prompt.images).toEqual([]);
    }
  });

  it("attaches supported images and skips video with reasons", () => {
    const builder = new ModelRequestBuilder();
    const built = builder.build(
      {
        context: context(),
        evidence: [
          { fileId: "img-1", mediaType: "image/jpeg", bytes: Buffer.from([1, 2]) },
          { fileId: "vid-1", mediaType: "video/mp4", bytes: Buffer.from([3, 4]) },
        ],
      },
      { effort: "medium", maxOutputTokens: 4000 },
    );
    expect(built.prompt.images).toHaveLength(1);
    expect(built.prompt.images[0]).toMatchObject({
      mediaType: "image/jpeg",
      evidenceFileId: "img-1",
    });
    expect(built.skipped).toEqual([
      { fileId: "vid-1", reason: expect.stringContaining("unsupported modality") },
    ]);
    const evidence = built.prompt.textSections.find((s) => s.heading === "Evidence")?.body ?? "";
    expect(evidence).toContain("1 image(s) attached");
    expect(evidence).toContain("1 file(s) skipped");
  });

  it("enforces per-image and per-request caps", () => {
    const builder = new ModelRequestBuilder({
      ...DEFAULT_BUILDER_LIMITS,
      maxImages: 1,
      maxImageBytes: 4,
    });
    const built = builder.build(
      {
        context: context(),
        evidence: [
          { fileId: "ok", mediaType: "image/png", bytes: Buffer.alloc(4) },
          { fileId: "big", mediaType: "image/png", bytes: Buffer.alloc(5) },
          { fileId: "extra", mediaType: "image/png", bytes: Buffer.alloc(2) },
        ],
      },
      { effort: "medium", maxOutputTokens: 4000 },
    );
    expect(built.prompt.images.map((i) => i.evidenceFileId)).toEqual(["ok"]);
    expect(built.skipped.map((s) => s.fileId).sort()).toEqual(["big", "extra"]);
  });

  it("truncates long excerpts and rejects contexts over the text budget", () => {
    const truncated = new ModelRequestBuilder({
      ...DEFAULT_BUILDER_LIMITS,
      maxExcerptChars: 10,
    }).build(
      {
        context: context({
          doc_excerpts: [
            { document_id: DOC_ID, title: "Manual", excerpt: "x".repeat(100) },
          ],
        }),
        evidence: [],
      },
      { effort: "medium", maxOutputTokens: 4000 },
    );
    const excerpts =
      truncated.prompt.textSections.find(
        (s) => s.heading === "Document excerpts (untrusted reference data)",
      )?.body ?? "";
    expect(excerpts).toContain("…[truncated]");

    const tiny = new ModelRequestBuilder({ ...DEFAULT_BUILDER_LIMITS, maxTotalTextChars: 50 });
    expect(() =>
      tiny.build({ context: context(), evidence: [] }, { effort: "medium", maxOutputTokens: 1 }),
    ).toThrowError(ModelError);
    try {
      tiny.build({ context: context(), evidence: [] }, { effort: "medium", maxOutputTokens: 1 });
      expect.unreachable();
    } catch (err) {
      expect(err as ModelError).toMatchObject({ category: "invalid_request" });
    }
  });

  it("rejects invalid diagnostic context before building", () => {
    const builder = new ModelRequestBuilder();
    const bad = context({ symptoms: "" });
    try {
      builder.build({ context: bad, evidence: [] }, { effort: "medium", maxOutputTokens: 1 });
      expect.unreachable();
    } catch (err) {
      expect(err as ModelError).toMatchObject({ category: "invalid_request" });
      expect((err as ModelError).message).toContain("symptoms");
    }
  });
});
