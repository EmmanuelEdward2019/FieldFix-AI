"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CircleAlert,
  Laptop,
  Monitor,
  RotateCcw,
  Smartphone,
  Wrench,
} from "lucide-react";
import type { SessionDetailResponse } from "@fieldfix/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HealthStatus } from "@/components/health-status";
import { MilestoneToasts } from "@/components/milestones";
import type { ChecklistState } from "@/lib/checklist";
import { describeApiError, getSessionDetailApi } from "@/lib/api";
import { loadDemoSessions, type DemoSession } from "@/lib/demo-data";
import {
  SAMPLE_ANALYSIS_STEPS,
  applySampleAnalysis,
  loadGuestSessions,
  recordGuestResult,
  saveGuestSession,
} from "@/lib/demo-runner";
import { recordMilestone } from "@/lib/milestones";
import { toWorkstationSession } from "@/lib/real-session";
import { ThemeToggle } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { ActivityFeed } from "./activity-feed";
import { DashboardSkeleton } from "./dashboard-skeleton";
import type { DemoLoopActions } from "./demo-actions";
import { DemoReportCard } from "./demo-report";
import { DiagnosticChecklist } from "./diagnostic-checklist";
import { EvidenceCanvas } from "./evidence-canvas";
import { EvidenceUpload } from "./evidence-upload";
import { HypothesisPanel } from "./hypothesis-panel";
import { PartsPanel } from "./parts-panel";
import { ReferencePanel } from "./reference-panel";
import { ReportPanel } from "./report-panel";
import { SafetyStatus } from "./safety-status";
import { humanize } from "./status-badges";
import { VisualWorkspace } from "./visual-workspace";
import { VoicePanel } from "./voice-panel";

type DemoLoadState =
  | { status: "loading" }
  | { status: "ready"; sessions: DemoSession[] }
  | { status: "error"; message: string };

type DetailState =
  | { status: "idle" | "loading" }
  | { status: "ready"; detail: SessionDetailResponse }
  | { status: "error"; message: string };

export type DashboardShellProps =
  | { mode: "demo"; initialSessionId?: string; initialDevice?: string }
  | { mode: "live"; sessionId: string; token: string; milestoneScope?: string };

function DemoDeviceIcon({ device, className }: { device: string; className?: string }) {
  const Icon = device === "smartphone" ? Smartphone : device === "desktop" ? Monitor : Laptop;
  return <Icon className={className} aria-hidden />;
}

/**
 * Diagnostic workspace in two strictly separated modes. Demo mode shows
 * synthetic fixture sessions only and can never touch the API (except
 * the health probe); live mode shows one owned API session inside the
 * authenticated app layout (which provides its own chrome).
 */
