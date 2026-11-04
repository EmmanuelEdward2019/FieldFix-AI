"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { ShopReportSummary } from "@fieldfix/contracts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ALL_JOB_STATUSES, jobStatusLabel } from "./shop-ui";
import { describeApiError, getShopReportApi, isAbortError } from "@/lib/api";

/* Reports tab: actuals-only summary widgets with a date filter.
 * There is deliberately no revenue figure anywhere here. */

function Widget({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-xl border border-edge bg-panel p-4">
      <h3 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function ReportsPanel({ shopId, token }: { shopId: string; token: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [summary, setSummary] = useState<ShopReportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const load = useCallback(() => {
    const controller = new AbortController();
    setSummary(null);
    setError(null);
    void getShopReportApi(
      shopId,
      token,
      {
        ...(applied.from ? { from: new Date(`${applied.from}T00:00:00.000Z`).toISOString() } : {}),
        ...(applied.to ? { to: new Date(`${applied.to}T23:59:59.999Z`).toISOString() } : {}),
      },
      controller.signal,
    ).then(
      (res) => setSummary(res.summary),
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setError(describeApiError(err));
        }
      },
    );
    return () => controller.abort();
  }, [shopId, token, applied, reload]);

  useEffect(() => load(), [load]);

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-end gap-2 rounded-xl border border-edge bg-panel p-3"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ from, to });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="report-from" className="text-xs font-medium text-slate-400">
            From
          </label>
          <input
            id="report-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-edge bg-canvas px-2 py-1.5 text-sm text-slate-100"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="report-to" className="text-xs font-medium text-slate-400">
            To
          </label>
          <input
            id="report-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-edge bg-canvas px-2 py-1.5 text-sm text-slate-100"
          />
        </div>
        <Button type="submit" variant="secondary">
          Apply dates
        </Button>
        {(applied.from !== "" || applied.to !== "") && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setFrom("");
              setTo("");
              setApplied({ from: "", to: "" });
            }}
          >
            Clear
          </Button>
        )}
      </form>

      {error != null && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5"
          role="alert"
        >
          <p className="text-sm text-slate-200">Couldn&apos;t load the report: {error}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => setReload((n) => n + 1)}>
            <RotateCcw aria-hidden />
            Retry
          </Button>
        </div>
      )}

      {summary == null && error == null && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="status" aria-label="Loading report">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      )}

      {summary != null && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Widget title="Jobs overview">
            <p className="text-2xl font-semibold text-slate-50">{summary.jobs_total}</p>
            <p className="text-xs text-slate-500">total jobs in range</p>
            <p className="mt-2 text-sm text-slate-200">
              <span className="font-semibold text-cyan-300">{summary.in_progress}</span> in progress
              <span className="text-slate-500"> (diagnosing, in repair, testing)</span>
            </p>
            <p className="mt-1 text-sm text-slate-200">
              Avg turnaround:{" "}
              <span className="font-semibold">
                {summary.avg_turnaround_hours == null
                  ? "—"
                  : `${summary.avg_turnaround_hours.toFixed(1)} h`}
              </span>
            </p>
          </Widget>

          <Widget title="Jobs by status">
            <ul className="flex flex-col gap-1">
              {ALL_JOB_STATUSES.map((status) => (
                <li key={status} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-slate-300">{jobStatusLabel(status)}</span>
                  <span className="font-medium text-slate-100">
                    {summary.jobs_by_status[status] ?? 0}
                  </span>
                </li>
              ))}
            </ul>
          </Widget>

          <Widget title="Parts consumption">
            {summary.parts_consumption.length === 0 ? (
              <p className="text-sm text-slate-500">No parts used in range.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {summary.parts_consumption.map((row) => (
                  <li key={row.item_id} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate text-slate-300">{row.item_name}</span>
                    <span className="font-medium text-slate-100">{row.quantity_used} used</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-slate-500">
              From inventory movements linked in range — units only, no valuations.
            </p>
          </Widget>

          <Widget title="Workload per assignee">
            {summary.workload.length === 0 ? (
              <p className="text-sm text-slate-500">No assigned jobs in range.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {summary.workload.map((row) => (
                  <li key={row.user_id} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-mono text-xs text-slate-300">
                      {row.user_id.slice(0, 8)}
                    </span>
                    <span className="text-slate-400">
                      <span className="font-medium text-slate-100">{row.active_jobs}</span> active ·{" "}
                      <span className="font-medium text-slate-100">{row.completed_jobs}</span>{" "}
                      completed
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Widget>
        </div>
      )}

      <p className="text-xs text-slate-500">
        Reports show actuals only — job counts, turnaround, parts used, and workload. Estimates are
        quotes, not income, so they never appear here.
      </p>
    </div>
  );
}
