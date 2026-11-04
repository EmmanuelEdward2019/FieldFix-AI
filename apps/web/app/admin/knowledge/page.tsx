"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAdminAuth, useCan } from "@/components/console/admin-auth";
import { useConsoleFetch } from "@/components/console/use-fetch";
import {
  EmptyState,
  FilterSelect,
  PageError,
  SearchInput,
  StatusBadge,
} from "@/components/console/widgets";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const PERMISSIONS = [
  { value: "", label: "All" },
  { value: "approved", label: "Approved" },
  { value: "restricted", label: "Restricted" },
  { value: "pending", label: "Pending" },
  { value: "rejected", label: "Rejected" },
];

const SETTABLE = ["pending", "approved", "restricted", "rejected"] as const;

export default function AdminKnowledgePage() {
  const { api } = useAdminAuth();
  const canManage = useCan("documents:manage");
  const [search, setSearch] = useState("");
  const [permission, setPermission] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, loading, reload } = useConsoleFetch((client, signal) => client.documents(signal));

  const filtered = useMemo(() => {
    if (!data) {
      return [];
    }
    const q = search.trim().toLowerCase();
    return data.documents.filter(
      (d) =>
        (permission === "" || d.permission_status === permission) &&
        (q === "" ||
          d.title.toLowerCase().includes(q) ||
          (d.manufacturer ?? "").toLowerCase().includes(q)),
    );
  }, [data, search, permission]);

  async function setPermissionStatus(id: string, next: (typeof SETTABLE)[number]) {
    if (!api) {
      return;
    }
    setActionError(null);
    setBusy(id);
    try {
      await api.patchDocument(id, { permission_status: next });
      reload();
    } catch (err) {
      setActionError(describeApiError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-slate-50">Knowledge Centre</h1>
        <Link href="/admin/ingestion" className="ml-auto text-xs text-cyan-300 hover:underline">
          Ingestion jobs
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          label="Search documents"
          placeholder="Search title or publisher"
          value={search}
          onChange={setSearch}
        />
        <FilterSelect label="Permission" value={permission} onChange={setPermission} options={PERMISSIONS} />
      </div>

      {actionError && (
        <p role="alert" className="text-sm text-red-300">
          {actionError}
        </p>
      )}
      {error && <PageError message={error} onRetry={reload} />}
      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading documents">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      )}
      {data && filtered.length === 0 && <EmptyState title="No documents found" />}
      {data && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-edge">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-edge bg-panel text-xs text-slate-400">
                <th scope="col" className="px-3 py-2 font-medium">Title</th>
                <th scope="col" className="px-3 py-2 font-medium">Manufacturer</th>
                <th scope="col" className="px-3 py-2 font-medium">Devices</th>
                <th scope="col" className="px-3 py-2 font-medium">Permission</th>
                <th scope="col" className="px-3 py-2 font-medium">Ingestion</th>
                <th scope="col" className="px-3 py-2 font-medium">Chunks</th>
                <th scope="col" className="px-3 py-2 font-medium">Updated</th>
                {canManage && (
                  <th scope="col" className="px-3 py-2 font-medium">Set permission</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-edge bg-panel">
              {filtered.map((d) => (
                <tr key={d.id}>
                  <td className="max-w-64 px-3 py-2 font-medium text-slate-100">
                    <span className="block truncate">{d.title}</span>
                    <span className="block truncate text-xs font-normal text-slate-500">{d.source_name}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{d.manufacturer ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-300">
                    {[d.device_family, ...d.model_numbers].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge value={d.permission_status} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge value={d.ingestion_status} />
                  </td>
                  <td className="px-3 py-2 text-slate-300 tabular-nums">{d.chunk_count}</td>
                  <td className="px-3 py-2 text-slate-400">{formatDateTime(d.updated_at)}</td>
                  {canManage && (
                    <td className="px-3 py-2">
                      <span className="inline-flex flex-wrap gap-1">
                        {SETTABLE.filter((s) => s !== d.permission_status).map((s) => (
                          <Button
                            key={s}
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={busy === d.id}
                            onClick={() => void setPermissionStatus(d.id, s)}
                          >
                            {s}
                          </Button>
                        ))}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
