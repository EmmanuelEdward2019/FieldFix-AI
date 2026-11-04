"use client";

import { useState } from "react";
import { Ban, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { transitionSafetyApi, describeApiError } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import type { DemoSafetyEvent, DemoSession } from "@/lib/demo-data";
import type { SafetyState } from "@fieldfix/contracts";
import { cn } from "@/lib/utils";
import { humanize, safetyStateVariant } from "./status-badges";

export interface SafetyLiveActions {
  sessionId: string;
  token: string;
  onChanged: () => void;
}

interface SafetyStatusProps {
  session: DemoSession;
  live?: SafetyLiveActions;
}

/**
 * Persistent safety status. Critical states use role="alert" so assistive
 * tech announces them on session switch. Live technician sessions can
 * request policy-checked transitions; the backend controller stays
 * authoritative and rejects anything illegal.
 */
export function SafetyStatus({ session, live }: SafetyStatusProps) {
  const latest: DemoSafetyEvent | undefined =
    session.safety_events[session.safety_events.length - 1];
  const critical = session.safety_state === "critical_stop";

  return (
    <Card
      aria-labelledby="safety-title"
      className={cn(critical && "border-red-400/40")}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle id="safety-title">Safety status</CardTitle>
        <Badge variant={safetyStateVariant(session.safety_state)}>
          {humanize(session.safety_state)}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {latest == null ? (
          <p className="flex items-start gap-2 text-sm text-slate-300">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0 text-emerald-300"
              aria-hidden
            />
            {live
              ? "Normal — no active hazards. Intake text and uploads are screened automatically on the server."
              : "Normal — no active hazards. The deterministic safety controller will enforce this state from the backend in a later phase."}
          </p>
        ) : (
          <div
            role={critical ? "alert" : "status"}
            className={cn(
              "flex flex-col gap-2 rounded-lg border p-3",
              critical
                ? "border-red-400/30 bg-red-400/5"
                : "border-amber-400/30 bg-amber-400/5",
            )}
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <ShieldAlert
                className={cn(
                  "size-4 shrink-0",
                  critical ? "text-red-300" : "text-amber-300",
                )}
                aria-hidden
              />
              {critical ? "Critical stop" : humanize(session.safety_state)} ·{" "}
              {humanize(latest.trigger_type)}
            </p>
            {latest.trigger_detail != null && (
              <p className="text-xs text-slate-300">{latest.trigger_detail}</p>
            )}
            {latest.blocked_action != null && (
              <p className="flex items-start gap-1.5 text-xs text-slate-300">
                <Ban className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Blocked: {humanize(latest.blocked_action)}
              </p>
            )}
            <div className="rounded-md bg-canvas/60 px-3 py-2">
              <p className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                Safe next steps
              </p>
              <p className="mt-1 text-xs text-slate-200">
                {latest.safe_next_steps}
              </p>
            </div>
            <p className="text-[11px] text-slate-500">
              {live ? "Safety event" : "Demo safety event"} ·{" "}
              {formatRelativeTime(latest.createdAt)}
            </p>
          </div>
        )}
        {live && (
          <SafetyTransitionForm
            session={session}
            live={live}
            critical={critical}
          />
        )}
      </CardContent>
    </Card>
  );
}

const STATES: SafetyState[] = ["normal", "caution", "critical_stop", "review_required"];

function legalTargets(from: SafetyState): SafetyState[] {
  if (from === "critical_stop") {
    return ["review_required"];
  }
  return STATES.filter((s) => s !== from);
}

function SafetyTransitionForm({
  session,
  live,
  critical,
}: {
  session: DemoSession;
  live: SafetyLiveActions;
  critical: boolean;
}) {
  const targets = legalTargets(session.safety_state);
  const [toState, setToState] = useState<SafetyState>(targets[0] ?? "review_required");
  const [rationale, setRationale] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const technician = session.user_mode === "technician";

  if (!technician) {
    return (
      <p className="text-[11px] text-slate-500">
        Safety-state changes require a technician session. The current state
        is enforced by the backend and cannot be bypassed from here.
      </p>
    );
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (rationale.trim().length === 0 || submitting) {
      setError("A rationale is required for every safety transition.");
      return;
    }
    setSubmitting(true);
    setError(null);
    void transitionSafetyApi(live.sessionId, live.token, {
      to_state: toState,
      rationale: rationale.trim(),
    }).then(
      () => {
        setSubmitting(false);
        setRationale("");
        live.onChanged();
      },
      (err: unknown) => {
        setSubmitting(false);
        setError(describeApiError(err));
      },
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-edge pt-3">
      <p className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
        Technician transition{critical ? " (critical stop exits only to review)" : ""}
      </p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Target safety state">
        {targets.map((target) => (
          <label
            key={target}
            className={cn(
              "cursor-pointer rounded-md border px-2.5 py-1.5 text-xs transition-colors",
              toState === target
                ? "border-cyan-400/50 bg-cyan-400/5 text-slate-50"
                : "border-edge text-slate-300 hover:border-edge-strong",
            )}
          >
            <input
              type="radio"
              name="safety-target"
              value={target}
              checked={toState === target}
              onChange={() => setToState(target)}
              className="sr-only"
            />
            {humanize(target)}
          </label>
        ))}
      </div>
      <label htmlFor="safety-rationale" className="text-xs text-slate-400">
        Rationale (required, recorded with the event)
      </label>
      <textarea
        id="safety-rationale"
        rows={2}
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        placeholder="Why is this transition safe to make?"
        className="w-full resize-y rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
      />
      {error != null && (
        <p role="alert" className="text-xs text-amber-200">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={submitting} className="self-start">
        {submitting ? "Requesting…" : "Request transition"}
      </Button>
    </form>
  );
}
