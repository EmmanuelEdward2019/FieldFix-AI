"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CircleAlert,
  ClipboardList,
  FileText,
  FlaskConical,
  History,
  Laptop,
  Monitor,
  Plus,
  RotateCcw,
  ShieldAlert,
  Smartphone,
} from "lucide-react";
import type { ActivityItem, MySessionItem } from "@fieldfix/contracts";
import { ActivityChart } from "@/components/fx/activity-chart";
import { DeviceScene } from "@/components/fx/device-scene";
import {
  ContextualShortcuts,
  latestActiveSession,
  sessionDeviceLabel,
  type PartsHint,
} from "@/components/dashboard-shortcuts";
import { BadgeShelf } from "@/components/milestones";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  describeApiError,
  isAbortError,
  listPartRecommendationsApi,
  myActivityApi,
  myReportsApi,
  mySessionsApi,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatRelativeTime } from "@/lib/format";
import { humanize, safetyStateVariant } from "@/components/workstation/status-badges";

const DEVICE_CARDS = [
  { device: "laptop", icon: Laptop, title: "Laptops", hint: "Power · battery · display · heat" },
  { device: "desktop", icon: Monitor, title: "Desktops", hint: "PSU · GPU · boot faults" },
  { device: "smartphone", icon: Smartphone, title: "Phones", hint: "Screen · touch · cameras" },
] as const;

const QUICK_ACTIONS = [
  { href: "/diagnostics/new", icon: Plus, title: "New Diagnosis", hint: "Guided 4-step intake" },
  { href: "/reports", icon: FileText, title: "Repair Reports", hint: "Findings & downloads" },
  { href: "/knowledge", icon: BookOpen, title: "Knowledge Centre", hint: "Manuals & references" },
  { href: "/diagnostics", icon: History, title: "Diagnostic History", hint: "Every session" },
] as const;

const ACTIVITY_LABELS: Record<string, string> = {
  session_created: "Diagnosis started",
  evidence_uploaded: "Evidence uploaded",
  analysis_completed: "AI analysis completed",
  test_result_recorded: "Test result recorded",
  hypothesis_verified: "Hypothesis verified",
  safety_state_changed: "Safety state changed",
  report_ready: "Repair report ready",
};

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

