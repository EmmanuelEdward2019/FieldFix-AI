"use client";

import Link from "next/link";
import { useState } from "react";
import { useAdminAuth, useCan } from "@/components/console/admin-auth";
import { useConsoleFetch } from "@/components/console/use-fetch";
import {
  ConfirmButton,
  EmptyState,
  FilterSelect,
  PAGE_SIZE,
  PageError,
  Pagination,
  SearchInput,
  StatusBadge,
} from "@/components/console/widgets";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

export default function AdminUsersPage() {
  const { api } = useAdminAuth();
  const canManage = useCan("users:manage");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);

  const { data, error, loading, reload } = useConsoleFetch(
    (client, signal) =>
      client.users(
        { q: search || undefined, role: role || undefined, status: status || undefined, limit: PAGE_SIZE, offset },
        signal,
      ),
    [search, role, status, offset],
  );

  async function setStatusFor(id: string, next: "active" | "suspended" | "deactivated") {
    if (!api) {
      return;
    }
    setActionError(null);
    setActioning(id);
    try {
      await api.updateUser(id, { status: next });
      reload();
    } catch (err) {
      setActionError(describeApiError(err));
    } finally {
      setActioning(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-50">Users</h1>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          label="Search users"
          placeholder="Search name or email"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setOffset(0);
          }}
        />
        <FilterSelect
          label="Role"
          value={role}
          onChange={(v) => {
            setRole(v);
            setOffset(0);
          }}
          options={[
            { value: "", label: "All" },
            { value: "super_admin", label: "Super admin" },
            { value: "admin", label: "Admin" },
            { value: "operator", label: "Operator" },
            { value: "technician", label: "Technician" },
          ]}
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

      {actionError && (
        <p role="alert" className="text-sm text-red-300">
          {actionError}
        </p>
      )}
      {error && <PageError message={error} onRetry={reload} />}
      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading users">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      )}
      {data && data.users.length === 0 && (
        <EmptyState title="No users match these filters" hint="Adjust the search or filters." />
      )}
      {data && data.users.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-edge">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-edge bg-panel text-xs text-slate-400">
                <th scope="col" className="px-3 py-2 font-medium">Name</th>
                <th scope="col" className="px-3 py-2 font-medium">Email</th>
                <th scope="col" className="px-3 py-2 font-medium">Role</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Sessions</th>
                <th scope="col" className="px-3 py-2 font-medium">Last login</th>
                {canManage && (
                  <th scope="col" className="px-3 py-2 font-medium">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-edge bg-panel">
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2 font-medium text-slate-100">
                    <Link href={`/admin/users/${u.id}`} className="hover:text-cyan-300 hover:underline">
                      {u.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{u.email}</td>
                  <td className="px-3 py-2 text-slate-300">{u.role.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2">
                    <StatusBadge value={u.status} />
                  </td>
                  <td className="px-3 py-2 text-slate-300 tabular-nums">{u.session_count}</td>
                  <td className="px-3 py-2 text-slate-400">{u.last_login_at ? formatDateTime(u.last_login_at) : "—"}</td>
                  {canManage && (
                    <td className="px-3 py-2">
                      {u.status === "suspended" ? (
                        <Button type="button" variant="secondary" size="sm" disabled={actioning === u.id} onClick={() => void setStatusFor(u.id, "active")}>
                          Reinstate
                        </Button>
                      ) : (
                        <ConfirmButton
                          label="Suspend"
                          confirmLabel="Suspend"
                          busy={actioning === u.id}
                          onConfirm={() => void setStatusFor(u.id, "suspended")}
                        />
                      )}
                    </td>
                  )}
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
