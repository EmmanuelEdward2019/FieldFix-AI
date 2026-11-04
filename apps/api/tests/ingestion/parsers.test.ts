import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../../src/ingestion/parsers/csv.js";
import { parseJson } from "../../src/ingestion/parsers/json.js";
import { parsePdf } from "../../src/ingestion/parsers/pdf.js";
import { parseText } from "../../src/ingestion/parsers/text.js";
import { FakeOcrService } from "../../src/ingestion/ocr.js";
import { IngestionError } from "../../src/ingestion/types.js";
import { makePdf, makeBlankPagePdf } from "./pdf-fixture.js";

const FIXTURES = path.join(__dirname, "fixtures");
const load = (name: string): Buffer => readFileSync(path.join(FIXTURES, name));

describe("text parser", () => {
  it("splits markdown on headings", () => {
    const parsed = parseText(load("sample.md"));
    expect(parsed.format).toBe("text");
    expect(parsed.sections.map((s) => s.heading)).toEqual([
      "Acme Field Troubleshooting Notes",
      "No power",
      "Swollen battery",
    ]);
    expect(parsed.sections[1]?.content).toContain("AC adapter LED");
    expect(parsed.sections.every((s) => s.pageNumber === null)).toBe(true);
  });

  it("rejects empty and binary input", () => {
    expect(() => parseText(Buffer.from("   \n  "))).toThrowError(
      expect.objectContaining({ code: "empty_document" }),
    );
    expect(() => parseText(Buffer.from([0x41, 0x00, 0x42]))).toThrowError(IngestionError);
  });
});

describe("json parser", () => {
  it("maps MyFixit records to step sections with parts and models", () => {
    const parsed = parseJson(load("sample-myfixit.json"));
    expect(parsed.format).toBe("myfixit_json");
    expect(parsed.sections).toHaveLength(3);
    expect(parsed.sections[0]?.heading).toContain("Step 1");
    expect(parsed.sections[0]?.content).toContain("disconnect the AC adapter");
    expect(parsed.sections[0]?.stepOrder).toBe(1);
    expect(parsed.sections[0]?.componentTags).toContain("battery");
    expect(parsed.sections[0]?.modelApplicability).toContain("AcmeBook Pro 14");
    expect(parsed.warnings).toEqual([]);
  });

  it("reads newline-delimited JSON and skips invalid records with warnings", () => {
    const parsed = parseJson(load("sample-myfixit.jsonl"));
    expect(parsed.format).toBe("myfixit_json");
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toContain("record 2 skipped");
  });

  it("accepts generic { sections[] } documents with pages and tags", () => {
    const parsed = parseJson(load("sample-generic.json"));
    expect(parsed.format).toBe("generic_json");
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0]).toMatchObject({
      heading: "No power",
      pageNumber: 4,
      componentTags: ["AC adapter"],
      modelApplicability: ["AcmeBook Pro 14"],
    });
  });

  it("rejects malformed and shapeless JSON", () => {
    expect(() => parseJson(Buffer.from("{oops"))).toThrowError(
      expect.objectContaining({ code: "parse_failed" }),
    );
    expect(() => parseJson(Buffer.from('{"a":1}'))).toThrowError(
      expect.objectContaining({ code: "parse_failed" }),
    );
    expect(() => parseJson(Buffer.from("[]"))).toThrowError(IngestionError);
  });
});

describe("csv parser", () => {
  it("maps synonym headers and skips empty rows with a warning", () => {
    const parsed = parseCsv(load("sample.csv"));
    expect(parsed.format).toBe("csv");
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0]).toMatchObject({
      heading: "No power",
      pageNumber: 4,
      modelApplicability: ["AcmeBook Pro 14"],
      componentTags: ["AC adapter"],
    });
    expect(parsed.sections[1]?.safetyTags).toEqual(["battery"]);
    expect(parsed.warnings).toEqual(["1 empty row(s) skipped."]);
  });

  it("requires a content column", () => {
    expect(() => parseCsv(Buffer.from("a,b\n1,2\n"))).toThrowError(
      expect.objectContaining({ code: "parse_failed" }),
    );
    expect(() => parseCsv(Buffer.from("text\n"))).toThrowError(
      expect.objectContaining({ code: "empty_document" }),
    );
  });
});

describe("pdf parser", () => {
  function twoPagePdf(): Buffer {
    return makePdf([
      [
        { text: "Power Troubleshooting", size: 20 },
        { text: "Verify the AC adapter LED glows steadily.", size: 11 },
        { text: "A dark LED points to the adapter or cable.", size: 11 },
      ],
      [
        { text: "Battery Safety", size: 20 },
        { text: "If the battery is deformed, stop immediately.", size: 11 },
      ],
    ]);
  }

  it("extracts per-page text with font-size headings", async () => {
    const parsed = await parsePdf(twoPagePdf());
    expect(parsed.format).toBe("pdf");
    expect(parsed.pagesNeedingOcr).toEqual([]);
    expect(parsed.sections.map((s) => s.heading)).toEqual([
      "Power Troubleshooting",
      "Battery Safety",
    ]);
    expect(parsed.sections[0]?.pageNumber).toBe(1);
    expect(parsed.sections[0]?.content).toContain("AC adapter LED");
    expect(parsed.sections[1]?.pageNumber).toBe(2);
  });

  it("flags blank pages for OCR and only OCRs those pages", async () => {
    const mixed = makePdf([
      [{ text: "Real text layer with enough characters to pass the threshold.", size: 11 }],
      [],
    ]);
    const parsed = await parsePdf(mixed);
    expect(parsed.pagesNeedingOcr).toEqual([2]);
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.warnings.join(" ")).toContain("page 2");

    const ocr = new FakeOcrService(true, new Map([[1, "Scanned line one. Scanned line two."]]));
    const filled = await parsePdf(makeBlankPagePdf(), { ocr });
    expect(filled.ocrPagesFilled).toEqual([1]);
    expect(filled.sections).toHaveLength(1);
    expect(filled.sections[0]?.content).toBe("Scanned line one. Scanned line two.");
    expect(filled.sections[0]?.pageNumber).toBe(1);

    // A page with a text layer never triggers OCR.
    const ocr2 = new FakeOcrService(true);
    await parsePdf(twoPagePdf(), { ocr: ocr2 });
    expect(ocr2.calls).toEqual([]);
  });

  it("reports all-scanned PDFs as empty with the OCR page list", async () => {
    const err = await parsePdf(makeBlankPagePdf()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "empty_document" });
    expect((err as Error).message).toContain("pages needing OCR: 1");
  });

  it("rejects non-PDF bytes and corrupt PDFs", async () => {
    await expect(parsePdf(Buffer.from("definitely not a pdf"))).rejects.toMatchObject({
      code: "parse_failed",
    });
    await expect(
      parsePdf(Buffer.from("%PDF-1.4\ntrailing garbage without objects")),
    ).rejects.toMatchObject({ code: "parse_failed" });
  });
});