export default function DashboardPage() {
  const { user, token } = useAuth();
  const [sessions, setSessions] = useState<MySessionItem[] | null>(null);
  const [reportCount, setReportCount] = useState<number | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [partsHint, setPartsHint] = useState<PartsHint | null>(null);
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
    void myReportsApi(token, controller.signal).then(
      (res) => setReportCount(res.reports.length),
      () => {
        /* reports stat stays hidden when the fetch fails */
      },
    );
    void myActivityApi(token, controller.signal).then(
      (res) => setActivity(res.activity),
      () => {
        /* activity section stays hidden when the fetch fails */
      },
    );
    return () => controller.abort();
  }, [token, reload]);

  useEffect(() => {
    if (!token || sessions == null) {
      return;
    }
    const latest = latestActiveSession(sessions);
    if (!latest) {
      setPartsHint(null);
      return;
    }
    const controller = new AbortController();
    void listPartRecommendationsApi(latest.id, token, controller.signal).then(
      (res) => {
        const accepted = res.recommendations.filter((r) => r.status === "accepted").length;
        setPartsHint(
          accepted > 0
            ? {
                sessionId: latest.id,
                deviceLabel: sessionDeviceLabel(latest),
                acceptedCount: accepted,
              }
            : null,
        );
      },
      () => {
        /* parts hint stays hidden when the fetch fails */
      },
    );
    return () => controller.abort();
  }, [token, sessions]);

  const active = sessions?.filter((s) => s.status === "open" || s.status === "in_progress") ?? [];
  const awaiting = sessions?.filter((s) => s.status === "awaiting_test") ?? [];
  const completed = sessions?.filter((s) => s.status === "completed") ?? [];
  const critical = sessions?.filter((s) => s.safety_state === "critical_stop") ?? [];

  const stats = [
    { icon: FlaskConical, label: "Active diagnoses", value: active.length, tone: "text-cyan-300", href: "/diagnostics?status=active" },
    { icon: ClipboardList, label: "Awaiting test results", value: awaiting.length, tone: "text-amber-300", href: "/diagnostics?status=awaiting_test" },
    { icon: CircleAlert, label: "Completed repairs", value: completed.length, tone: "text-emerald-300", href: "/diagnostics?status=completed" },
    { icon: FileText, label: "Repair reports", value: reportCount, tone: "text-cyan-300", href: "/reports" },
    { icon: ShieldAlert, label: "Critical alerts", value: critical.length, tone: "text-red-300", href: "/diagnostics?status=critical" },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">
            {user ? `Welcome back, ${user.name.split(" ")[0]}` : "Dashboard"}
          </h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Pick up a diagnosis or start a new one.
          </p>
        </div>
        <Button type="button" className="ml-auto" asChild>
          <Link href="/diagnostics/new">
            <Plus aria-hidden />
            New Diagnosis
          </Link>
        </Button>
      </div>

      {error != null && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5" role="alert">
          <p className="text-sm text-slate-200">Couldn&apos;t load your sessions: {error}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => setReload((n) => n + 1)}>
            <RotateCcw aria-hidden />
            Retry
          </Button>
        </div>
      )}

      {sessions == null && error == null ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" role="status" aria-label="Loading dashboard">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-5" role="list" aria-label="Summary">
          {stats.map(({ icon: Icon, label, value, tone, href }) => (
            <li key={label} className="rounded-xl border border-edge bg-panel p-4 transition-colors hover:border-cyan-400/40">
              <Link href={href} aria-label={`${label}: ${value ?? "—"}`}>
                <p className="flex items-center gap-2 text-xs text-slate-400">
                  <Icon className={`size-4 ${tone}`} aria-hidden />
                  {label}
                  {label === "Critical alerts" && (value ?? 0) > 0 && (
                    <span className="relative ml-auto flex size-2" aria-label="Active alerts">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
                      <span className="relative inline-flex size-2 rounded-full bg-red-400" />
                    </span>
                  )}
                </p>
                <p className="mt-1 text-3xl font-semibold text-slate-50">
                  {value ?? <span className="text-slate-600">—</span>}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {sessions != null && (
        <ContextualShortcuts sessions={sessions} reportCount={reportCount} partsHint={partsHint} />
      )}

      {user && <BadgeShelf scope={`user:${user.id}`} />}

      <section aria-labelledby="activity-title" className="rounded-xl border border-edge bg-panel p-4">
        <h2 id="activity-title" className="text-sm font-semibold text-slate-200">
          Your activity
        </h2>
        <div className="mt-2">
          <ActivityChart
            timestamps={(sessions ?? []).map((s) => s.created_at)}
            label="Diagnoses started per day"
          />
        </div>
      </section>

      <section aria-labelledby="actions-title">
        <h2 id="actions-title" className="text-sm font-semibold text-slate-200">
          Quick actions
        </h2>
        <ul className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4" role="list">
          {QUICK_ACTIONS.map(({ href, icon: Icon, title, hint }) => (
            <li key={href + title}>
              <Link
                href={href}
                className="flex items-center gap-3 rounded-xl border border-edge bg-panel p-3.5 transition-colors hover:border-cyan-400/40"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-cyan-400/25 bg-cyan-400/5">
                  <Icon className="size-5 text-cyan-300" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-100">{title}</span>
                  <span className="block truncate text-xs text-slate-400">{hint}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="devices-title">
        <h2 id="devices-title" className="text-sm font-semibold text-slate-200">
          Diagnose by device
        </h2>
        <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3" role="list">
          {DEVICE_CARDS.map(({ device, icon: Icon, title, hint }) => (
            <li key={device}>
              <Link
                href={`/diagnostics/new?device=${device}`}
                className="flex flex-col gap-2 rounded-xl border border-edge bg-panel p-3 transition-colors hover:border-cyan-400/40"
              >
                <DeviceScene device={device} scanning={false} />
                <span className="flex items-center gap-2 px-1 pb-1">
                  <Icon className="size-5 shrink-0 text-cyan-300" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-100">{title}</span>
                    <span className="block truncate text-xs text-slate-400">{hint}</span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-slate-500" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="recent-title">
        <div className="flex items-center gap-2">
          <h2 id="recent-title" className="text-sm font-semibold text-slate-200">
            Recent diagnoses
          </h2>
          <Link href="/diagnostics" className="ml-auto text-xs text-cyan-300 underline">
            View all
          </Link>
        </div>
        {sessions != null && sessions.length === 0 && (
          <div className="mt-2 rounded-xl border border-dashed border-edge-strong p-6 text-center">
            <p className="text-sm text-slate-300">No diagnoses yet.</p>
            <p className="mt-1 text-xs text-slate-500">
              Start your first diagnosis — it takes under a minute.
            </p>
            <Button type="button" size="sm" className="mt-3" asChild>
              <Link href="/diagnostics/new">
                <Plus aria-hidden />
                New Diagnosis
              </Link>
            </Button>
          </div>
        )}
        {sessions != null && sessions.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2" role="list">
            {sessions.slice(0, 5).map((session) => (
              <li key={session.id}>
                <Link
                  href={`/diagnostics/${session.id}`}
                  className="flex items-center gap-3 rounded-xl border border-edge bg-panel p-3 transition-colors hover:border-cyan-400/40"
                  aria-label={`${session.model ?? humanize(session.device_type)} — ${statusLabel(session.status)}, continue diagnosis`}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-edge bg-canvas">
                    <DeviceIcon device={session.device_type} className="size-5 text-slate-300" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-100">
                      {session.model ?? humanize(session.device_type)}
                      {session.manufacturer ? ` · ${session.manufacturer}` : ""}
                    </span>
                    <span className="block truncate text-xs text-slate-400">
                      {session.symptoms}
                    </span>
                    {session.test_count > 0 && (
                      <span className="mt-1.5 flex items-center gap-2">
                        <Progress
                          value={Math.round((100 * session.tests_recorded) / session.test_count)}
                          className="max-w-40"
                          aria-label={`${session.tests_recorded} of ${session.test_count} tests recorded`}
                        />
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {session.tests_recorded}/{session.test_count} tests
                        </span>
                      </span>
                    )}
                  </span>
                  <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                    {session.safety_state === "critical_stop" ? (
                      <Badge variant={safetyStateVariant(session.safety_state)}>
                        Critical stop
                      </Badge>
                    ) : (
                      <Badge variant="default">{statusLabel(session.status)}</Badge>
                    )}
                    <span className="text-[11px] text-slate-500">
                      {formatRelativeTime(session.updated_at)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-cyan-300">
                    Continue →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {activity != null && activity.length > 0 && (
        <section aria-labelledby="feed-title">
          <h2 id="feed-title" className="text-sm font-semibold text-slate-200">
            Recent activity
          </h2>
          <ul className="mt-2 flex flex-col gap-1.5" role="list">
            {activity.slice(0, 8).map((item) => (
              <li key={item.id}>
                <Link
                  href={`/diagnostics/${item.session_id}`}
                  className="flex items-center gap-2.5 rounded-lg border border-edge bg-panel px-3 py-2 text-xs transition-colors hover:border-cyan-400/40"
                >
                  <DeviceIcon device={item.device_type} className="size-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-slate-300">
                    <span className="font-medium text-slate-100">
                      {ACTIVITY_LABELS[item.event_type] ?? humanize(item.event_type)}
                    </span>
                    {" · "}
                    {item.model ?? humanize(item.device_type)}
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-500">
                    {formatRelativeTime(item.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
