import { CalendarClock, FileText, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ProgressRing } from "@/components/fx/progress-ring";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import type { DemoSession } from "@/lib/demo-data";
import {
  humanize,
  safetyStateVariant,
  sessionStatusVariant,
  userModeVariant,
} from "./status-badges";

interface SessionHeaderProps {
  session: DemoSession;
  /** Live API session vs fictional demo fixture. */
  live?: boolean;
}

export function SessionHeader({ session, live = false }: SessionHeaderProps) {
  const deviceLabel = [session.manufacturer, session.model]
    .filter(Boolean)
    .join(" ");
  const recorded = session.tests.filter((t) => t.result != null).length;

  return (
    <section
      aria-labelledby="session-title"
      className="rounded-lg border border-edge bg-panel p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {live ? (
              <Badge variant="success">Live session</Badge>
            ) : (
              <Badge variant="warning">Demo data</Badge>
            )}
            <Badge variant={sessionStatusVariant(session.status)}>
              {humanize(session.status)}
            </Badge>
            <Badge variant={safetyStateVariant(session.safety_state)}>
              Safety: {humanize(session.safety_state)}
            </Badge>
            <Badge variant={userModeVariant(session.user_mode)}>
              {humanize(session.user_mode)} mode
            </Badge>
          </div>
          <h1
            id="session-title"
            className="mt-2 text-lg font-semibold tracking-tight text-slate-50 sm:text-xl"
          >
            {deviceLabel || humanize(session.device_type)}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-300">
            {session.symptoms}
          </p>
        </div>
        {session.tests.length > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-edge bg-canvas px-3 py-2">
            <ProgressRing
              value={recorded}
              total={session.tests.length}
              label={`${recorded} of ${session.tests.length} tests recorded`}
            />
            <span className="text-xs text-slate-300">
              Tests
              <span className="block text-[11px] text-slate-500">
                {recorded === session.tests.length ? "All recorded" : "In progress"}
              </span>
            </span>
          </div>
        )}
        {session.report != null && (
          <div className="flex items-center gap-2 rounded-md border border-edge bg-canvas px-3 py-2 text-xs text-slate-300">
            <FileText className="size-4 text-cyan-300" aria-hidden />
            <span>
              Report{" "}
              <span className="font-medium text-slate-100">
                {humanize(session.report.status)}
              </span>
            </span>
          </div>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
        <div className="flex items-start gap-2">
          <CalendarClock
            className="mt-0.5 size-4 shrink-0 text-slate-500"
            aria-hidden
          />
          <div>
            <dt className="text-slate-500">Problem started</dt>
            <dd className="mt-0.5 text-slate-300">
              {session.problem_started_note ?? "Unknown"}
            </dd>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <History className="size-4 shrink-0 text-slate-500" aria-hidden />
          <div>
            <dt className="text-slate-500">Recent events</dt>
            <dd className="mt-0.5 text-slate-300">
              {session.recent_events ?? "None reported"}
            </dd>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <FileText className="size-4 shrink-0 text-slate-500" aria-hidden />
          <div>
            <dt className="text-slate-500">Last activity</dt>
            <dd className="mt-0.5 text-slate-300">
              <time
                dateTime={session.updatedAt}
                title={formatDateTime(session.updatedAt)}
              >
                {formatRelativeTime(session.updatedAt)}
              </time>
            </dd>
          </div>
        </div>
      </dl>
    </section>
  );
}
