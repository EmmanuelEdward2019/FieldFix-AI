"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CircleAlert,
  ClipboardList,
  FlaskConical,
  Laptop,
  Monitor,
  ShieldAlert,
  Smartphone,
  Wrench,
} from "lucide-react";
import { DemoGate } from "@/components/demo-gate";
import { ActivityChart } from "@/components/fx/activity-chart";
import { BadgeShelf, MilestoneToasts } from "@/components/milestones";
import { PlatformName } from "@/components/platform-brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/lib/theme";
import { loadDemoSessions, type DemoSession } from "@/lib/demo-data";
import { formatRelativeTime } from "@/lib/format";
import { humanize, safetyStateVariant } from "@/components/workstation/status-badges";

const DEVICE_CARDS = [
  {
    device: "laptop",
    icon: Laptop,
    title: "Laptops",
    hint: "Power · battery · display · heat",
  },
  {
    device: "desktop",
    icon: Monitor,
    title: "Desktops",
    hint: "PSU · GPU · boot faults",
  },
  {
    device: "smartphone",
    icon: Smartphone,
    title: "Phones",
    hint: "Screen · touch · cameras",
  },
] as const;

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

/**
 * Guest dashboard: mirrors the signed-in dashboard layout so visitors
 * can evaluate the app before registering. Every number and job card
 * comes from the synthetic fixtures — nothing here touches the API.
 */
export default function DemoDashboardPage() {
  const [sessions, setSessions] = useState<DemoSession[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadDemoSessions().then(
      (res) => {
        if (!cancelled) {
          setSessions(res.sessions);
        }
      },
      () => {
        if (!cancelled) {
          setFailed(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const active = sessions?.filter((s) => s.status === "open" || s.status === "in_progress") ?? [];
  const awaiting = sessions?.filter((s) => s.status === "awaiting_test") ?? [];
  const completed = sessions?.filter((s) => s.status === "completed") ?? [];
  const critical = sessions?.filter((s) => s.safety_state === "critical_stop") ?? [];

  const stats = [
    { icon: FlaskConical, label: "Active diagnoses", value: active.length, tone: "text-cyan-300" },
    { icon: ClipboardList, label: "Awaiting test results", value: awaiting.length, tone: "text-amber-300" },
    { icon: CircleAlert, label: "Completed repairs", value: completed.length, tone: "text-emerald-300" },
    { icon: ShieldAlert, label: "Critical alerts", value: critical.length, tone: "text-red-300" },
  ];

  return (
    <DemoGate>
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-edge bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2.5 px-4 py-2.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="FieldFix AI home">
            <span className="flex size-8 items-center justify-center rounded-md border border-edge bg-panel">
              <Wrench className="size-4 text-cyan-300" aria-hidden />
            </span>
            <PlatformName className="text-sm font-semibold tracking-tight text-slate-50" />
          </Link>
          <Badge variant="warning">Demo</Badge>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Button type="button" variant="ghost" size="sm" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button type="button" size="sm" asChild>
              <Link href="/register">Create account</Link>
            </Button>
          </div>
        </div>
        <div className="border-t border-edge bg-panel px-4 py-1.5 sm:px-6">
          <p className="mx-auto w-full max-w-5xl text-xs text-slate-400">
            Guest preview ·{" "}
            <span className="font-medium text-slate-200">fictional sample data only</span> — try
            the workspace freely.{" "}
            <Link href="/register" className="text-cyan-300 underline">
              Create an account
            </Link>{" "}
            to diagnose real devices.
          </p>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">
              Explore the demo
              <Badge variant="warning">Sample data</Badge>
            </h1>
            <p className="mt-0.5 text-sm text-slate-400">
              The full technician dashboard, filled with fictional jobs. Open any job to see the
              diagnostic workspace.
            </p>
          </div>
          <Button type="button" className="ml-auto" asChild>
            <Link href="/register">
              Start diagnosing for real
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>

        {failed && (
          <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5 text-sm text-slate-200">
            The demo dataset failed to load. This is a fixture bug, not a backend state.
          </p>
        )}

        {sessions == null && !failed ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="status" aria-label="Loading demo dashboard">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : (
          sessions != null && (
            <>
              <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="list" aria-label="Summary">
                {stats.map(({ icon: Icon, label, value, tone }) => (
                  <li key={label} className="rounded-xl border border-edge bg-panel p-4">
                    <p className="flex items-center gap-2 text-xs text-slate-400">
                      <Icon className={`size-4 ${tone}`} aria-hidden />
                      {label}
                    </p>
                    <p className="mt-1 text-3xl font-semibold text-slate-50">{value}</p>
                  </li>
                ))}
              </ul>

              <BadgeShelf scope="guest" />

              <section
                aria-labelledby="demo-activity-title"
                className="rounded-xl border border-edge bg-panel p-4"
              >
                <h2 id="demo-activity-title" className="text-sm font-semibold text-slate-200">
                  Sample activity
                </h2>
                <div className="mt-2">
                  <ActivityChart
                    timestamps={sessions.map((s) => s.createdAt)}
                    label="Sample diagnoses per day"
                  />
                </div>
              </section>

              <section aria-labelledby="demo-devices-title">
                <h2 id="demo-devices-title" className="text-sm font-semibold text-slate-200">
                  Run a sample diagnosis
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Same guided steps as a real diagnosis — results are simulated.
                </p>
                <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3" role="list">
                  {DEVICE_CARDS.map(({ device, icon: Icon, title, hint }) => (
                    <li key={device}>
                      <Link
                        href={`/demo/new?device=${device}`}
                        className="flex items-center gap-3 rounded-xl border border-edge bg-panel p-4 transition-colors hover:border-cyan-400/40"
                      >
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-cyan-400/25 bg-cyan-400/5">
                          <Icon className="size-5 text-cyan-300" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-100">{title}</span>
                          <span className="block truncate text-xs text-slate-400">{hint}</span>
                        </span>
                        <ArrowRight className="size-4 shrink-0 text-slate-500" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-labelledby="demo-recent-title">
                <h2 id="demo-recent-title" className="text-sm font-semibold text-slate-200">
                  Sample diagnostic jobs
                </h2>
                <ul className="mt-2 flex flex-col gap-2" role="list">
                  {sessions.map((session) => (
                    <li key={session.id}>
                      <Link
                        href={`/demo/workspace?session=${session.id}`}
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
                          <span className="block truncate text-xs text-slate-400">
                            {session.symptoms}
                          </span>
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
                            {formatRelativeTime(session.updatedAt)}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-medium text-cyan-300">
                          Open →
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )
        )}
      </main>
      <MilestoneToasts />
    </div>
    </DemoGate>
  );
}
