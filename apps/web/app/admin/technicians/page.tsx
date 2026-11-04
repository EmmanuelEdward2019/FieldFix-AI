"use client";

import Link from "next/link";
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
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";

/** Technician directory: account status, workload and recent activity only. */
export default function AdminTechniciansPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);

  const { data, error, loading, reload } = useConsoleFetch(
    (client, signal) =>
      client.users(
        { q: search || undefined, role: "technician", status: status || undefined, limit: PAGE_SIZE, offset },
        signal,
      ),
    [search, status, offset],
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-50">Technicians</h1>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          label="Search technicians"
          placeholder="Search name or email"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setOffset(0);
          }}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setOffset(0);
          }}
          options={[
            { value: "", label: "All" },
            { value: "active", label: "Active" },
            { value: "suspended", label: "Suspended" },
            { value: "deactivated", label: "Deactivated" },
          ]}
        />
      </div>

      {error && <PageError message={error} onRetry={reload} />}
      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading technicians">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      )}
      {data && data.users.length === 0 && (
        <EmptyState title="No technicians found" hint="Technician accounts appear here after registration." />
      )}
      {data && data.users.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-edge">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-edge bg-panel text-xs text-slate-400">
                <th scope="col" className="px-3 py-2 font-medium">Name</th>
                <th scope="col" className="px-3 py-2 font-medium">Email</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Sessions</th>
                <th scope="col" className="px-3 py-2 font-medium">Last login</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge bg-panel">
              {data.users.map((t) => (
                <tr key={t.id}>
                  <td className="px-3 py-2 font-medium text-slate-100">
                    <Link href={`/admin/users/${t.id}`} className="hover:text-cyan-300 hover:underline">
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{t.email}</td>
                  <td className="px-3 py-2">
                    <StatusBadge value={t.status} />
                  </td>
                  <td className="px-3 py-2 text-slate-300 tabular-nums">{t.session_count}</td>
                  <td className="px-3 py-2 text-slate-400">
                    {t.last_login_at ? formatRelativeTime(t.last_login_at) : "—"}
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
