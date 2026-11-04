import PDFDocument from "pdfkit";
import type { ReportResponse } from "@fieldfix/contracts";

/**
 * Server-side repair-report PDF. Rendered deterministically from the
 * stored report snapshot — the same data as the JSON response, so the
 * PDF can never claim more than the durable state. Compression is off
 * and text is ASCII-folded so output stays greppable for tests and
 * simple tooling.
 */
function ascii(value: string): string {
  return value
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/•/g, "*")
    .replace(/[^\x20-\x7E]/g, "?");
}
export async function renderReportPdf(report: ReportResponse): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 56, compress: false });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", (err: unknown) =>
      reject(err instanceof Error ? err : new Error(String(err))),
    );
  });

  const data = report.report_data;
  const heading = (text: string): void => {
    doc.moveDown(0.8).fontSize(13).fillColor("#0f172a").text(text, { underline: true });
    doc.moveDown(0.3);
  };
  const body = (text: string): void => {
    doc.fontSize(10).fillColor("#1e293b").text(ascii(text));
  };
  const bullet = (text: string): void => {
    doc.fontSize(10).fillColor("#1e293b").text(`*  ${ascii(text)}`);
  };
  const empty = (text: string): void => {
    doc.font("Helvetica-Oblique").fontSize(10).fillColor("#64748b").text(ascii(text));
    doc.font("Helvetica");
  };

  doc.fontSize(20).fillColor("#0f172a").text("FieldFix AI - Repair Report");
  doc.fontSize(10).fillColor("#475569").text(ascii(`Session: ${report.session_id}`));
  doc.text(ascii(`Generated: ${report.created_at}`));
  doc.text(ascii(`Report: ${report.id} (${report.status})`));

  heading("Device & Symptoms");
  const device = data.device;
  body(
    [
      device.device_type,
      device.manufacturer ?? "unknown make",
      device.model ?? "unknown model",
      device.operating_system ?? "unknown OS",
    ].join(" · "),
  );
  body(`User-reported symptoms: ${data.symptoms}`);

  heading("Assessment");
  body(data.assessment ?? "No assessment composed for this snapshot.");

  heading("Provenance key");
  body("Observed: direct evidence / Model: AI inference / User: user-reported / Verified: technician-confirmed. Nothing below is a confirmed fault unless marked Verified.");

  heading("Observations");
  if (data.observable_facts.length === 0) {
    empty("No observations recorded.");
  }
  for (const fact of data.observable_facts) {
    bullet(fact);
  }

  heading("Hypotheses");
  if (data.hypotheses.length === 0) {
    empty("No hypotheses proposed.");
  }
  for (const h of data.hypotheses) {
    bullet(`${h.title} — ${h.status}, ${h.confidence_label} confidence`);
    const supporting = h.supporting_observations?.length ?? 0;
    const contradicting = h.contradicting_observations?.length ?? 0;
    doc
      .fontSize(9)
      .fillColor("#475569")
      .text(ascii(`      supporting: ${supporting}, contradicting: ${contradicting}`));
  }

  heading("Tests performed (user-reported)");
  if (data.tests_performed.length === 0) {
    empty("No tests performed yet.");
  }
  for (const t of data.tests_performed) {
    bullet(`${t.name}: ${t.result ?? "no result"}${t.observation ? ` — ${t.observation}` : ""}`);
  }

  heading("Technical references");
  if (data.sources.length === 0) {
    empty("No citations attached.");
  }
  for (const s of data.sources) {
    bullet(`${s.document_title}${s.page_number != null ? `, p. ${s.page_number}` : ""}`);
    doc.fontSize(9).fillColor("#475569").text(ascii(`      "${s.excerpt}"`));
  }

  heading("Safety");
  if (data.safety_summary.length === 0) {
    body("No safety events recorded.");
  }
  for (const s of data.safety_summary) {
    bullet(`${s.new_state} (${s.trigger_type})`);
  }

  heading("Recommended next steps");
  if (data.recommended_next_steps.length === 0) {
    empty("No further steps recommended.");
  }
  for (const step of data.recommended_next_steps) {
    bullet(step);
  }

  if (data.remaining_uncertainty.length > 0) {
    heading("Remaining uncertainty");
    for (const u of data.remaining_uncertainty) {
      bullet(u);
    }
  }

  if (data.timeline && data.timeline.length > 0) {
    heading("Session timeline");
    for (const entry of data.timeline) {
      doc
        .fontSize(9)
        .fillColor("#475569")
        .text(ascii(`${entry.created_at}  ${entry.event_type}`));
    }
  }

  doc.end();
  await done;
  return Buffer.concat(chunks);
}
