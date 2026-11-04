"use client";

import { useState } from "react";
import { Brain, ChevronDown, Lightbulb, Minus, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { analyzeSessionApi, describeApiError, verifyHypothesisApi } from "@/lib/api";
import type { DemoHypothesis } from "@/lib/demo-data";
import { SAMPLE_ANALYSIS_STEPS } from "@/lib/demo-runner";
import { recordMilestone } from "@/lib/milestones";
import { cn } from "@/lib/utils";
import { AnalysisLoader } from "../fx/analysis-loader";
import type { DemoLoopActions } from "./demo-actions";
import { EmptyState } from "./empty-state";
import {
  confidenceValue,
  confidenceVariant,
  humanize,
  hypothesisStatusVariant,
} from "./status-badges";

export interface HypothesisLiveActions {
  sessionId: string;
  token: string;
  safetyBlocked: boolean;
  userMode: "everyday" | "technician";
  onChanged: () => void;
}

interface HypothesisPanelProps {
  hypotheses: DemoHypothesis[];
  live?: HypothesisLiveActions;
  /** Guest-mode sample analysis (tab-local simulation, never the API). */
  demo?: DemoLoopActions;
  deviceType?: string;
  milestoneScope?: string;
}

export function HypothesisPanel({ hypotheses, live, demo, deviceType = "laptop", milestoneScope }: HypothesisPanelProps) {
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = () => {
    if (!live || analyzing) {
      return;
    }
    setAnalyzing(true);
    setError(null);
    void analyzeSessionApi(live.sessionId, live.token).then(
      () => {
        setAnalyzing(false);
        if (milestoneScope) {
          recordMilestone(milestoneScope, "analysis_run");
        }
        live.onChanged();
      },
      (err: unknown) => {
        setAnalyzing(false);
        setError(describeApiError(err));
      },
    );
  };

  return (
    <Card aria-labelledby="hypotheses-title">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle id="hypotheses-title">Hypotheses</CardTitle>
        {live ? (
          <Badge variant="default">Live</Badge>
        ) : (
          <Badge variant="warning">Demo · unvalidated</Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!live && demo && hypotheses.length === 0 && !demo.analyzing && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={demo.runSampleAnalysis}
                disabled={demo.safetyBlocked}
              >
                <Brain aria-hidden />
                Run sample analysis
              </Button>
              {demo.safetyBlocked && (
                <p className="text-[11px] text-slate-500">
                  Blocked in critical stop.
                </p>
              )}
            </div>
          </div>
        )}
        {!live && demo?.analyzing && (
          <AnalysisLoader
            device={deviceType}
            title="Running sample analysis"
            steps={[...SAMPLE_ANALYSIS_STEPS]}
            activeStep={demo.analysisStep}
            simulated
          />
        )}
        {live && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={runAnalysis}
                disabled={analyzing || live.safetyBlocked}
              >
                <Brain aria-hidden />
                {analyzing ? "Analysing…" : "Run AI analysis"}
              </Button>
              {live.safetyBlocked && (
                <p className="text-[11px] text-slate-500">
                  Blocked in critical stop.
                </p>
              )}
            </div>
            {error != null && (
              <p role="alert" className="text-xs text-red-300">
                Analysis failed: {error}
              </p>
            )}
            {analyzing && (
              <AnalysisLoader
                device={deviceType}
                title="Running AI analysis"
                steps={["Reading symptoms", "Scanning evidence", "Matching failure patterns"]}
                activeStep={1}
              />
            )}
          </div>
        )}
        {hypotheses.length === 0 ? (
          <EmptyState
            icon={Lightbulb}
            title="No hypotheses yet"
            hint={
              live
                ? "Possible causes will appear here once you run AI analysis on this session's evidence."
                : "Possible causes will appear here once evidence is analysed. Demo analysis is illustrative only."
            }
          />
        ) : (
          <ul className="flex flex-col gap-3" role="list">
            {hypotheses.map((hypothesis) => (
              <li key={hypothesis.id}>
                <HypothesisCard hypothesis={hypothesis} live={live} milestoneScope={milestoneScope} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function HypothesisCard({
  hypothesis,
  live,
  milestoneScope,
}: {
  hypothesis: DemoHypothesis;
  live?: HypothesisLiveActions;
  milestoneScope?: string;
}) {
  const [open, setOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const evidenceCount =
    hypothesis.supporting_observations.length +
    hypothesis.contradicting_observations.length;
  const canVerify =
    live?.userMode === "technician" &&
    !live.safetyBlocked &&
    hypothesis.status !== "verified" &&
    hypothesis.status !== "ruled_out";

  const verify = () => {
    if (!live || verifying) {
      return;
    }
    setVerifying(true);
    setVerifyError(null);
    void verifyHypothesisApi(
      live.sessionId,
      hypothesis.id,
      live.token,
      `Technician confirmed: ${hypothesis.title}`,
    ).then(
      () => {
        setVerifying(false);
        if (milestoneScope) {
          recordMilestone(milestoneScope, "hypothesis_verified");
        }
        live.onChanged();
      },
      (err: unknown) => {
        setVerifying(false);
        setVerifyError(describeApiError(err));
      },
    );
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-edge bg-canvas"
    >
      <div className="p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={hypothesisStatusVariant(hypothesis.status)}>
            {humanize(hypothesis.status)}
          </Badge>
          <Badge variant={confidenceVariant(hypothesis.confidence_label)}>
            {humanize(hypothesis.confidence_label)} confidence
          </Badge>
        </div>
        <p className="mt-2 text-sm font-medium text-slate-100">
          {hypothesis.title}
        </p>
        {hypothesis.description != null && (
          <p className="mt-1 text-xs text-slate-400">{hypothesis.description}</p>
        )}
        <div className="mt-2.5 flex items-center gap-2">
          <Progress
            value={confidenceValue(hypothesis.confidence_label)}
            aria-label={`Confidence: ${humanize(hypothesis.confidence_label)} (illustrative, not a probability)`}
            className="flex-1"
          />
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-panel-elevated hover:text-slate-200"
            >
              {evidenceCount} evidence
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  open && "rotate-180",
                )}
                aria-hidden
              />
            </button>
          </CollapsibleTrigger>
        </div>
      </div>
      <CollapsibleContent className="px-3 pb-3">
        <div className="flex flex-col gap-2 border-t border-edge pt-2.5 text-xs">
          <EvidenceGroup
            label="Supporting"
            icon={Plus}
            tone="text-emerald-300"
            notes={hypothesis.supporting_observations.map((o) => o.note)}
          />
          <EvidenceGroup
            label="Contradicting"
            icon={Minus}
            tone="text-amber-300"
            notes={hypothesis.contradicting_observations.map((o) => o.note)}
          />
          {hypothesis.confidence_rationale != null && (
            <p className="text-slate-400">
              <span className="font-medium text-slate-300">Why: </span>
              {hypothesis.confidence_rationale}
            </p>
          )}
          {canVerify && (
            <div className="flex flex-col gap-1.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={verify}
                disabled={verifying}
                className="self-start"
              >
                {verifying ? "Verifying…" : "Verify as technician"}
              </Button>
              {verifyError != null && (
                <p role="alert" className="text-amber-200">
                  Verification failed: {verifyError}
                </p>
              )}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function EvidenceGroup({
  label,
  icon: Icon,
  tone,
  notes,
}: {
  label: string;
  icon: typeof Plus;
  tone: string;
  notes: string[];
}) {
  return (
    <div>
      <p className={cn("flex items-center gap-1 font-medium", tone)}>
        <Icon className="size-3.5" aria-hidden />
        {label} ({notes.length})
      </p>
      {notes.length === 0 ? (
        <p className="mt-1 pl-4.5 text-slate-500">None recorded.</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1 pl-4.5 text-slate-300" role="list">
          {notes.map((note, i) => (
            <li key={`${label}-${i}`}>· {note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
