/**
 * Minimal valid single-font PDF generator for tests. Produces real PDF
 * bytes (parsed by pdfjs-dist in the pipeline) without a writer
 * dependency. Pages are described as runs of { text, size } lines.
 */

export interface FixtureLine {
  text: string;
  /** Font size in points. Headings use a larger size. */
  size: number;
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function makePdf(pages: FixtureLine[][], options: { title?: string } = {}): Buffer {
  // Object numbering: 1 = catalog, 2 = pages, then per page: page, content.
  // Font object comes last.
  let nextId = 3;
  const contentIds: number[] = [];
  const pageIds: number[] = [];
  for (const _lines of pages) {
    pageIds.push(nextId);
    nextId += 1;
    contentIds.push(nextId);
    nextId += 1;
  }
  const fontId = nextId;
  nextId += 1;

  const header = Buffer.from("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n", "latin1");
  const parts: Buffer[] = [header];
  const offsets: number[] = [0];
  let position = header.length;

  const pushObject = (id: number, body: Buffer): void => {
    const head = Buffer.from(`${id} 0 obj\n`, "ascii");
    const tail = Buffer.from("\nendobj\n", "ascii");
    offsets[id] = position;
    parts.push(head, body, tail);
    position += head.length + body.length + tail.length;
  };

  pushObject(
    1,
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"),
  );
  pushObject(
    2,
    Buffer.from(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
      "ascii",
    ),
  );
  pages.forEach((lines, pageIndex) => {
    const pageId = pageIds[pageIndex] as number;
    const contentId = contentIds[pageIndex] as number;
    pushObject(
      pageId,
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
        "ascii",
      ),
    );
    let y = 750;
    const streamLines = ["BT"];
    for (const line of lines) {
      // Tm sets an absolute text matrix per line (Td would accumulate).
      streamLines.push(
        `/F1 ${line.size} Tf 1 0 0 1 72 ${y} Tm (${escapePdfText(line.text)}) Tj`,
      );
      y -= Math.round(line.size * 1.5);
    }
    streamLines.push("ET");
    const stream = Buffer.from(streamLines.join("\n"), "ascii");
    pushObject(
      contentId,
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "ascii"),
        stream,
        Buffer.from("\nendstream", "ascii"),
      ]),
    );
  });
  pushObject(
    fontId,
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "ascii"),
  );

  const xrefStart = position;
  const entryCount = nextId;
  let xref = `xref\n0 ${entryCount}\n0000000000 65535 f \n`;
  for (let id = 1; id < entryCount; id += 1) {
    xref += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  const trailerTitle = options.title ? ` /Title (${escapePdfText(options.title)})` : "";
  const trailer = `trailer\n<< /Size ${entryCount} /Root 1 0 R${trailerTitle} >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  parts.push(Buffer.from(xref + trailer, "ascii"));
  return Buffer.concat(parts);
}

/** A PDF page with an empty content stream (simulates a scanned page). */
export function makeBlankPagePdf(): Buffer {
  return makePdf([[]]);
}
