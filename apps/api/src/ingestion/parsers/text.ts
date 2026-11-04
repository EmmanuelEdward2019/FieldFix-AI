import { IngestionError, type NormalizedSection, type ParseResult } from "../types.js";

/** Plain-text and Markdown: ATX / setext headings delimit sections. */

const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const SETEXT_UNDERLINE = /^(=+|-+)\s*$/;

export function parseText(bytes: Buffer): ParseResult {
  if (bytes.includes(0)) {
    throw new IngestionError(
      "parse_failed",
      "Text input contains NUL bytes; refusing to parse as text.",
    );
  }
  const text = bytes.toString("utf8");
  const lines = text.split(/\r?\n/);
  const sections: NormalizedSection[] = [];
  let heading: string | null = null;
  let current: string[] = [];

  const flush = (): void => {
    const content = current.join("\n").trim();
    if (content.length > 0) {
      sections.push({
        heading,
        pageNumber: null,
        content,
        stepOrder: null,
        safetyTags: [],
        componentTags: [],
        modelApplicability: [],
      });
    }
    current = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const atx = ATX_HEADING.exec(line.trim());
    if (atx?.[2]) {
      flush();
      heading = atx[2].trim().slice(0, 500);
      continue;
    }
    const next = lines[i + 1] ?? "";
    if (line.trim().length > 0 && SETEXT_UNDERLINE.test(next.trim())) {
      flush();
      heading = line.trim().slice(0, 500);
      i += 1;
      continue;
    }
    current.push(line);
  }
  flush();

  if (sections.length === 0) {
    throw new IngestionError("empty_document", "Text input has no readable content.");
  }
  return { format: "text", sections, pagesNeedingOcr: [], warnings: [] };
}
