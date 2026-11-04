"use client";

import { useState } from "react";
import { useConsoleFetch } from "@/components/console/use-fetch";
import {
  EmptyState,
  FilterSelect,
  PAGE_SIZE,
  PageError,
  Pagination,
  StatusBadge,
} from "@/components/console/widgets";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";

const STATUSES = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "timeout", label: "Timeout" },
];

export default function AdminAiUsagePage() {
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);

  const summary = useConsoleFetch((client, signal) => client.overview(30, signal));
  const runs = useConsoleFetch(
    (client, signal) =>
      client.modelRuns(
        { provider: provider || undefined, status: status || undefined, limit: PAGE_SIZE, offset },
        signal,
      ),
    [provider, status, offset],
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-50">AI model usage</h1>

      {summary.error && <PageError message={summary.error} onRetry={summary.reload} />}
      {summary.loading && <Skeleton className="h-24" aria-label="Loading usage summary" />}
      {summary.data && (
        <dl className="grid grid-cols-2 gap-2 rounded-xl border border-edge bg-panel p-4 text-xs sm:grid-cols-4">
          <div><dt className="text-slate-500">Requests (30d)</dt><dd className="text-xl text-slate-100 tabular-nums">{summary.data.ai.total_runs}</dd></div>
          <div><dt className="text-slate-500">Succeeded / failed</dt><dd className="text-xl text-slate-100 tabular-nums">{summary.data.ai.succeeded} / {summary.data.ai.failed}</dd></div>
          <div><dt className="text-slate-500">Avg latency</dt><dd className="text-xl text-slate-100 tabular-nums">{summary.data.ai.avg_latency_ms == null ? "—" : `${Math.round(summary.data.ai.avg_latency_ms)} ms`}</dd></div>
          <div><dt className="text-slate-500">Timeouts / rate-limited (24h)</dt><dd className="text-xl text-slate-100 tabular-nums">{summary.data.ai.timeouts_24h} / {summary.data.ai.rate_limited_24h}</dd></div>
        </dl>
      )}

      <section aria-label="Model runs" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium text-slate-200">Model runs</h2>
          <FilterSelect
            label="Provider"
            value={provider}
            onChange={(v) => {
              setProvider(v);
              setOffset(0);
            }}
            options={[
              { value: "", label: "All" },
              { value: "meta", label: "Meta" },
            ]}
          />
          <FilterSelect
            label="Status"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setOffset(0);
            }}
            options={STATUSES}
          />
        </div>
        {runs.error && <PageError message={runs.error} onRetry={runs.reload} />}
        {runs.loading && (
          <div className="flex flex-col gap-2" role="status" aria-label="Loading model runs">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        )}
        {runs.data && runs.data.runs.length === 0 && <EmptyState title="No model runs found" />}
        {runs.data && runs.data.runs.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-edge">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-edge bg-panel text-xs text-slate-400">
                  <th scope="col" className="px-3 py-2 font-medium">Time</th>
                  <th scope="col" className="px-3 py-2 font-medium">Provider / model</th>
                  <th scope="col" className="px-3 py-2 font-medium">Task</th>
                  <th scope="col" className="px-3 py-2 font-medium">Outcome</th>
                  <th scope="col" className="px-3 py-2 font-medium">Validation</th>
                  <th scope="col" className="px-3 py-2 font-medium">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge bg-panel">
                {runs.data.runs.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 text-slate-400">{formatRelativeTime(r.created_at)}</td>
                    <td className="px-3 py-2 text-slate-300">
                      <Badge variant="muted">{r.provider}</Badge>{" "}
                      <span className="font-mono text-xs">{r.model_id}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-300">{r.task_type}</td>
                    <td className="px-3 py-2">
                      <StatusBadge value={r.status} />
                      {r.error_category && (
                        <span className="ml-1 text-xs text-slate-500">{r.error_category}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-300">{r.validation_status}</td>
                    <td className="px-3 py-2 text-slate-300 tabular-nums">
                      {r.latency_ms == null ? "—" : `${r.latency_ms} ms`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {runs.data && <Pagination total={runs.data.total} offset={offset} onOffset={setOffset} />}
      </section>
    </div>
  );
}
