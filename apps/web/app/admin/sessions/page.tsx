"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";

const STATUSES = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "awaiting_test", label: "Awaiting test" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

const DEVICES = [
  { value: "", label: "All" },
  { value: "laptop", label: "Laptop" },
  { value: "desktop", label: "Desktop" },
  { value: "smartphone", label: "Smartphone" },
];

function SessionsBody({ initialStatus, initialUser }: { initialStatus: string; initialUser: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [device, setDevice] = useState("");
  const [user, setUser] = useState(initialUser);
  const [offset, setOffset] = useState(0);

  const { data, error, loading, reload } = useConsoleFetch(
    (client, signal) =>
      client.sessions(
        { status: status || undefined, device: device || undefined, user: user || undefined, limit: PAGE_SIZE, offset },
        signal,
      ),
    [status, device, user, offset],
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-50">Diagnostic sessions</h1>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          label="Filter by user email"
          placeholder="User email"
          value={user}
          onChange={(v) => {
            setUser(v);
            setOffset(0);
          }}
        />
        <FilterSelect label="Status" value={status} onChange={(v) => { setStatus(v); setOffset(0); }} options={STATUSES} />
        <FilterSelect label="Device" value={device} onChange={(v) => { setDevice(v); setOffset(0); }} options={DEVICES} />
      </div>

      {error && <PageError message={error} onRetry={reload} />}
      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading sessions">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      )}
      {data && data.sessions.length === 0 && <EmptyState title="No sessions match these filters" />}
      {data && data.sessions.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-edge">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-edge bg-panel text-xs text-slate-400">
                <th scope="col" className="px-3 py-2 font-medium">Session</th>
                <th scope="col" className="px-3 py-2 font-medium">User</th>
                <th scope="col" className="px-3 py-2 font-medium">Device</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Safety</th>
                <th scope="col" className="px-3 py-2 font-medium">AI</th>
                <th scope="col" className="px-3 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge bg-panel">
              {data.sessions.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 font-medium text-slate-100">
                    <Link href={`/admin/sessions/${s.id}`} className="hover:text-cyan-300 hover:underline">
                      {s.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{s.user_email ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-300">
                    {s.device_type} {[s.manufacturer, s.model].filter(Boolean).join(" ")}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge value={s.status} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge value={s.safety_state} />
                  </td>
                  <td className="px-3 py-2 text-slate-300 tabular-nums">
                    {s.model_run_count} runs{s.last_model_status ? ` · ${s.last_model_status}` : ""}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{formatRelativeTime(s.updated_at)}</td>
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

export default function AdminSessionsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-48" aria-label="Loading sessions" />}>
      <SessionsFromQuery />
    </Suspense>
  );
}

function SessionsFromQuery() {
  const params = useSearchParams();
  return (
    <SessionsBody
      initialStatus={params.get("status") ?? ""}
      initialUser={params.get("user") ?? ""}
    />
  );
}
