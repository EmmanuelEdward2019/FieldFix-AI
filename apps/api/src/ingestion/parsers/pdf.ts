import { IngestionError, type NormalizedSection, type ParseResult } from "../types.js";
import type { OcrService } from "../ocr.js";

/**
 * Text-based PDF ingestion via pdfjs-dist: per-page text with page
 * numbers, plus a font-size heading heuristic. Pages with negligible
 * extractable text are flagged for OCR instead of being guessed at.
 */

const MAX_PAGES = 500;
const MIN_TEXT_CHARS_PER_PAGE = 30;
const MAX_HEADING_CHARS = 120;
const HEADING_SIZE_RATIO = 1.25;

interface TextLine {
  height: number;
  text: string;
}

function isTextItem(value: unknown): value is {
  str: string;
  transform: [number, number, number, number, number, number];
  height: number;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.str === "string" &&
    Array.isArray(item.transform) &&
    item.transform.length === 6 &&
    typeof item.transform[4] === "number" &&
    typeof item.height === "number"
  );
}

/**
 * Body-text size: the most common line height (body dominates real
 * pages), tie-broken toward the smallest. A median misfires on short
 * pages by landing on the heading itself.
 */
function bodySizeOf(heights: number[]): number {
  if (heights.length === 0) {
    return 0;
  }
  const counts = new Map<number, number>();
  for (const h of heights) {
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  let best = heights[0] as number;
  for (const [h, n] of counts) {
    const bestN = counts.get(best) as number;
    if (n > bestN || (n === bestN && h < best)) {
      best = h;
    }
  }
  return best;
}

export interface PdfParseOptions {
  ocr?: OcrService;
}

export async function parsePdf(
  bytes: Buffer,
  options: PdfParseOptions = {},
): Promise<ParseResult & { ocrPagesFilled: number[] }> {
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new IngestionError("parse_failed", "Bytes do not look like a PDF (%PDF- header missing).");
  }
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let doc;
  try {
    doc = await getDocument({
      data: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      useSystemFonts: true,
    }).promise;
  } catch (err) {
    throw new IngestionError(
      "parse_failed",
      `PDF could not be opened: ${err instanceof Error ? err.message : "invalid"}.`,
    );
  }
  try {
    const pageCount = doc.numPages as number;
    if (pageCount > MAX_PAGES) {
      throw new IngestionError("parse_failed", `PDF has ${pageCount} pages; capped at ${MAX_PAGES}.`);
    }
    const sections: NormalizedSection[] = [];
    const warnings: string[] = [];
    const pagesNeedingOcr: number[] = [];
    const ocrPagesFilled: number[] = [];
    let emptySections = 0;

    let heading: string | null = null;
    let sectionStartPage: number | null = null;
    let current: string[] = [];
    const flush = (): void => {
      const content = current.join("\n").trim();
      if (content.length > 0 && sectionStartPage !== null) {
        sections.push({
          heading,
          pageNumber: sectionStartPage,
          content,
          stepOrder: null,
          safetyTags: [],
          componentTags: [],
          modelApplicability: [],
        });
      } else if (content.length === 0 && heading !== null) {
        emptySections += 1;
      }
      current = [];
    };

    for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
      const page = await doc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const items = (textContent.items as unknown[]).filter(isTextItem);
      const pageChars = items.map((i) => i.str).join("").trim().length;

      if (pageChars < MIN_TEXT_CHARS_PER_PAGE) {
        pagesNeedingOcr.push(pageNum);
        const ocrText = await tryOcr(options.ocr, bytes, pageNum, warnings);
        if (ocrText) {
          ocrPagesFilled.push(pageNum);
          flush();
          heading = null;
          sectionStartPage = pageNum;
          current = [ocrText];
          flush();
          heading = null;
          sectionStartPage = null;
        }
        continue;
      }

      // Group items into lines by baseline Y, then sort top-to-bottom.
      const buckets = new Map<number, typeof items>();
      for (const item of items) {
        // transform is [a,b,c,d,e,f]: f (index 5) is the Y baseline.
        const y = Math.round((item.transform[5] as number) / 2) * 2;
        const bucket = buckets.get(y) ?? [];
        bucket.push(item);
        buckets.set(y, bucket);
      }
      const lines: TextLine[] = [...buckets.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, bucket]) => {
          // transform is [a,b,c,d,e,f]: e (index 4) is the X offset.
          const ordered = bucket.sort(
            (a, b) => (a.transform[4] as number) - (b.transform[4] as number),
          );
          return {
            height: Math.max(...ordered.map((i) => i.height)),
            text: ordered.map((i) => i.str).join("").trim(),
          };
        })
        .filter((line) => line.text.length > 0);

      const bodySize = bodySizeOf(lines.map((l) => l.height));
      for (const line of lines) {
        const looksHeaded =
          bodySize > 0 &&
          line.height >= bodySize * HEADING_SIZE_RATIO &&
          line.text.length <= MAX_HEADING_CHARS;
        if (looksHeaded) {
          flush();
          heading = line.text;
          sectionStartPage = pageNum;
        } else {
          if (sectionStartPage === null) {
            sectionStartPage = pageNum;
          }
          current.push(line.text);
        }
      }
    }
    flush();

    if (emptySections > 0) {
      warnings.push(`${emptySections} heading(s) with no body text skipped.`);
    }
    if (sections.length === 0) {
      if (pagesNeedingOcr.length > 0) {
        throw new IngestionError(
          "empty_document",
          `PDF has no extractable text (pages needing OCR: ${pagesNeedingOcr.join(", ")}).`,
        );
      }
      throw new IngestionError("empty_document", "PDF has no readable content.");
    }
    return {
      format: "pdf",
      sections,
      pagesNeedingOcr,
      warnings,
      ocrPagesFilled,
    };
  } finally {
    const destroyable = doc as unknown as { destroy?: () => unknown };
    await destroyable.destroy?.();
  }
}

async function tryOcr(
  ocr: OcrService | undefined,
  pdfBytes: Buffer,
  pageNumber: number,
  warnings: string[],
): Promise<string | null> {
  if (!ocr) {
    warnings.push(`page ${pageNumber}: no text layer and no OCR service configured.`);
    return null;
  }
  if (!(await ocr.isAvailable())) {
    warnings.push(`page ${pageNumber}: no text layer and OCR is unavailable.`);
    return null;
  }
  try {
    const text = await ocr.ocrPdfPage(pdfBytes, pageNumber);
    if (!text || text.trim().length === 0) {
      warnings.push(`page ${pageNumber}: OCR returned no text.`);
      return null;
    }
    return text.trim();
  } catch (err) {
    warnings.push(
      `page ${pageNumber}: OCR failed (${err instanceof Error ? err.message : "error"}).`,
    );
    return null;
  }
}
