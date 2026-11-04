"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, FileText, Laptop, Monitor, RotateCcw, Smartphone } from "lucide-react";
import type { OwnedReport } from "@fieldfix/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError, fetchReportPdfApi, isAbortError, myReportsApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatRelativeTime } from "@/lib/format";
import { humanize } from "@/components/workstation/status-badges";
import { cn } from "@/lib/utils";

function DeviceIcon({ device, className }: { device: string; className?: string }) {
  const Icon = device === "smartphone" ? Smartphone : device === "desktop" ? Monitor : Laptop;
  return <Icon className={className} aria-hidden />;
}

export default function ReportsPage() {
  const { token } = useAuth();
  const [reports, setReports] = useState<OwnedReport[] | null>(null);
  const [query, setQuery] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!token) {
      return;
    }
    const controller = new AbortController();
    setError(null);
    void myReportsApi(token, controller.signal).then(
      (res) => setReports(res.reports),
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setError(describeApiError(err));
        }
      },
    );
    return () => controller.abort();
  }, [token, reload]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return reports ?? [];
    }
    return (reports ?? []).filter((r) =>
      [r.model, r.manufacturer, r.symptoms, r.device_type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [reports, query]);

  const download = (report: OwnedReport) => {
    if (!token || downloading) {
      return;
    }
    setDownloading(report.id);
    void fetchReportPdfApi(report.session_id, token).then(
      (blob) => {
        setDownloading(null);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `fieldfix-report-${report.session_id}.pdf`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      },
      (err: unknown) => {
        setDownloading(null);
        setError(describeApiError(err));
      },
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-50">Repair Reports</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          Compiled findings from your diagnoses, newest first.
        </p>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by device, model, or symptom…"
        aria-label="Search reports"
        className="w-full rounded-md border border-edge bg-panel px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
      />

      {error != null && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5" role="alert">
          <p className="text-sm text-slate-200">{error}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => setReload((n) => n + 1)}>
            <RotateCcw aria-hidden />
            Retry
          </Button>
        </div>
      )}

      {reports == null && error == null && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading reports">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}

      {reports != null && visible.length === 0 && (
        <div className="rounded-xl border border-dashed border-edge-strong p-6 text-center">
          <FileText className="mx-auto size-6 text-slate-500" aria-hidden />
          <p className="mt-2 text-sm text-slate-300">
            {query ? "No reports match your search." : "No reports yet."}
          </p>
          {!query && (
            <p className="mt-1 text-xs text-slate-500">
              Reports compile automatically as you diagnose — open any diagnosis to begin.
            </p>
          )}
        </div>
      )}

      {visible.length > 0 && (
        <ul className="flex flex-col gap-2" role="list">
          {visible.map((report) => (
            <li
              key={report.id}
              className={cn(
                "flex items-center gap-3 rounded-xl border border-edge bg-panel p-3",
              )}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-edge bg-canvas">
                <DeviceIcon device={report.device_type} className="size-5 text-slate-300" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-100">
                  {report.model ?? humanize(report.device_type)}
                  {report.manufacturer ? ` · ${report.manufacturer}` : ""}
                </span>
                <span className="block truncate text-xs text-slate-400">{report.symptoms}</span>
                <span className="mt-1 block text-[11px] text-slate-500">
                  {formatRelativeTime(report.created_at)} · {humanize(report.status)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <Badge variant={report.status === "ready" ? "success" : "default"}>
                  {humanize(report.status)}
                </Badge>
                <Button type="button" variant="secondary" size="sm" asChild>
                  <Link href={`/diagnostics/${report.session_id}`}>View</Link>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => download(report)}
                  disabled={downloading === report.id}
                  aria-label={`Download PDF for ${report.model ?? report.device_type}`}
                >
                  <Download aria-hidden />
                  <span className="hidden sm:inline">
                    {downloading === report.id ? "…" : "PDF"}
                  </span>
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
