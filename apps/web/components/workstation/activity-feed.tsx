import {
  Activity,
  Brain,
  ClipboardCheck,
  ImagePlus,
  PlusCircle,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import type { DemoEvent, DemoModelRun } from "@/lib/demo-data";
import { EmptyState } from "./empty-state";
import { humanize } from "./status-badges";

interface ActivityFeedProps {
  events: DemoEvent[];
  modelRuns: DemoModelRun[];
  live?: boolean;
}

const EVENT_ICONS: Record<string, typeof PlusCircle> = {
  session_created: PlusCircle,
  evidence_ready: ImagePlus,
  analysis_completed: Brain,
  test_result_recorded: ClipboardCheck,
  safety_state_changed: ShieldAlert,
};

const EVENT_LABELS: Record<string, string> = {
  session_created: "Session created",
  evidence_ready: "Evidence ready",
  analysis_completed: "Demo analysis completed",
  test_result_recorded: "Test result recorded",
  safety_state_changed: "Safety state changed",
};

export function ActivityFeed({ events, modelRuns, live = false }: ActivityFeedProps) {
  return (
    <Card aria-labelledby="activity-title">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle id="activity-title">Activity</CardTitle>
        {live ? (
          <Badge variant="default">Live</Badge>
        ) : (
          <Badge variant="warning">Demo events</Badge>
        )}
      </CardHeader>
      {/* Single column: this card always lives in the narrow side column. */}
      <CardContent className="grid grid-cols-1 gap-5">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
            Session events
          </h3>
          {events.length === 0 ? (
            <div className="mt-2">
              <EmptyState
                icon={Activity}
                title="No events yet"
                hint="Workflow transitions will be recorded here as the session progresses."
              />
            </div>
          ) : (
            <ol className="mt-2 flex flex-col" role="list">
              {events.map((event, index) => {
                const Icon = EVENT_ICONS[event.event_type] ?? Activity;
                const last = index === events.length - 1;
                return (
                  <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                    {!last && (
                      <span
                        aria-hidden
                        className="absolute top-7 bottom-0 left-3.5 w-px bg-edge"
                      />
                    )}
                    <span className="z-10 flex size-7 shrink-0 items-center justify-center rounded-full border border-edge bg-canvas">
                      <Icon className="size-3.5 text-cyan-300" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="text-sm font-medium text-slate-200">
                        {live && event.event_type === "analysis_completed"
                          ? "Analysis completed"
                          : (EVENT_LABELS[event.event_type] ??
                            humanize(event.event_type))}
                      </p>
                      <EventPayload event={event} />
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        <time
                          dateTime={event.createdAt}
                          title={formatDateTime(event.createdAt)}
                        >
                          {formatRelativeTime(event.createdAt)}
                        </time>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="min-w-0">
          <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
            Model runs
          </h3>
          {modelRuns.length === 0 ? (
            <p className="mt-2 rounded-md border border-dashed border-edge-strong px-3 py-4 text-center text-xs text-slate-500">
              No model runs recorded for this session.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2" role="list">
              {modelRuns.map((run) => (
                <li
                  key={run.id}
                  className="rounded-md border border-edge bg-canvas px-3 py-2 text-xs"
                >
                  <p className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-200">
                      {run.model_id}
                    </span>
                    <Badge variant="muted" className="text-[10px]">
                      {run.origin}
                    </Badge>
                  </p>
                  <p className="mt-1 text-slate-400">
                    {humanize(run.task_type)} · {humanize(run.status)}
                    {run.latency_ms != null && ` · ${run.latency_ms} ms`}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {formatRelativeTime(run.createdAt)} ·{" "}
                    {run.origin === "live"
                      ? "live provider call"
                      : "demo record, not a live call"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function EventPayload({ event }: { event: DemoEvent }) {
  const entries = Object.entries(event.payload);
  if (entries.length === 0) {
    return null;
  }
  return (
    <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
      {entries.slice(0, 4).map(([key, value]) => (
        // Capped so long ids / JSON payloads clip inside the card
        // instead of painting past the side column.
        <div key={key} className="flex min-w-0 max-w-full gap-1">
          <dt className="text-slate-500">{humanize(key)}:</dt>
          <dd className="max-w-48 truncate font-mono text-[11px]">
            {typeof value === "string" ? value : JSON.stringify(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
