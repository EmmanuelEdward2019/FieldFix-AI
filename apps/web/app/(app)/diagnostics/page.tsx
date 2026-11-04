"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Laptop, Monitor, Plus, RotateCcw, Smartphone } from "lucide-react";
import type { MySessionItem } from "@fieldfix/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError, isAbortError, mySessionsApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatRelativeTime } from "@/lib/format";
import { humanize } from "@/components/workstation/status-badges";
import { cn } from "@/lib/utils";

type DeviceFilter = "all" | "laptop" | "desktop" | "smartphone";
type StatusFilter = "all" | "active" | "awaiting_test" | "completed" | "critical";

const DEVICE_FILTERS: Array<{ value: DeviceFilter; label: string }> = [
  { value: "all", label: "All devices" },
  { value: "laptop", label: "Laptops" },
  { value: "desktop", label: "Desktops" },
  { value: "smartphone", label: "Phones" },
];

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "awaiting_test", label: "Awaiting test" },
  { value: "completed", label: "Completed" },
  { value: "critical", label: "Critical stops" },
];

function matchesStatus(session: MySessionItem, filter: StatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return session.status === "open" || session.status === "in_progress";
    case "awaiting_test":
      return session.status === "awaiting_test";
    case "completed":
      return session.status === "completed";
    case "critical":
      return session.safety_state === "critical_stop";
  }
}

function DeviceIcon({ device, className }: { device: string; className?: string }) {
  const Icon = device === "smartphone" ? Smartphone : device === "desktop" ? Monitor : Laptop;
  return <Icon className={className} aria-hidden />;
}

function statusLabel(status: string): string {
  switch (status) {
    case "awaiting_test":
      return "Awaiting test";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Completed";
    case "archived":
      return "Archived";
    default:
      return "Open";
  }
}

function DiagnosticsBody({ initialStatus }: { initialStatus: StatusFilter }) {
  const { token } = useAuth();
  const [sessions, setSessions] = useState<MySessionItem[] | null>(null);
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!token) {
      return;
    }
    const controller = new AbortController();
    setError(null);
    void mySessionsApi(token, controller.signal).then(
      (res) => setSessions(res.sessions),
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setError(describeApiError(err));
        }
      },
    );
    return () => controller.abort();
  }, [token, reload]);

  const visible = (sessions ?? []).filter(
    (s) =>
      (deviceFilter === "all" || s.device_type === deviceFilter) &&
      matchesStatus(s, statusFilter),
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50">Diagnostics</h1>
          <p className="mt-0.5 text-sm text-slate-400">Every diagnosis you own, newest first.</p>
        </div>
        <Button type="button" className="ml-auto" asChild>
          <Link href="/diagnostics/new">
            <Plus aria-hidden />
            New Diagnosis
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by device">
        {DEVICE_FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setDeviceFilter(value)}
            aria-pressed={deviceFilter === value}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs transition-colors",
              deviceFilter === value
                ? "border-cyan-400/50 bg-cyan-400/10 font-medium text-cyan-200"
                : "border-edge text-slate-300 hover:border-edge-strong",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatusFilter(value)}
            aria-pressed={statusFilter === value}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs transition-colors",
              statusFilter === value
                ? "border-cyan-400/50 bg-cyan-400/10 font-medium text-cyan-200"
                : "border-edge text-slate-300 hover:border-edge-strong",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {error != null && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5" role="alert">
          <p className="text-sm text-slate-200">Couldn&apos;t load diagnoses: {error}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => setReload((n) => n + 1)}>
            <RotateCcw aria-hidden />
            Retry
          </Button>
        </div>
      )}

      {sessions == null && error == null && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading diagnoses">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}

      {sessions != null && visible.length === 0 && (
        <div className="rounded-xl border border-dashed border-edge-strong p-6 text-center">
          <p className="text-sm text-slate-300">
            {deviceFilter === "all" && statusFilter === "all"
              ? "No diagnoses yet."
              : "Nothing matches these filters yet."}
          </p>
          <Button type="button" size="sm" className="mt-3" asChild>
            <Link href="/diagnostics/new">
              <Plus aria-hidden />
              New Diagnosis
            </Link>
          </Button>
        </div>
      )}

      {visible.length > 0 && (
        <ul className="flex flex-col gap-2" role="list">
          {visible.map((session) => (
            <li key={session.id}>
              <Link
                href={`/diagnostics/${session.id}`}
                className="flex items-center gap-3 rounded-xl border border-edge bg-panel p-3 transition-colors hover:border-cyan-400/40"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-edge bg-canvas">
                  <DeviceIcon device={session.device_type} className="size-5 text-slate-300" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-100">
                    {session.model ?? humanize(session.device_type)}
                    {session.manufacturer ? ` · ${session.manufacturer}` : ""}
                  </span>
                  <span className="block truncate text-xs text-slate-400">{session.symptoms}</span>
                  <span className="mt-1 block text-[11px] text-slate-500">
                    {formatRelativeTime(session.updated_at)}
                    {session.test_count > 0 &&
                      ` · ${session.tests_recorded}/${session.test_count} tests`}
                    {session.evidence_count > 0 &&
                      ` · ${session.evidence_count} file${session.evidence_count === 1 ? "" : "s"}`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {session.safety_state === "critical_stop" ? (
                    <Badge variant="danger">Critical stop</Badge>
                  ) : session.safety_state !== "normal" ? (
                    <Badge variant="warning">{humanize(session.safety_state)}</Badge>
                  ) : (
                    <Badge variant="default">{statusLabel(session.status)}</Badge>
                  )}
                  <span className="hidden text-xs font-medium text-cyan-300 sm:inline">
                    Continue →
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DiagnosticsFromQuery() {
  const params = useSearchParams();
  const raw = params.get("status");
  const initialStatus: StatusFilter =
    raw === "active" ||
    raw === "awaiting_test" ||
    raw === "completed" ||
    raw === "critical"
      ? raw
      : "all";
  return <DiagnosticsBody initialStatus={initialStatus} />;
}

export default function DiagnosticsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 p-4 sm:p-6" role="status" aria-label="Loading diagnoses">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      }
    >
      <DiagnosticsFromQuery />
    </Suspense>
  );
}
