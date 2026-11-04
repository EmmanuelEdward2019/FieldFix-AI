"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { describeApiError, recordTestResultApi } from "@/lib/api";
import {
  checklistReducer,
  initialChecklistState,
  type ChecklistState,
} from "@/lib/checklist";
import type { DemoTest, DemoTestResult } from "@/lib/demo-data";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import {
  humanize,
  safetyClassificationVariant,
  skillLabel,
  testStatusVariant,
} from "./status-badges";

export interface ChecklistLiveActions {
  sessionId: string;
  token: string;
  onChanged: () => void;
}

interface DiagnosticChecklistProps {
  tests: DemoTest[];
  safetyBlocked: boolean;
  activeTestId: string | null;
  onSelectTest: (id: string) => void;
  captures: Record<string, ChecklistState>;
  onCaptureChange: (testId: string, state: ChecklistState) => void;
  live?: ChecklistLiveActions;
}

/**
 * Guided diagnostic checklist. Live sessions persist results through
 * the API; demo sessions keep local-only capture with an honest label.
 */
export function DiagnosticChecklist({
  tests,
  safetyBlocked,
  activeTestId,
  onSelectTest,
  captures,
  onCaptureChange,
  live,
}: DiagnosticChecklistProps) {
  const active =
    tests.find((t) => t.id === activeTestId) ??
    tests.find((t) => t.status !== "completed") ??
    tests[0] ??
    null;

  return (
    <Card aria-labelledby="checklist-title">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle id="checklist-title">Diagnostic checklist</CardTitle>
        {active != null && (
          <Badge variant={testStatusVariant(active.status)}>
            {humanize(active.status)}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {tests.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={safetyBlocked ? "Checklist blocked" : "No tests yet"}
            hint={
              safetyBlocked
                ? "Guided tests are blocked while this session is in critical stop."
                : "Safe, distinguishing tests will appear here once hypotheses exist."
            }
          />
        ) : (
          active != null && (
            <>
              {tests.length > 1 && (
                <ol
                  aria-label="Tests in this session"
                  className="flex gap-2 overflow-x-auto pb-1"
                >
                  {tests.map((test, index) => (
                    <li key={test.id} className="shrink-0">
                      <button
                        type="button"
                        onClick={() => onSelectTest(test.id)}
                        aria-current={test.id === active.id}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors",
                          test.id === active.id
                            ? "border-cyan-400/40 bg-cyan-400/5 text-slate-100"
                            : "border-edge text-slate-400 hover:border-edge-strong hover:text-slate-200",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-4 items-center justify-center rounded-full text-[10px] font-semibold",
                            test.status === "completed"
                              ? "bg-emerald-400/20 text-emerald-200"
                              : "bg-panel-elevated text-slate-400",
                          )}
                          aria-hidden
                        >
                          {index + 1}
                        </span>
                        {test.name}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <TestCard
                test={active}
                safetyBlocked={safetyBlocked}
                capture={captures[active.id] ?? initialChecklistState()}
                onCaptureChange={(state) => onCaptureChange(active.id, state)}
                live={live}
              />
            </>
          )
        )}
      </CardContent>
    </Card>
  );
}

function TestCard({
  test,
  safetyBlocked,
  capture,
  onCaptureChange,
  live,
}: {
  test: DemoTest;
  safetyBlocked: boolean;
  capture: ChecklistState;
  onCaptureChange: (state: ChecklistState) => void;
  live?: ChecklistLiveActions;
}) {
  const [showAll, setShowAll] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const dispatch = (action: Parameters<typeof checklistReducer>[1]) =>
    onCaptureChange(checklistReducer(capture, action));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!live) {
      dispatch({
        type: "submit",
        validOptions: test.result_options.map((o) => o.value),
      });
      return;
    }
    if (capture.selectedOption == null || submitting) {
      dispatch({
        type: "submit",
        validOptions: test.result_options.map((o) => o.value),
      });
      return;
    }
    setSubmitting(true);
    setServerError(null);
    void recordTestResultApi(live.sessionId, test.id, live.token, {
      selected_option: capture.selectedOption,
      observation: capture.observation.trim() || null,
    }).then(
      () => {
        setSubmitting(false);
        live.onChanged();
      },
      (err: unknown) => {
        setSubmitting(false);
        setServerError(describeApiError(err));
      },
    );
  };

  return (
    <article aria-labelledby={`test-${test.id}`} className="flex flex-col gap-3">
      <div>
        <h3
          id={`test-${test.id}`}
          className="text-sm font-semibold text-slate-100"
        >
          {test.name}
        </h3>
        <p className="mt-1 text-xs text-slate-400">{test.objective}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant={safetyClassificationVariant(test.safety_classification)}>
            {humanize(test.safety_classification)}
          </Badge>
          <Badge variant="secondary">{skillLabel(test.skill_level)}</Badge>
          {test.required_tools.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-slate-400">
              <Wrench className="size-3.5" aria-hidden />
              {test.required_tools.join(", ")}
            </span>
          )}
        </div>
        {test.rationale != null && (
          <p className="mt-2 text-xs text-slate-400">
            <span className="font-medium text-slate-300">Why this test: </span>
            {test.rationale}
          </p>
        )}
      </div>

      <Separator />

      <ol className="flex flex-col gap-1.5" aria-label="Test instructions">
        {(showAll ? test.instructions : test.instructions.slice(0, 3)).map(
          (instruction) => (
            <li
              key={instruction.step}
              className="flex items-start gap-2.5 text-sm text-slate-200"
            >
              <span
                className="flex size-5 shrink-0 items-center justify-center rounded-full border border-edge-strong text-[11px] font-semibold text-slate-300 tabular-nums"
                aria-hidden
              >
                {instruction.step}
              </span>
              {instruction.text}
            </li>
          ),
        )}
      </ol>
      {test.instructions.length > 3 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="self-start"
        >
          {showAll
            ? "Show fewer steps"
            : `Show all ${test.instructions.length} steps`}
        </Button>
      )}
      {test.expected_outcomes != null && (
        <p className="rounded-md border border-edge bg-canvas px-3 py-2 text-xs text-slate-300">
          <span className="font-medium text-slate-100">Expected: </span>
          {test.expected_outcomes}
        </p>
      )}

      <Separator />

      {test.result != null ? (
        <RecordedResult test={test} result={test.result} live={live != null} />
      ) : safetyBlocked ? (
        <p
          role="note"
          className="flex items-start gap-2 rounded-md border border-red-400/30 bg-red-400/5 px-3 py-2.5 text-xs text-red-200"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Result capture is disabled: this session is in critical stop. Resolve
          the safety state before running guided tests.
        </p>
      ) : test.safety_classification === "blocked" ? (
        <p
          role="note"
          className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2.5 text-xs text-amber-200"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Blocked on safety grounds — results cannot be recorded for this
          test. A technician can review it.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <fieldset>
            <legend className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
              Record your result
            </legend>
            <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {test.result_options.map((option) => {
                const checked = capture.selectedOption === option.value;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                      checked
                        ? "border-cyan-400/50 bg-cyan-400/5 text-slate-50"
                        : "border-edge text-slate-300 hover:border-edge-strong",
                    )}
                  >
                    <input
                      type="radio"
                      name={`result-${test.id}`}
                      value={option.value}
                      checked={checked}
                      onChange={() =>
                        dispatch({ type: "select", value: option.value })
                      }
                      className="size-4 shrink-0 accent-cyan-400"
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label
              htmlFor={`notes-${test.id}`}
              className="text-xs font-semibold tracking-wider text-slate-400 uppercase"
            >
              Observations{" "}
              <span className="font-normal normal-case">(optional)</span>
            </label>
            <textarea
              id={`notes-${test.id}`}
              rows={2}
              value={capture.observation}
              onChange={(e) =>
                dispatch({ type: "notes", value: e.target.value })
              }
              placeholder="Anything notable while running the test…"
              className="mt-1.5 w-full resize-y rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />
          </div>

          {capture.error != null && (
            <p
              role="alert"
              className="flex items-start gap-1.5 text-xs text-amber-200"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {capture.error}
            </p>
          )}

          {serverError != null && (
            <p
              role="alert"
              className="flex items-start gap-1.5 text-xs text-red-300"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {serverError}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? "Saving…" : "Save result"}
            </Button>
            <p className="text-[11px] text-slate-500">
              {live
                ? "Saved to this session as your reported result."
                : "Demo capture only — not sent to the backend yet."}
            </p>
          </div>

          {!live && capture.submitted != null && (
            <p
              role="status"
              className="flex items-start gap-2 rounded-md border border-emerald-400/30 bg-emerald-400/5 px-3 py-2.5 text-xs text-emerald-200"
            >
              <CheckCircle2
                className="mt-0.5 size-4 shrink-0"
                aria-hidden
              />
              Captured “
              {
                test.result_options.find(
                  (o) => o.value === capture.submitted?.selected_option,
                )?.label
              }
              ” locally. The results endpoint will persist this in a later
              phase.
            </p>
          )}
        </form>
      )}
    </article>
  );
}

function RecordedResult({
  test,
  result,
  live,
}: {
  test: DemoTest;
  result: DemoTestResult;
  live: boolean;
}) {
  const label =
    test.result_options.find((o) => o.value === result.selected_option)
      ?.label ?? result.selected_option;
  return (
    <div className="rounded-md border border-emerald-400/25 bg-emerald-400/5 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-emerald-200 uppercase">
        <CheckCircle2 className="size-3.5" aria-hidden />
        Recorded result · {live ? "user-reported" : "demo"}
      </p>
      <p className="mt-1.5 text-sm font-medium text-slate-100">{label}</p>
      {result.observation != null && (
        <p className="mt-1 text-xs text-slate-300">{result.observation}</p>
      )}
      <p className="mt-1 text-[11px] text-slate-500">
        Reported {formatRelativeTime(result.reportedAt)}
      </p>
    </div>
  );
}
