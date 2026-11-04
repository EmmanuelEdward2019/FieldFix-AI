"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAdminAuth, useCan } from "@/components/console/admin-auth";
import { useConsoleFetch } from "@/components/console/use-fetch";
import { ConfirmButton, EmptyState, PageError, StatusBadge } from "@/components/console/widgets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError } from "@/lib/api";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

const ROLES = ["technician", "operator", "admin", "super_admin"] as const;

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { api, me } = useAdminAuth();
  const canManageUsers = useCan("users:manage");
  const canManageRoles = useCan("roles:manage");
  const canSessions = useCan("sessions:view");
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, error, loading, reload } = useConsoleFetch(
    (client, signal) => client.userDetail(id, signal),
    [id],
  );

  const isSelf = me?.actor_type === "user" && me.actor_id === id;

  async function update(patch: { status?: "active" | "suspended" | "deactivated"; role?: (typeof ROLES)[number] }) {
    if (!api) {
      return;
    }
    setActionError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api.updateUser(id, patch);
      setNotice("User updated.");
      reload();
    } catch (err) {
      setActionError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!api) {
      return;
    }
    setActionError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api.resetUserPassword(id);
      setNotice("Password reset initiated. The reset link is delivered through the configured email channel.");
      reload();
    } catch (err) {
      setActionError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p>
        <Link href="/admin/users" className="text-sm text-cyan-300 hover:underline">
          ← Users
        </Link>
      </p>
      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading user">
          <Skeleton className="h-10 w-1/3" />
          <Skeleton className="h-48" />
        </div>
      )}
      {error && <PageError message={error} onRetry={reload} />}
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-50">{data.user.name}</h1>
            <Badge variant="muted">{data.user.role.replace(/_/g, " ")}</Badge>
            <StatusBadge value={data.user.status} />
          </div>
          {actionError && (
            <p role="alert" className="text-sm text-red-300">
              {actionError}
            </p>
          )}
          {notice && (
            <p role="status" className="text-sm text-emerald-300">
              {notice}
            </p>
          )}
          <dl className="grid gap-2 rounded-xl border border-edge bg-panel p-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-500">Email</dt><dd className="text-slate-100">{data.user.email}</dd></div>
            <div><dt className="text-xs text-slate-500">Registered</dt><dd className="text-slate-100">{formatDateTime(data.user.created_at)}</dd></div>
            <div><dt className="text-xs text-slate-500">Last login</dt><dd className="text-slate-100">{data.user.last_login_at ? formatDateTime(data.user.last_login_at) : "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Email confirmed</dt><dd className="text-slate-100">{data.user.email_confirmed ? "Yes" : "No"}</dd></div>
          </dl>

          {canManageUsers && (
            <section aria-label="Account actions" className="rounded-xl border border-edge bg-panel p-4">
              <h2 className="text-sm font-medium text-slate-200">Account actions</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.user.status === "suspended" ? (
                  <Button type="button" variant="secondary" size="sm" disabled={busy || isSelf} onClick={() => void update({ status: "active" })}>
                    Reinstate
                  </Button>
                ) : (
                  <ConfirmButton label="Suspend" confirmLabel="Suspend" busy={busy} onConfirm={() => void update({ status: "suspended" })} />
                )}
                {data.user.status !== "deactivated" && (
                  <ConfirmButton label="Deactivate" confirmLabel="Deactivate" busy={busy} onConfirm={() => void update({ status: "deactivated" })} />
                )}
                <ConfirmButton label="Reset password" confirmLabel="Send reset" busy={busy} onConfirm={() => void resetPassword()} />
              </div>
              {isSelf && <p className="mt-2 text-xs text-slate-500">You cannot suspend your own account.</p>}
            </section>
          )}

          {canManageRoles && (
            <section aria-label="Role assignment" className="rounded-xl border border-edge bg-panel p-4">
              <h2 className="text-sm font-medium text-slate-200">Role</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {ROLES.map((role) => (
                  <Button
                    key={role}
                    type="button"
                    variant={data.user.role === role ? "default" : "secondary"}
                    size="sm"
                    disabled={busy || data.user.role === role}
                    onClick={() => void update({ role })}
                  >
                    {role.replace(/_/g, " ")}
                  </Button>
                ))}
              </div>
              {isSelf && <p className="mt-2 text-xs text-slate-500">You cannot change your own role.</p>}
            </section>
          )}

          <section aria-label="User sessions" className="rounded-xl border border-edge bg-panel p-4">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-slate-200">Sessions</h2>
              {canSessions && (
                <Link href={`/admin/sessions?user=${encodeURIComponent(data.user.email)}`} className="ml-auto text-xs text-cyan-300 hover:underline">
                  View all
                </Link>
              )}
            </div>
            {data.sessions.length === 0 ? (
              <div className="mt-2"><EmptyState title="No sessions yet" /></div>
            ) : (
              <ul className="mt-2 divide-y divide-edge" role="list">
                {data.sessions.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 py-1.5 text-xs">
                    <span className="min-w-0 flex-1 truncate text-slate-300">
                      {canSessions ? (
                        <Link href={`/admin/sessions/${s.id}`} className="hover:text-cyan-300 hover:underline">
                          {s.id.slice(0, 8)} · {s.device_type} {s.manufacturer ?? ""} {s.model ?? ""}
                        </Link>
                      ) : (
                        `${s.id.slice(0, 8)} · ${s.device_type}`
                      )}
                    </span>
                    <StatusBadge value={s.status} />
                    <span className="shrink-0 text-slate-500">{formatRelativeTime(s.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
