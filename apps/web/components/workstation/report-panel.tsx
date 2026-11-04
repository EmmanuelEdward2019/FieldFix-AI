"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpen, Brain, ClipboardCheck, Download, Eye, FileText, Mail, RotateCcw } from "lucide-react";
import type { ReportResponse } from "@fieldfix/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError, emailReportCopyApi, fetchReportPdfApi, getReportApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { recordMilestone } from "@/lib/milestones";
import { EmptyState } from "./empty-state";
import { humanize, hypothesisStatusVariant } from "./status-badges";

type ReportState =
  | { status: "loading" }
  | { status: "ready"; report: ReportResponse }
  | { status: "error"; message: string };

/**
 * Live repair-report viewer. Compiles the current snapshot on open,
 * renders every section, and downloads the same snapshot as PDF.
 * Demo sessions keep their placeholder report text instead.
 */
export function ReportPanel({
  sessionId,
  token,
  milestoneScope,
}: {
  sessionId: string;
  token: string;
  milestoneScope?: string;
}) {
  const [state, setState] = useState<ReportState>({ status: "loading" });
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [emailing, setEmailing] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  const { token: userToken } = useAuth();

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void getReportApi(sessionId, token, controller.signal).then(
      (report) => {
        setState({ status: "ready", report });
        if (report.status === "ready" && milestoneScope) {
          recordMilestone(milestoneScope, "report_ready");
        }
      },
      (err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({ status: "error", message: describeApiError(err) });
      },
    );
    return () => controller.abort();
  }, [sessionId, token, reload, milestoneScope]);

  const download = useCallback(() => {
    if (downloading) {
      return;
    }
    setDownloading(true);
    setDownloadError(null);
    void fetchReportPdfApi(sessionId, token).then(
      (blob) => {
        setDownloading(false);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `fieldfix-report-${sessionId}.pdf`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      },
      (err: unknown) => {
        setDownloading(false);
        setDownloadError(describeApiError(err));
      },
    );
  }, [sessionId, token, downloading]);

  const emailCopy = useCallback(() => {
    if (emailing || !userToken) {
      return;
    }
    setEmailing(true);
    setEmailStatus(null);
    void emailReportCopyApi(sessionId, userToken).then(
      () => {
        setEmailing(false);
        setEmailStatus({ ok: true, message: "Report sent to your email." });
      },
      (err: unknown) => {
        setEmailing(false);
        setEmailStatus({ ok: false, message: describeApiError(err) });
      },
    );
  }, [sessionId, userToken, emailing]);

  return (
    <Card aria-labelledby="report-title">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle id="report-title">Repair report</CardTitle>
          <p className="mt-0.5 text-xs text-slate-400">
            Compiled from stored session state — observations, inferences,
            user reports, and verified findings stay labelled.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="default">Live</Badge>
          {state.status === "ready" && userToken && (
            <Button type="button" variant="secondary" size="sm" onClick={emailCopy} disabled={emailing}>
              <Mail aria-hidden />
              {emailing ? "Sending…" : "Email me a copy"}
            </Button>
          )}
          {state.status === "ready" && (
            <Button type="button" variant="secondary" size="sm" onClick={download} disabled={downloading}>
              <Download aria-hidden />
              {downloading ? "Preparing…" : "PDF"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {state.status === "loading" && (
          <div className="flex flex-col gap-2" role="status" aria-label="Loading report">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}
        {state.status === "error" && (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-sm text-red-300">
              Report failed: {state.message}
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={() => setReload((n) => n + 1)}>
              <RotateCcw aria-hidden />
              Retry
            </Button>
          </div>
        )}
        {state.status === "ready" && <ReportBody report={state.report} />}
        {downloadError != null && (
          <p role="alert" className="mt-2 text-xs text-red-300">
            PDF download failed: {downloadError}
          </p>
        )}
        {emailStatus != null &&
          (emailStatus.ok ? (
            <p role="status" className="mt-2 text-xs text-emerald-300">
              {emailStatus.message}
            </p>
          ) : (
            <p role="alert" className="mt-2 text-xs text-red-300">
              Email failed: {emailStatus.message}
            </p>
          ))}
      </CardContent>
    </Card>
  );
}

function ProvenanceChip({
  icon: Icon,
  count,
  label,
}: {
  icon: typeof Eye;
  count: number;
  label: string;
}) {
  return (
    <li className="flex items-center gap-1.5 rounded-md border border-edge bg-canvas px-2.5 py-1.5 text-xs text-slate-200">
      <Icon className="size-4 text-cyan-300" aria-hidden />
      <strong className="font-semibold tabular-nums">{count}</strong>
      <span className="text-slate-400">{label}</span>
    </li>
  );
}

export function ReportBody({ report }: { report: ReportResponse }) {
  const data = report.report_data;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="grid grid-cols-1 gap-2 text-xs text-slate-400 sm:grid-cols-2">
        <p>
          <span className="font-semibold tracking-wider uppercase">Device: </span>
          <span className="text-slate-200">
            {[data.device.device_type, data.device.manufacturer, data.device.model]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </p>
        <p>
          <span className="font-semibold tracking-wider uppercase">Generated: </span>
          <span className="text-slate-200">{formatDateTime(report.created_at)}</span>
        </p>
      </div>

      <div>
        <ul aria-label="Evidence and provenance" className="flex flex-wrap gap-1.5" role="list">
          <ProvenanceChip icon={Eye} count={data.observable_facts.length} label="observations" />
          <ProvenanceChip icon={Brain} count={data.hypotheses.length} label="hypotheses" />
          <ProvenanceChip icon={ClipboardCheck} count={data.tests_performed.length} label="tests performed" />
          <ProvenanceChip icon={BookOpen} count={data.sources.length} label="references" />
        </ul>
        <p className="mt-1.5 text-xs text-slate-500">
          Provenance at a glance — every figure comes from stored session state,
          detailed in the sections below.
        </p>
      </div>

      <section aria-label="Reported symptoms">
        <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
          User-reported symptoms
        </h3>
        <p className="mt-1 text-slate-200">{data.symptoms}</p>
      </section>

      {data.assessment != null && (
        <section aria-label="Assessment">
          <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
            Assessment
          </h3>
          <p className="mt-1 rounded-md border border-edge bg-canvas px-3 py-2 text-slate-200">
            {data.assessment}
          </p>
        </section>
      )}

      <section aria-label="Observations">
        <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
          Observations ({data.observable_facts.length})
        </h3>
        {data.observable_facts.length === 0 ? (
          <EmptyState icon={FileText} title="No observations" hint="Nothing recorded yet." />
        ) : (
          <ul className="mt-1 flex flex-col gap-1" role="list">
            {data.observable_facts.map((fact, i) => (
              <li key={i} className="text-slate-200">
                · {fact}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Hypotheses">
        <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
          Hypotheses ({data.hypotheses.length})
        </h3>
        {data.hypotheses.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">None proposed.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-2" role="list">
            {data.hypotheses.map((h) => (
              <li key={h.id} className="rounded-md border border-edge bg-canvas px-3 py-2">
                <p className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={hypothesisStatusVariant(h.status)}>
                    {humanize(h.status)}
                  </Badge>
                  <span className="font-medium text-slate-100">{h.title}</span>
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {h.confidence_label} confidence ·{" "}
                  {h.supporting_observations?.length ?? 0} supporting ·{" "}
                  {h.contradicting_observations?.length ?? 0} contradicting
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Tests performed">
        <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
          Tests performed ({data.tests_performed.length})
        </h3>
        {data.tests_performed.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">No tests performed yet.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1" role="list">
            {data.tests_performed.map((t) => (
              <li key={t.test_id} className="text-slate-200">
                · {t.name}: {t.result ?? "no result"}{" "}
                <span className="text-xs text-slate-500">(user-reported)</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="References">
        <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
          Technical references ({data.sources.length})
        </h3>
        {data.sources.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">No citations attached.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1" role="list">
            {data.sources.map((s) => (
              <li key={s.citation_id} className="text-xs text-slate-300">
                · {s.document_title}
                {s.page_number != null ? `, p. ${s.page_number}` : ""} — “
                {s.excerpt}”
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Next steps">
        <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
          Recommended next steps
        </h3>
        {data.recommended_next_steps.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">None recommended.</p>
        ) : (
          <ol className="mt-1 flex list-decimal flex-col gap-1 pl-5" role="list">
            {data.recommended_next_steps.map((step, i) => (
              <li key={i} className="text-slate-200">
                {step}
              </li>
            ))}
          </ol>
        )}
      </section>

      {data.safety_summary.length > 0 && (
        <section aria-label="Safety">
          <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
            Safety
          </h3>
          <ul className="mt-1 flex flex-col gap-1" role="list">
            {data.safety_summary.map((s) => (
              <li key={s.id} className="text-xs text-amber-200">
                · {humanize(s.new_state)} ({humanize(s.trigger_type)})
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
