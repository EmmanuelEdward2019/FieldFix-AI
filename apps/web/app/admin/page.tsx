"use client";

import {
  Activity,
  AlertTriangle,
  FileText,
  FlaskConical,
  ShieldAlert,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useAdminAuth, useCan } from "@/components/console/admin-auth";
import { useConsoleFetch } from "@/components/console/use-fetch";
import { Bars, HBars } from "@/components/console/charts";
import { EmptyState, FilterSelect, PageError, Stat, StatSkeleton } from "@/components/console/widgets";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

export default function AdminOverviewPage() {
  const { me } = useAdminAuth();
  const [range, setRange] = useState("30");
  const { data, error, loading, reload } = useConsoleFetch(
    (api, signal) => api.overview(Number(range), signal),
    [range],
  );
  const canUsers = useCan("users:view");
  const canSessions = useCan("sessions:view");
  const canAi = useCan("ai:view");
  const canSafety = useCan("safety:view");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-slate-50">Platform overview</h1>
        {me && <Badge variant="muted">{me.role.replace(/_/g, " ")}</Badge>}
        <span className="ml-auto">
          <FilterSelect label="Range" value={range} onChange={setRange} options={RANGES} />
        </span>
      </div>

      {loading && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <StatSkeleton key={i} />
          ))}
        </div>
      )}
      {error && <PageError message={error} onRetry={reload} />}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat icon={Users} label="Total users" value={data.users.total} tone="text-cyan-300" href={canUsers ? "/admin/users" : undefined} />
            <Stat icon={UserRound} label="Technicians" value={data.users.technicians} tone="text-cyan-300" href={canUsers ? "/admin/technicians" : undefined} />
            <Stat icon={FlaskConical} label="Diagnostic sessions" value={data.sessions.total} tone="text-cyan-300" href={canSessions ? "/admin/sessions" : undefined} />
            <Stat icon={Activity} label="Active sessions" value={data.sessions.active} tone="text-emerald-300" href={canSessions ? "/admin/sessions?status=in_progress" : undefined} />
            <Stat icon={FileText} label="Repair reports" value={data.reports.total} tone="text-cyan-300" href={canSessions ? "/admin/reports" : undefined} />
            <Stat icon={AlertTriangle} label="Safety incidents" value={data.safety.total_events} tone="text-amber-300" href={canSafety ? "/admin/safety" : undefined} />
            <Stat icon={ShieldAlert} label="Critical stops" value={data.safety.critical_stops} tone="text-red-300" href={canSafety ? "/admin/safety?state=critical_stop" : undefined} />
            <Stat icon={Activity} label="AI model runs" value={data.ai.total_runs} tone="text-cyan-300" href={canAi ? "/admin/ai-usage" : undefined} />
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <section aria-label="Sessions over time" className="rounded-xl border border-edge bg-panel p-4">
              <h2 className="text-sm font-medium text-slate-200">Sessions over time</h2>
              {data.sessions.by_day.length > 0 ? (
                <Bars data={data.sessions.by_day.map((d) => ({ label: d.day, value: d.count }))} label="Diagnostic sessions per day" />
              ) : (
                <p className="mt-2 text-xs text-slate-500">No sessions in this range.</p>
              )}
            </section>
            <section aria-label="Session breakdown" className="rounded-xl border border-edge bg-panel p-4">
              <h2 className="text-sm font-medium text-slate-200">By device</h2>
              <div className="mt-2">
                {data.sessions.by_device.length > 0 ? (
                  <HBars data={data.sessions.by_device.map((d) => ({ label: d.device, value: d.count }))} label="Sessions by device" />
                ) : (
                  <p className="text-xs text-slate-500">No sessions in this range.</p>
                )}
              </div>
              <h2 className="mt-3 text-sm font-medium text-slate-200">By status</h2>
              <div className="mt-2">
                <HBars data={data.sessions.by_status.map((d) => ({ label: d.status, value: d.count }))} label="Sessions by status" />
              </div>
            </section>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <section aria-label="AI usage overview" className="rounded-xl border border-edge bg-panel p-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium text-slate-200">AI usage</h2>
                {canAi && (
                  <Link href="/admin/ai-usage" className="ml-auto text-xs text-cyan-300 hover:underline">
                    Full usage
                  </Link>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div><dt className="text-slate-500">Requests</dt><dd className="text-base text-slate-100 tabular-nums">{data.ai.total_runs}</dd></div>
                <div><dt className="text-slate-500">Succeeded / failed</dt><dd className="text-base text-slate-100 tabular-nums">{data.ai.succeeded} / {data.ai.failed}</dd></div>
                <div><dt className="text-slate-500">Avg latency</dt><dd className="text-base text-slate-100 tabular-nums">{data.ai.avg_latency_ms == null ? "—" : `${Math.round(data.ai.avg_latency_ms)} ms`}</dd></div>
                <div><dt className="text-slate-500">Timeouts / rate-limited (24h)</dt><dd className="text-base text-slate-100 tabular-nums">{data.ai.timeouts_24h} / {data.ai.rate_limited_24h}</dd></div>
              </dl>
            </section>

            <section aria-label="Safety overview" className="rounded-xl border border-edge bg-panel p-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium text-slate-200">Safety</h2>
                {canSafety && (
                  <Link href="/admin/safety" className="ml-auto text-xs text-cyan-300 hover:underline">
                    Incidents
                  </Link>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div><dt className="text-slate-500">Unreviewed</dt><dd className="text-base text-slate-100 tabular-nums">{data.safety.unreviewed}</dd></div>
                <div><dt className="text-slate-500">Critical stops</dt><dd className="text-base text-red-300 tabular-nums">{data.safety.critical_stops}</dd></div>
              </dl>
              {data.safety.recent.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">No safety events recorded.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1.5" role="list">
                  {data.safety.recent.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 text-xs text-slate-300">
                      <Badge variant={e.new_state === "critical_stop" ? "danger" : "warning"}>
                        {e.new_state.replace(/_/g, " ")}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate">{e.trigger_type} · {e.device_type}</span>
                      <span className="shrink-0 text-slate-500">{formatRelativeTime(e.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section aria-label="Recent platform activity" className="rounded-xl border border-edge bg-panel p-4">
            <h2 className="text-sm font-medium text-slate-200">Recent activity</h2>
            {data.activity.length === 0 ? (
              <div className="mt-2"><EmptyState title="No recent activity" /></div>
            ) : (
              <ul className="mt-2 divide-y divide-edge" role="list">
                {data.activity.map((a, i) => (
                  <li key={`${a.created_at}-${i}`} className="flex items-center gap-2 py-1.5 text-xs">
                    <Badge variant="muted">{a.kind.replace(/_/g, " ")}</Badge>
                    <span className="min-w-0 flex-1 truncate text-slate-300">{a.title}</span>
                    <span className="shrink-0 text-slate-500">{formatRelativeTime(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {!loading && !error && !data && (
        <div role="status"><Skeleton className="h-48" /></div>
      )}
    </div>
  );
}
