"use client";

import { useState } from "react";
import { useConsoleFetch } from "@/components/console/use-fetch";
import {
  EmptyState,
  FilterSelect,
  PAGE_SIZE,
  PageError,
  Pagination,
  SearchInput,
  StatusBadge,
} from "@/components/console/widgets";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";

const OUTCOMES = [
  { value: "", label: "All" },
  { value: "success", label: "Success" },
  { value: "denied", label: "Denied" },
  { value: "failed", label: "Failed" },
];

/** Append-only audit trail. No edit or delete actions exist, by design. */
export default function AdminAuditPage() {
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [offset, setOffset] = useState(0);

  const { data, error, loading, reload } = useConsoleFetch(
    (client, signal) =>
      client.auditLogs(
        {
          actor: actor || undefined,
          action: action || undefined,
          outcome: outcome || undefined,
          limit: PAGE_SIZE,
          offset,
        },
        signal,
      ),
    [actor, action, outcome, offset],
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-50">Audit logs</h1>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          label="Filter by actor"
          placeholder="Actor id or email"
          value={actor}
          className="w-44"
          onChange={(v) => {
            setActor(v);
            setOffset(0);
          }}
        />
        <SearchInput
          label="Filter by action"
          placeholder="Action"
          value={action}
          className="w-44"
          onChange={(v) => {
            setAction(v);
            setOffset(0);
          }}
        />
        <FilterSelect
          label="Outcome"
          value={outcome}
          onChange={(v) => {
            setOutcome(v);
            setOffset(0);
          }}
          options={OUTCOMES}
        />
      </div>

      {error && <PageError message={error} onRetry={reload} />}
      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading audit logs">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      )}
      {data && data.logs.length === 0 && <EmptyState title="No audit entries found" />}
      {data && data.logs.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-edge">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-edge bg-panel text-xs text-slate-400">
                <th scope="col" className="px-3 py-2 font-medium">Time</th>
                <th scope="col" className="px-3 py-2 font-medium">Actor</th>
                <th scope="col" className="px-3 py-2 font-medium">Action</th>
                <th scope="col" className="px-3 py-2 font-medium">Target</th>
                <th scope="col" className="px-3 py-2 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge bg-panel">
              {data.logs.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-400">{formatDateTime(a.created_at)}</td>
                  <td className="max-w-48 truncate px-3 py-2 text-slate-300">
                    {a.actor_email ?? a.actor_id ?? a.actor_type}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="muted">{a.action}</Badge>
                  </td>
                  <td className="max-w-48 truncate px-3 py-2 font-mono text-xs text-slate-400">
                    {a.target_type ? `${a.target_type}:${(a.target_id ?? "").slice(0, 8)}` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge value={a.outcome} />
                  </td>
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