export function DashboardShell(props: DashboardShellProps) {
  const router = useRouter();
  const [loadState, setLoadState] = useState<DemoLoadState>({ status: "loading" });
  const [sessionId, setSessionId] = useState<string | null>(
    props.mode === "live" ? props.sessionId : null,
  );
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [captures, setCaptures] = useState<Record<string, ChecklistState>>({});
  const [detail, setDetail] = useState<DetailState>({ status: "idle" });
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [guestIds, setGuestIds] = useState<Set<string>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState(0);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const demoTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const knownEvidenceIds = useRef<{ seeded: boolean; ids: Set<string> }>({
    seeded: false,
    ids: new Set(),
  });

  const isLive = props.mode === "live";
  const liveToken = props.mode === "live" ? props.token : null;
  const liveScope = props.mode === "live" ? (props.milestoneScope ?? null) : null;

  const demoInitialSessionId = props.mode === "demo" ? (props.initialSessionId ?? null) : null;
  const demoInitialDevice = props.mode === "demo" ? (props.initialDevice ?? null) : null;

  useEffect(
    () => () => {
      for (const timer of demoTimers.current) {
        clearTimeout(timer);
      }
    },
    [],
  );

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const { sessions } = await loadDemoSessions();
      const guests = loadGuestSessions();
      const guestIdSet = new Set(guests.map((g) => g.id));
      setGuestIds(guestIdSet);
      // Guest runs first; a guest-edited fixture shadows its original.
      const merged = [...guests, ...sessions.filter((s) => !guestIdSet.has(s.id))];
      setLoadState({ status: "ready", sessions: merged });
      setSessionId((current) => {
        if (current) {
          return current;
        }
        const byId = demoInitialSessionId
          ? sessions.find((s) => s.id === demoInitialSessionId)?.id
          : undefined;
        if (byId) {
          return byId;
        }
        const byDevice = demoInitialDevice
          ? sessions.find((s) => s.device_type === demoInitialDevice)?.id
          : undefined;
        return byDevice ?? sessions[0]?.id ?? null;
      });
    } catch (err) {
      setLoadState({
        status: "error",
        message: err instanceof Error ? err.message : "Unknown load failure.",
      });
    }
  }, [demoInitialSessionId, demoInitialDevice]);

  useEffect(() => {
    if (!isLive) {
      void load();
    }
  }, [isLive, load]);

  // Fetch live detail whenever the live session is active or refreshed.
  useEffect(() => {
    if (!isLive || !liveToken || sessionId == null) {
      return;
    }
    const controller = new AbortController();
    setDetail({ status: "loading" });
    void getSessionDetailApi(sessionId, liveToken, controller.signal).then(
      (fetched) => setDetail({ status: "ready", detail: fetched }),
      (err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setDetail({ status: "error", message: describeApiError(err) });
      },
    );
    return () => controller.abort();
  }, [isLive, liveToken, sessionId, refreshCounter]);

  const updateCapture = useCallback(
    (testId: string, state: ChecklistState) => {
      setCaptures((current) => ({ ...current, [testId]: state }));
    },
    [],
  );

  const selectSession = useCallback((id: string) => {
    setSessionId(id);
    setSelectedFileId(null);
    setActiveTestId(null);
    knownEvidenceIds.current = { seeded: false, ids: new Set() };
  }, []);

  const mutateDemoSession = useCallback(
    (id: string, mutate: (session: DemoSession) => DemoSession) => {
      setLoadState((prev) => {
        if (prev.status !== "ready") {
          return prev;
        }
        return {
          ...prev,
          sessions: prev.sessions.map((s) => (s.id === id ? mutate(s) : s)),
        };
      });
    },
    [],
  );

  const runSampleAnalysis = useCallback(() => {
    if (isLive || analyzing || sessionId == null) {
      return;
    }
    setAnalyzing(true);
    setAnalysisStep(0);
    const total = SAMPLE_ANALYSIS_STEPS.length;
    for (let i = 1; i <= total; i++) {
      demoTimers.current.push(
        setTimeout(() => {
          setAnalysisStep(i);
          if (i === total) {
            setAnalyzing(false);
            mutateDemoSession(sessionId, (s) => {
              const updated = applySampleAnalysis(s);
              if (updated !== s) {
                saveGuestSession(updated);
                setGuestIds((prev) => new Set(prev).add(updated.id));
                recordMilestone("guest", "analysis_run");
              }
              return updated;
            });
          }
        }, i * 650),
      );
    }
  }, [isLive, analyzing, sessionId, mutateDemoSession]);

  const recordDemoResult = useCallback(
    (testId: string, option: string, observation: string) => {
      if (isLive || recordingId != null || sessionId == null) {
        return;
      }
      setRecordingId(testId);
      demoTimers.current.push(
        setTimeout(() => {
          setRecordingId(null);
          mutateDemoSession(sessionId, (s) => {
            const updated = recordGuestResult(s, testId, option, observation.trim() || null);
            saveGuestSession(updated);
            setGuestIds((prev) => new Set(prev).add(updated.id));
            recordMilestone("guest", "result_recorded");
            if (updated.status === "completed") {
              recordMilestone("guest", "all_tests_done");
            }
            return updated;
          });
        }, 800),
      );
    },
    [isLive, recordingId, sessionId, mutateDemoSession],
  );

  // Derived before the early returns: hooks below must run on every
  // render, including the loading skeletons.
  const demoSessions = !isLive && loadState.status === "ready" ? loadState.sessions : [];
  const demoSession =
    demoSessions.find((s) => s.id === sessionId) ?? demoSessions[0];
  const liveSession =
    isLive && detail.status === "ready"
      ? toWorkstationSession(detail.detail)
      : null;
  const session = isLive ? liveSession : (demoSession ?? null);
  const evidenceSignature = session?.evidence.map((f) => f.id).join(",") ?? "";

  // New uploads select themselves: when a refresh introduces unseen
  // evidence ids, the newest upload becomes the viewed file. The first
  // load only seeds the set so the default view is unchanged.
  useEffect(() => {
    if (session == null) {
      return;
    }
    const known = knownEvidenceIds.current;
    if (!known.seeded) {
      known.seeded = true;
      known.ids = new Set(session.evidence.map((f) => f.id));
      return;
    }
    const fresh = session.evidence.filter((f) => !known.ids.has(f.id));
    known.ids = new Set(session.evidence.map((f) => f.id));
    if (fresh.length === 0) {
      return;
    }
    const newest = [...fresh].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    )[0];
    if (newest) {
      setSelectedFileId(newest.id);
    }
  }, [session, evidenceSignature]);

  if (!isLive && loadState.status === "loading") {
    return <DashboardSkeleton />;
  }

  if (!isLive && loadState.status === "error") {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-3 p-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-red-400/10">
          <CircleAlert className="size-6 text-red-300" aria-hidden />
        </span>
        <h1 className="text-lg font-semibold text-slate-100">
          The demo workstation failed to load
        </h1>
        <p className="text-sm text-slate-400" role="alert">
          {loadState.message}
        </p>
        <Button type="button" onClick={() => void load()}>
          <RotateCcw aria-hidden />
          Retry
        </Button>
      </div>
    );
  }

  const mainContent = (() => {
    if (isLive && (detail.status === "loading" || detail.status === "idle")) {
      return <DashboardSkeleton />;
    }
    if (isLive && detail.status === "error") {
      return (
        <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-3 p-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-red-400/10">
            <CircleAlert className="size-6 text-red-300" aria-hidden />
          </span>
          <h1 className="text-lg font-semibold text-slate-100">
            Couldn&apos;t load this live session
          </h1>
          <p className="text-sm text-slate-400" role="alert">
            {detail.message}
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={() => setRefreshCounter((n) => n + 1)}>
              <RotateCcw aria-hidden />
              Retry
            </Button>
            <Button type="button" variant="secondary" onClick={() => router.push("/diagnostics")}>
              Back to diagnostics
            </Button>
          </div>
        </div>
      );
    }
    if (session == null) {
      return (
        <div className="mx-auto w-full max-w-xl p-6 text-center">
          <h1 className="text-lg font-semibold text-slate-100">
            No demo sessions available
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            The demo dataset came back empty. This is a fixture bug, not a
            backend state.
          </p>
        </div>
      );
    }
    const refresh = () => setRefreshCounter((n) => n + 1);
    const liveActions =
      isLive && liveToken
        ? { sessionId: session.id, token: liveToken, onChanged: refresh }
        : undefined;
    const demoLoop: DemoLoopActions | undefined = !isLive
      ? {
          analyzing,
          analysisStep,
          runSampleAnalysis,
          recordResult: recordDemoResult,
          recordingId,
          safetyBlocked:
            session.safety_state === "critical_stop" ||
            session.safety_state === "review_required",
        }
      : undefined;
    const panels = {
      safety: <SafetyStatus session={session} live={liveActions} />,
      canvas: (
        <EvidenceCanvas
          files={session.evidence}
          observations={session.observations}
          deviceType={session.device_type}
          selectedFileId={selectedFileId}
          onSelectFile={setSelectedFileId}
          showAnnotations={showAnnotations}
          onToggleAnnotations={() => setShowAnnotations((v) => !v)}
          live={
            isLive && liveToken
              ? { sessionId: session.id, token: liveToken }
              : undefined
          }
          uploadSlot={
            isLive && liveToken ? (
              <EvidenceUpload
                sessionId={session.id}
                token={liveToken}
                onUploaded={() => {
                  if (liveScope) {
                    recordMilestone(liveScope, "evidence_added");
                  }
                  setRefreshCounter((n) => n + 1);
                }}
              />
            ) : undefined
          }
        />
      ),
      hypotheses: (
        <HypothesisPanel
          hypotheses={session.hypotheses}
          live={
            liveActions
              ? {
                  ...liveActions,
                  safetyBlocked: session.safety_state === "critical_stop",
                  userMode: session.user_mode,
                }
              : undefined
          }
          demo={demoLoop}
          deviceType={session.device_type}
          milestoneScope={isLive ? (liveScope ?? undefined) : "guest"}
        />
      ),
      checklist: (
        <DiagnosticChecklist
          tests={session.tests}
          safetyBlocked={session.safety_state === "critical_stop"}
          activeTestId={activeTestId}
          onSelectTest={setActiveTestId}
          captures={captures}
          onCaptureChange={updateCapture}
          live={liveActions}
        />
      ),
      refs: <ReferencePanel citations={session.citations} live={isLive} />,
      activity: (
        <ActivityFeed events={session.events} modelRuns={session.model_runs} live={isLive} />
      ),
      report:
        liveActions != null ? (
          <ReportPanel
            sessionId={liveActions.sessionId}
            token={liveActions.token}
            milestoneScope={liveScope ?? undefined}
          />
        ) : (
          <DemoReportCard session={session} />
        ),
      voice:
        liveActions != null ? (
          <VoicePanel session={session} live={liveActions} compact />
        ) : (
          <VoicePanel session={session} compact />
        ),
      parts: <PartsPanel live={liveActions} />,
    };
    return (
      <VisualWorkspace
        session={session}
        isLive={isLive}
        nextLive={liveActions}
        demoNext={demoLoop}
        milestoneScope={isLive ? (liveScope ?? undefined) : "guest"}
        panels={panels}
        demoPicker={
          !isLive ? (
            <nav aria-label="Demo sessions">
              <ul className="flex gap-2 overflow-x-auto pb-1" role="list">
                {demoSessions.map((demo) => {
                  const active = demo.id === session.id;
                  const yours = guestIds.has(demo.id);
                  return (
                    <li key={demo.id} className="shrink-0">
                      <button
                        type="button"
                        onClick={() => selectSession(demo.id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                          active
                            ? "border-cyan-400/50 bg-cyan-400/10 text-slate-50"
                            : "border-edge bg-panel text-slate-300 hover:border-edge-strong",
                        )}
                      >
                        <DemoDeviceIcon device={demo.device_type} className="size-4" />
                        {demo.model ?? humanize(demo.device_type)}
                        {yours && (
                          <span className="rounded-full bg-cyan-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-200">
                            You
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ) : undefined
        }
      />
    );
  })();

  if (isLive) {
    // The authenticated app layout provides navigation chrome.
    return (
      <main id="workstation-main" aria-label="Diagnostic workspace">
        {mainContent}
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <a
        href="#workstation-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-cyan-400 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-slate-950"
      >
        Skip to diagnostic workspace
      </a>

      <header className="sticky top-0 z-40 border-b border-edge bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[100rem] items-center gap-3 px-4 py-2.5 sm:px-6">
          <Link
            href="/demo"
            className="flex items-center gap-2.5"
            aria-label="Back to demo home"
          >
            <span className="flex size-8 items-center justify-center rounded-md border border-edge bg-panel">
              <Wrench className="size-4 text-cyan-300" aria-hidden />
            </span>
            <span className="text-sm font-semibold tracking-tight text-slate-50">
              FieldFix AI
            </span>
            <Badge variant="warning">Demo</Badge>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <div className="mr-1 hidden items-center gap-2 md:flex">
              <HealthStatus />
            </div>
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
          <p className="mx-auto w-full max-w-[100rem] text-xs text-slate-400">
            Restricted demo workspace ·{" "}
            <span className="font-medium text-slate-200">
              fictional demo data only
            </span>{" "}
            — no live sessions, uploads, or AI calls here.{" "}
            <Link href="/register" className="text-cyan-300 underline">
              Create an account
            </Link>{" "}
            to diagnose real devices.
          </p>
        </div>
      </header>

      <main id="workstation-main" aria-label="Diagnostic workspace">
        {mainContent}
      </main>
      <MilestoneToasts />
    </div>
  );
}
