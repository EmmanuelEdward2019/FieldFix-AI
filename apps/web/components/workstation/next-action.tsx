"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Brain, ClipboardCheck, TriangleAlert, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  analyzeSessionApi,
  describeApiError,
  recordTestResultApi,
} from "@/lib/api";
import type { DemoSession, DemoTest } from "@/lib/demo-data";
import { SAMPLE_ANALYSIS_STEPS } from "@/lib/demo-runner";
import { recordMilestone } from "@/lib/milestones";
import { cn } from "@/lib/utils";
import { AnalysisLoader } from "../fx/analysis-loader";
import { SafetyScene } from "../fx/safety-scene";
import type { DemoLoopActions } from "./demo-actions";
import {
  humanize,
  safetyClassificationVariant,
  skillLabel,
} from "./status-badges";

export interface NextActionLive {
  sessionId: string;
  token: string;
  onChanged: () => void;
}

interface NextActionProps {
  session: DemoSession;
  live?: NextActionLive;
  /** Guest-mode loop (tab-local simulation, never the API). */
  demo?: DemoLoopActions;
  milestoneScope?: string;
}

function nextTest(session: DemoSession): DemoTest | null {
  const ordered = [...session.tests].sort((a, b) => a.position - b.position);
  return (
    ordered.find(
      (t) => t.result == null && t.status !== "blocked" && t.status !== "skipped",
    ) ?? null
  );
}

function Shell({
  tone,
  children,
  label,
}: {
  tone: "action" | "stop" | "warn" | "done";
  children: React.ReactNode;
  label: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "rounded-xl border p-4 sm:p-5",
        tone === "action" && "border-cyan-400/30 bg-cyan-400/[0.04]",
        tone === "stop" && "border-red-400/40 bg-red-400/[0.06]",
        tone === "warn" && "border-amber-400/40 bg-amber-400/[0.06]",
        tone === "done" && "border-edge bg-panel",
      )}
    >
      {children}
    </section>
  );
}

/**
 * The single most prominent card in the workspace: what to do next.
 * Live mode records results and re-runs analysis; demo mode shows the
 * same recommendation with sign-in calls to action (never dead buttons).
 */
