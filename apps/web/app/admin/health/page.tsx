"use client";

import { useConsoleFetch } from "@/components/console/use-fetch";
import { PageError, StatusBadge } from "@/components/console/widgets";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";

/** Live service checks — every row is a real probe, never a hardcoded green. */
export default function AdminHealthPage() {
  const { data, error, loading, reload } = useConsoleFetch((client, signal) => client.health(signal));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-slate-50">System health</h1>
        <span className="ml-auto">
          <Button type="button" variant="secondary" size="sm" onClick={reload} disabled={loading}>
            {loading ? "Checking…" : "Run health checks"}
          </Button>
        </span>
      </div>

      {error && <PageError message={error} onRetry={reload} />}
      {loading && (
        <div className="grid gap-3 sm:grid-cols-2" role="status" aria-label="Running health checks">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      )}
      {data && (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.checks.map((s) => (
            <section key={s.service} aria-label={`${s.service} status`} className="rounded-xl border border-edge bg-panel p-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-100">{s.service}</h2>
                <span className="ml-auto">
                  <StatusBadge value={s.status} />
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-slate-500">Latency</dt>
                  <dd className="text-slate-200 tabular-nums">{s.latency_ms == null ? "—" : `${s.latency_ms} ms`}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Checked</dt>
                  <dd className="text-slate-200">{formatRelativeTime(s.checked_at)}</dd>
                </div>
              </dl>
              <p className="mt-1 text-xs text-slate-400">{s.detail}</p>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
