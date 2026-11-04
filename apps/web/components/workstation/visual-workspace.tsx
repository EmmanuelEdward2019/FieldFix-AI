"use client";

import { ChevronDown } from "lucide-react";
import type { DemoSession } from "@/lib/demo-data";
import type { DemoLoopActions } from "./demo-actions";
import { SessionHeader } from "./session-header";
import { NextAction, type NextActionLive } from "./next-action";
import { TechnicianHandoffCta } from "./technician-handoff-cta";

export interface VisualWorkspacePanels {
  safety: React.ReactNode;
  canvas: React.ReactNode;
  hypotheses: React.ReactNode;
  checklist: React.ReactNode;
  refs: React.ReactNode;
  activity: React.ReactNode;
  report: React.ReactNode;
  voice: React.ReactNode;
  parts: React.ReactNode;
}

interface VisualWorkspaceProps {
  session: DemoSession;
  isLive: boolean;
  nextLive?: NextActionLive;
  demoNext?: DemoLoopActions;
  milestoneScope?: string;
  panels: VisualWorkspacePanels;
  /** Demo-only session picker strip. */
  demoPicker?: React.ReactNode;
}

function Disclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-edge bg-panel">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm font-medium text-slate-200 [&::-webkit-details-marker]:hidden">
        <ChevronDown
          className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180"
          aria-hidden
        />
        {summary}
      </summary>
      <div className="border-t border-edge p-3">{children}</div>
    </details>
  );
}

/**
 * Evidence-first workspace composition. Default view prioritises the
 * device evidence, the suspected faults, the next recommended test,
 * and safety — everything else collapses into disclosures.
 */
export function VisualWorkspace({
  session,
  isLive,
  nextLive,
  demoNext,
  milestoneScope,
  panels,
  demoPicker,
}: VisualWorkspaceProps) {
  const elevated =
    session.safety_state === "critical_stop" || session.safety_state === "review_required";
  const recorded = session.tests.filter((t) => t.result != null).length;

  return (
    <div className="mx-auto flex w-full max-w-[100rem] flex-col gap-4 p-4 sm:p-6">
      {demoPicker}
      <SessionHeader session={session} live={isLive} />
      {elevated && <div>{panels.safety}</div>}
      <NextAction session={session} live={nextLive} demo={demoNext} milestoneScope={milestoneScope} />
      {nextLive != null && (
        <TechnicianHandoffCta
          safetyState={session.safety_state}
          tests={session.tests}
          hypotheses={session.hypotheses}
        />
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,8fr)_minmax(0,5fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {panels.canvas}
          {panels.hypotheses}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {!elevated && <div>{panels.safety}</div>}
          {panels.voice}
          {panels.refs}
          {panels.parts}
          <Disclosure
            summary={`All tests (${recorded}/${session.tests.length} recorded)`}
          >
            {panels.checklist}
          </Disclosure>
          <Disclosure summary="Timeline & model runs">{panels.activity}</Disclosure>
        </div>
      </div>

      <div id="workspace-report" className="scroll-mt-24">
        {panels.report}
      </div>
    </div>
  );
}
