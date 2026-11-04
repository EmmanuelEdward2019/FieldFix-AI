import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);

/**
 * OCR is used only for PDF pages with no usable text layer — never as
 * a first resort. Implementations render one page and recognize it.
 */
export interface OcrService {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  /**
   * Recognize a 1-based PDF page. Returns null when the page yields no
   * text; throws only on unexpected tool failures.
   */
  ocrPdfPage(pdfBytes: Buffer, pageNumber: number): Promise<string | null>;
}

const RENDER_TIMEOUT_MS = 60_000;
const RECOGNIZE_TIMEOUT_MS = 120_000;

/**
 * OCR via system tools: `pdftoppm` renders the page, `tesseract` reads
 * it. Reports unavailable when either binary is missing — the pipeline
 * then records pages_needing_ocr instead of failing silently.
 */
export class TesseractOcrService implements OcrService {
  readonly name = "tesseract-cli";
  private available: boolean | null = null;

  async isAvailable(): Promise<boolean> {
    if (this.available === null) {
      this.available = (await this.hasBinary("pdftoppm")) &&
        (await this.hasBinary("tesseract"));
    }
    return this.available;
  }

  async ocrPdfPage(pdfBytes: Buffer, pageNumber: number): Promise<string | null> {
    if (!(await this.isAvailable())) {
      return null;
    }
    const dir = await mkdtemp(path.join(tmpdir(), "fieldfix-ocr-"));
    try {
      const pdfPath = path.join(dir, "page.pdf");
      await writeFile(pdfPath, pdfBytes);
      const outPrefix = path.join(dir, "page");
      await runFile(
        "pdftoppm",
        ["-png", "-r", "200", "-f", String(pageNumber), "-l", String(pageNumber), pdfPath, outPrefix],
        { timeout: RENDER_TIMEOUT_MS },
      );
      const pngPath = `${outPrefix}-${pageNumber}.png`;
      const { stdout } = await runFile(
        "tesseract",
        [pngPath, "stdout", "--psm", "6", "-c", "tessedit_char_blacklist=|"],
        { timeout: RECOGNIZE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      );
      const text = stdout.trim();
      return text.length > 0 ? text : null;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async hasBinary(name: string): Promise<boolean> {
    try {
      await runFile(name, ["--version"], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }
}

/** Test double with scripted page text. */
export class FakeOcrService implements OcrService {
  readonly name = "fake-ocr";
  readonly calls: number[] = [];

  constructor(
    private readonly available: boolean,
    private readonly textByPage: Map<number, string> = new Map(),
  ) {}

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async ocrPdfPage(_pdfBytes: Buffer, pageNumber: number): Promise<string | null> {
    this.calls.push(pageNumber);
    return this.textByPage.get(pageNumber) ?? null;
  }
}