export function NextAction({ session, live, demo, milestoneScope }: NextActionProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [observation, setObservation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session.safety_state === "critical_stop") {
    const latest = session.safety_events[session.safety_events.length - 1];
    return (
      <Shell tone="stop" label="Stop: hazard identified">
        <div className="flex items-center gap-3">
          <SafetyScene tone="stop" className="w-20 shrink-0 sm:w-24" />
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-red-300 uppercase">
              Stop — hazard identified
            </p>
            <h2 className="mt-0.5 text-base font-semibold text-slate-50">
              Do not run tests on this device
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              {latest?.trigger_detail ?? "The safety controller stopped this session."} Testing
              and analysis stay blocked until a technician reviews it.
            </p>
            {latest?.safe_next_steps && (
              <p className="mt-2 rounded-md bg-canvas/60 px-3 py-2 text-sm text-slate-200">
                <span className="font-medium text-slate-100">Safe next steps: </span>
                {latest.safe_next_steps}
              </p>
            )}
          </div>
        </div>
      </Shell>
    );
  }

  if (session.safety_state === "review_required") {
    return (
      <Shell tone="warn" label="Review required">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-400/15">
            <TriangleAlert className="size-5 text-amber-300" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-amber-300 uppercase">
              Review required
            </p>
            <h2 className="mt-0.5 text-base font-semibold text-slate-50">
              A technician must clear this session first
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              Testing and analysis are paused. Review the safety panel below, then continue.
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  const test = nextTest(session);

  if (!test) {
    const recorded = session.tests.filter((t) => t.result != null).length;
    if (session.tests.length === 0) {
      return (
        <NoTestsHero
          live={live}
          demo={demo}
          deviceType={session.device_type}
          busy={busy}
          setBusy={setBusy}
          error={error}
          setError={setError}
          milestoneScope={milestoneScope}
        />
      );
    }
    return (
      <Shell tone="done" label="All tests recorded">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-400/15">
            <ClipboardCheck className="size-5 text-emerald-300" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-50">
              All {recorded} test{recorded === 1 ? "" : "s"} recorded
            </h2>
            <p className="mt-0.5 text-sm text-slate-400">
              {live
                ? "Review the compiled findings in the repair report below."
                : "This demo stops here — live sessions compile a full repair report."}
            </p>
          </div>
          {live ? (
            <Button type="button" variant="secondary" asChild>
              <a href="#workspace-report">
                View report
                <ArrowRight aria-hidden />
              </a>
            </Button>
          ) : (
            <Button type="button" asChild>
              <Link href="/register">Diagnose a real device</Link>
            </Button>
          )}
        </div>
        {live && <RerunAnalysis live={live} milestoneScope={milestoneScope} />}
      </Shell>
    );
  }

  const record = () => {
    if (!live || !selected || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    void recordTestResultApi(live.sessionId, test.id, live.token, {
      selected_option: selected,
      observation: observation.trim() || null,
    }).then(
      () => {
        setBusy(false);
        setSelected(null);
        setObservation("");
        if (milestoneScope) {
          recordMilestone(milestoneScope, "result_recorded");
          const remaining = session.tests.filter((t) => t.result == null && t.id !== test.id);
          if (remaining.length === 0) {
            recordMilestone(milestoneScope, "all_tests_done");
          }
        }
        live.onChanged();
      },
      (err: unknown) => {
        setBusy(false);
        setError(describeApiError(err));
      },
    );
  };

  return (
    <Shell tone="action" label="Next recommended test">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-cyan-400/15">
          <Wrench className="size-5 text-cyan-300" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-xs font-semibold tracking-wide text-cyan-300 uppercase">
            Next recommended test
          </p>
          <h2 className="mt-0.5 text-base font-semibold text-slate-50">{test.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant={safetyClassificationVariant(test.safety_classification)}>
              {humanize(test.safety_classification)}
            </Badge>
            <span className="text-xs text-slate-400">{skillLabel(test.skill_level)} skill</span>
            {test.required_tools.length > 0 && (
              <span className="text-xs text-slate-400">
                Tools: {test.required_tools.join(", ")}
              </span>
            )}
          </div>
          <ol className="mt-2 flex flex-col gap-1.5" aria-label="First steps">
            {test.instructions.slice(0, 3).map((instruction) => (
              <li key={instruction.step} className="flex items-start gap-2 text-sm text-slate-200">
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-full border border-edge-strong text-[11px] font-semibold text-slate-300 tabular-nums"
                  aria-hidden
                >
                  {instruction.step}
                </span>
                {instruction.text}
              </li>
            ))}
          </ol>
          {test.instructions.length > 3 && (
            <details className="mt-1.5 text-sm">
              <summary className="cursor-pointer text-cyan-300 hover:underline">
                Show all {test.instructions.length} steps
              </summary>
              <ol className="mt-1.5 flex flex-col gap-1.5">
                {test.instructions.slice(3).map((instruction) => (
                  <li
                    key={instruction.step}
                    className="flex items-start gap-2 text-sm text-slate-200"
                  >
                    <span
                      className="flex size-5 shrink-0 items-center justify-center rounded-full border border-edge-strong text-[11px] font-semibold text-slate-300 tabular-nums"
                      aria-hidden
                    >
                      {instruction.step}
                    </span>
                    {instruction.text}
                  </li>
                ))}
              </ol>
            </details>
          )}
          {test.objective && (
            <p className="mt-1.5 text-sm text-slate-400">Why: {test.objective}</p>
          )}
        </div>
      </div>

      {live ? (
        <div className="mt-3 border-t border-edge pt-3">
          <fieldset>
            <legend className="text-xs font-medium text-slate-300">Your result</legend>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Result options">
              {test.result_options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected === option.value}
                  onClick={() => setSelected(option.value)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm transition-colors",
                    selected === option.value
                      ? "border-cyan-400/60 bg-cyan-400/10 text-slate-50"
                      : "border-edge bg-panel text-slate-300 hover:border-edge-strong",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
          <input
            type="text"
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
            placeholder="Short observation (optional)"
            aria-label="Observation"
            maxLength={2000}
            className="mt-2 w-full rounded-md border border-edge bg-panel px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
          {error != null && (
            <p role="alert" className="mt-2 text-xs text-red-300">
              Couldn&apos;t record the result: {error}
            </p>
          )}
          <div className="mt-2">
            <Button type="button" onClick={record} disabled={busy || !selected}>
              {busy ? "Recording…" : "Record result"}
            </Button>
          </div>
        </div>
      ) : demo ? (
        <DemoRecordForm
          test={test}
          demo={demo}
          selected={selected}
          setSelected={setSelected}
          observation={observation}
          setObservation={setObservation}
        />
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-edge pt-3">
          <Button type="button" asChild>
            <Link href="/login?next=/diagnostics/new">Sign in to run this test</Link>
          </Button>
          <span className="text-xs text-slate-500">
            Result options: {test.result_options.map((o) => o.label).join(" · ")}
          </span>
        </div>
      )}
    </Shell>
  );
}

function DemoRecordForm({
  test,
  demo,
  selected,
  setSelected,
  observation,
  setObservation,
}: {
  test: DemoTest;
  demo: DemoLoopActions;
  selected: string | null;
  setSelected: (v: string | null) => void;
  observation: string;
  setObservation: (v: string) => void;
}) {
  const recording = demo.recordingId === test.id;
  return (
    <div className="mt-3 border-t border-edge pt-3">
      <fieldset>
        <legend className="flex items-center gap-2 text-xs font-medium text-slate-300">
          Your sample result
          <Badge variant="warning">Simulated</Badge>
        </legend>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Result options">
          {test.result_options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected === option.value}
              onClick={() => setSelected(option.value)}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm transition-colors",
                selected === option.value
                  ? "border-cyan-400/60 bg-cyan-400/10 text-slate-50"
                  : "border-edge bg-panel text-slate-300 hover:border-edge-strong",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>
      <input
        type="text"
        value={observation}
        onChange={(e) => setObservation(e.target.value)}
        placeholder="Short observation (optional)"
        aria-label="Observation"
        maxLength={2000}
        className="mt-2 w-full rounded-md border border-edge bg-panel px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={recording || !selected}
          onClick={() => {
            if (!selected || recording) {
              return;
            }
            demo.recordResult(test.id, selected, observation);
            setSelected(null);
            setObservation("");
          }}
        >
          {recording ? "Recording…" : "Record sample result"}
        </Button>
        <span className="text-xs text-slate-500">
          Stored in this tab only.{" "}
          <Link href="/register" className="text-cyan-300 underline">
            Sign up
          </Link>{" "}
          to diagnose real devices.
        </span>
      </div>
    </div>
  );
}

function NoTestsHero({
  live,
  demo,
  deviceType,
  busy,
  setBusy,
  error,
  setError,
  milestoneScope,
}: {
  live?: NextActionLive;
  demo?: DemoLoopActions;
  deviceType: string;
  busy: boolean;
  setBusy: (v: boolean) => void;
  error: string | null;
  setError: (v: string | null) => void;
  milestoneScope?: string;
}) {
  const analyze = () => {
    if (!live || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    void analyzeSessionApi(live.sessionId, live.token).then(
      () => {
        setBusy(false);
        if (milestoneScope) {
          recordMilestone(milestoneScope, "analysis_run");
        }
        live.onChanged();
      },
      (err: unknown) => {
        setBusy(false);
        setError(describeApiError(err));
      },
    );
  };
  return (
    <Shell tone="action" label="Run analysis">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-cyan-400/15">
          <Brain className="size-5 text-cyan-300" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-base font-semibold text-slate-50">
            {live
              ? "Analyse this session to propose the first test"
              : "Run the sample analysis to propose the first test"}
          </h2>
          <p className="mt-0.5 text-sm text-slate-400">
            {live
              ? "AI reviews the evidence and symptoms, then recommends one safe distinguishing test."
              : "A simulated run drafts possible causes and a guided first test — no AI calls."}
          </p>
          {error != null && (
            <p role="alert" className="mt-1 text-xs text-red-300">
              Analysis failed: {error}
            </p>
          )}
        </div>
        {live ? (
          <Button type="button" onClick={analyze} disabled={busy}>
            <Brain aria-hidden />
            {busy ? "Analysing…" : "Run AI analysis"}
          </Button>
        ) : demo ? (
          <div className="flex flex-col items-stretch gap-2">
            <Button
              type="button"
              onClick={demo.runSampleAnalysis}
              disabled={demo.analyzing || demo.safetyBlocked}
            >
              <Brain aria-hidden />
              {demo.analyzing ? "Analysing…" : "Run sample analysis"}
            </Button>
            <Link href="/register" className="text-center text-xs text-cyan-300 underline">
              or create an account for live AI
            </Link>
          </div>
        ) : (
          <Button type="button" asChild>
            <Link href="/register">Create an account</Link>
          </Button>
        )}
      </div>
      {live && busy && (
        <div className="mt-3">
          <AnalysisLoader
            device={deviceType}
            title="Running AI analysis"
            steps={["Reading symptoms", "Scanning evidence", "Matching failure patterns"]}
            activeStep={1}
          />
        </div>
      )}
      {!live && demo?.analyzing && (
        <div className="mt-3">
          <AnalysisLoader
            device={deviceType}
            title="Running sample analysis"
            steps={[...SAMPLE_ANALYSIS_STEPS]}
            activeStep={demo.analysisStep}
            simulated
          />
        </div>
      )}
    </Shell>
  );
}

function RerunAnalysis({ live, milestoneScope }: { live: NextActionLive; milestoneScope?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-3 border-t border-edge pt-3">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => {
          if (busy) {
            return;
          }
          setBusy(true);
          setError(null);
          void analyzeSessionApi(live.sessionId, live.token).then(
            () => {
              setBusy(false);
              if (milestoneScope) {
                recordMilestone(milestoneScope, "analysis_run");
              }
              live.onChanged();
            },
            (err: unknown) => {
              setBusy(false);
              setError(describeApiError(err));
            },
          );
        }}
      >
        <Brain aria-hidden />
        {busy ? "Analysing…" : "Run analysis again for follow-ups"}
      </Button>
      {error != null && (
        <p role="alert" className="mt-1 text-xs text-red-300">
          Analysis failed: {error}
        </p>
      )}
    </div>
  );
}
