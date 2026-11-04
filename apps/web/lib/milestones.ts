import {
  Camera,
  ClipboardCheck,
  FileCheck2,
  FlaskConical,
  ScanSearch,
  ShieldCheck,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";

/**
 * Honest gamification: badges are earned only by real, confirmed events
 * (live API success or completed guest simulation steps) — never for
 * clicking around. Live progress is keyed per account; guest progress is
 * tab-local and clearly separate.
 */

export type MilestoneEvent =
  | "session_started"
  | "evidence_added"
  | "analysis_run"
  | "result_recorded"
  | "hypothesis_verified"
  | "all_tests_done"
  | "report_ready";

export interface Milestone {
  event: MilestoneEvent;
  title: string;
  blurb: string;
  icon: LucideIcon;
}

export const MILESTONES: Milestone[] = [
  { event: "session_started", title: "First intake", blurb: "Started a diagnosis", icon: Stethoscope },
  { event: "evidence_added", title: "Sharp eyes", blurb: "Attached evidence photos", icon: Camera },
  { event: "analysis_run", title: "Pattern matcher", blurb: "Ran an analysis", icon: ScanSearch },
  { event: "result_recorded", title: "Bench test", blurb: "Recorded a test result", icon: FlaskConical },
  { event: "hypothesis_verified", title: "Confirmed fix", blurb: "Verified a hypothesis", icon: ShieldCheck },
  { event: "all_tests_done", title: "Full workup", blurb: "Recorded every test", icon: ClipboardCheck },
  { event: "report_ready", title: "Signed report", blurb: "Compiled a repair report", icon: FileCheck2 },
];

type Listener = (milestone: Milestone) => void;

const listeners = new Set<Listener>();

export function subscribeMilestones(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function storageKey(scope: string): string {
  return `fieldfix.milestones.${scope}`;
}

function readEarned(scope: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed == null) {
      return {};
    }
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

export function earnedMilestones(scope: string): MilestoneEvent[] {
  const earned = readEarned(scope);
  return MILESTONES.filter((m) => typeof earned[m.event] === "string").map((m) => m.event);
}

/**
 * Record a confirmed event. Returns the milestone when newly earned
 * (so the caller can toast it), null when already earned or unknown.
 */
export function recordMilestone(scope: string, event: MilestoneEvent): Milestone | null {
  const milestone = MILESTONES.find((m) => m.event === event);
  if (!milestone) {
    return null;
  }
  const earned = readEarned(scope);
  if (typeof earned[event] === "string") {
    return null;
  }
  earned[event] = new Date().toISOString();
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(earned));
  } catch {
    /* private mode: celebrate this once without persisting */
  }
  for (const fn of listeners) {
    try {
      fn(milestone);
    } catch {
      /* a toast must never break the underlying action */
    }
  }
  return milestone;
}
