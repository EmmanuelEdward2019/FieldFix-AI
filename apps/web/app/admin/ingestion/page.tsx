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
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";

const STATUSES = [
  { value: "", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
];

export default function AdminIngestionPage() {
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);

  const { data, error, loading, reload } = useConsoleFetch(
    (client, signal) =>
      client.ingestionJobs({ status: status || undefined, limit: PAGE_SIZE, offset }, signal),
    [status, offset],
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-50">Document ingestion</h1>
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="Status" value={status} onChange={(v) => { setStatus(v); setOffset(0); }} options={STATUSES} />
      </div>

      {error && <PageError message={error} onRetry={reload} />}
      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading ingestion jobs">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      )}
      {data && data.jobs.length === 0 && <EmptyState title="No ingestion jobs found" />}
      {data && data.jobs.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-edge">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-edge bg-panel text-xs text-slate-400">
                <th scope="col" className="px-3 py-2 font-medium">Document</th>
                <th scope="col" className="px-3 py-2 font-medium">Source</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Chunks</th>
                <th scope="col" className="px-3 py-2 font-medium">Error</th>
                <th scope="col" className="px-3 py-2 font-medium">Queued</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge bg-panel">
              {data.jobs.map((j) => (
                <tr key={j.id}>
                  <td className="max-w-64 truncate px-3 py-2 font-medium text-slate-100">
                    {j.document_title ?? "—"}
                  </td>
                  <td className="max-w-56 truncate px-3 py-2 text-slate-300">{j.source_name}</td>
                  <td className="px-3 py-2">
                    <StatusBadge value={j.status} />
                  </td>
                  <td className="px-3 py-2 text-slate-300 tabular-nums">{j.chunks_created}</td>
                  <td className="max-w-56 truncate px-3 py-2 text-xs text-red-300">{j.error ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-400">{formatRelativeTime(j.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pagination total={data.total} offset={offset} onOffset={setOffset} />}
    </div>
  );
}
