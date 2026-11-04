import { describe, expect, it } from "vitest";
import type { ReportResponse } from "@fieldfix/contracts";
import { renderReportPdf } from "../../src/reports/pdf.js";

const REPORT: ReportResponse = {
  id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  session_id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
  status: "ready",
  report_data: {
    device: {
      device_type: "laptop",
      manufacturer: "Acme",
      model: "AcmeBook Pro 14",
      operating_system: null,
    },
    symptoms: "Will not power on.",
    evidence_ids: [],
    observable_facts: ["user_reported: Loud fan reported."],
    hypotheses: [
      {
        id: "cccccccc-3333-4333-8333-cccccccccccc",
        title: "Failing battery",
        status: "proposed",
        confidence_label: "medium",
        supporting_observations: [
          { kind: "observation", id: null, note: "Swelling visible" },
        ],
        contradicting_observations: [],
      },
    ],
    tests_performed: [
      {
        test_id: "dddddddd-4444-4444-8444-dddddddddddd",
        name: "Charger swap",
        result: "option_1",
        observation: "No change.",
        source: "user_reported",
      },
    ],
    sources: [
      {
        citation_id: "eeeeeeee-5555-4555-8555-eeeeeeeeeeee",
        document_title: "Acme Service Manual",
        page_number: 12,
        excerpt: "Check the battery connector.",
      },
    ],
    remaining_uncertainty: ["Failing battery — candidate, medium confidence"],
    recommended_next_steps: ["Perform test: Charger swap"],
    safety_summary: [],
    assessment: "Session covers a laptop (1 hypotheses, 1 of 1 tests performed). No fault has been independently verified.",
    timeline: [
      { event_type: "session_created", created_at: "2026-10-31T00:00:00.000Z" },
      { event_type: "analysis_completed", created_at: "2026-10-31T00:01:00.000Z" },
    ],
  },
  error_message: null,
  created_at: "2026-10-31T00:02:00.000Z",
  updated_at: "2026-10-31T00:02:00.000Z",
};

/**
 * Decode every hex text run in the content stream. pdfkit emits kerned
 * TJ arrays (`[<4869> 10 <21>]`), so contiguous copy only exists after
 * decoding — this mirrors what a PDF reader shows.
 */
export function extractPdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const parts: string[] = [];
  for (const match of raw.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    parts.push(Buffer.from(match[1] ?? "", "hex").toString("latin1"));
  }
  return parts.join("");
}

describe("renderReportPdf", () => {
  it("renders a readable PDF carrying the snapshot content", async () => {
    const pdf = await renderReportPdf(REPORT);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const text = extractPdfText(pdf);
    for (const expected of [
      "FieldFix",
      REPORT.session_id,
      "Will not power on",
      "Failing battery",
      "Charger swap",
      "Acme Service Manual",
      "No fault has been independently verified",
      "session_created",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("never marks an unverified hypothesis as verified", async () => {
    const pdf = await renderReportPdf(REPORT);
    const text = extractPdfText(pdf);
    expect(text).not.toMatch(/Failing battery.{0,40}verified/i);
  });
});
