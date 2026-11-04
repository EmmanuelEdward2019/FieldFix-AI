"use client";

import Link from "next/link";
import { useAdminAuth, useCan } from "@/components/console/admin-auth";
import { useConsoleFetch } from "@/components/console/use-fetch";
import { PageError, StatusBadge } from "@/components/console/widgets";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Documented role matrix. Enforcement lives server-side in
 * `apps/api/src/auth/admin-access.ts`; this table describes that config.
 */
const MATRIX: { role: string; scope: string; grants: string[] }[] = [
  {
    role: "super_admin",
    scope: "Full administrative control: users, roles, providers, settings, audit.",
    grants: ["All 18 console capabilities", "roles:manage", "settings:manage", "ai:manage", "audit:view"],
  },
  {
    role: "admin",
    scope: "Users, diagnostics, documents, safety and audit; no role, settings or provider control.",
    grants: ["users:manage", "documents:manage", "safety:manage", "audit:view", "No roles:manage / settings:manage / ai:manage"],
  },
  {
    role: "operator",
    scope: "Read-only assistance: view users, sessions, evidence, safety, health and notifications.",
    grants: ["users:view", "sessions:view", "safety:view", "health:view", "No management capabilities"],
  },
  {
    role: "technician",
    scope: "Own diagnostic work only; no console access.",
    grants: ["No console capabilities"],
  },
];

export default function AdminRolesPage() {
  const { me } = useAdminAuth();
  const canManageUsers = useCan("users:manage");
  const { data, error, loading, reload } = useConsoleFetch((client, signal) =>
    client.users({ role: "super_admin", limit: 100 }, signal).then(async (supers) => {
      const admins = await client.users({ role: "admin", limit: 100 }, signal);
      return [...supers.users, ...admins.users];
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-50">Roles & Permissions</h1>
      <p className="text-sm text-slate-400">
        Permissions are enforced by the backend on every request; this page documents the configured
        roles. Signed in as{" "}
        <span className="text-slate-200">
          {me?.actor_email} ({me?.role.replace(/_/g, " ")})
        </span>
        .
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {MATRIX.map((r) => (
          <section key={r.role} aria-label={`${r.role} role`} className="rounded-xl border border-edge bg-panel p-4">
            <h2 className="text-sm font-semibold text-slate-100">{r.role.replace(/_/g, " ")}</h2>
            <p className="mt-1 text-xs text-slate-400">{r.scope}</p>
            <ul className="mt-2 flex flex-wrap gap-1" role="list">
              {r.grants.map((g) => (
                <li key={g}>
                  <Badge variant={g.startsWith("No ") ? "muted" : "default"}>{g}</Badge>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section aria-label="Administrator accounts" className="rounded-xl border border-edge bg-panel p-4">
        <h2 className="text-sm font-medium text-slate-200">Administrator accounts</h2>
        {loading && (
          <div className="mt-2 flex flex-col gap-2" role="status" aria-label="Loading administrators">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        )}
        {error && <div className="mt-2"><PageError message={error} onRetry={reload} /></div>}
        {data && (
          <ul className="mt-2 divide-y divide-edge" role="list">
            {data.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                <span className="font-medium text-slate-100">
                  {canManageUsers ? (
                    <Link href={`/admin/users/${u.id}`} className="hover:text-cyan-300 hover:underline">
                      {u.name}
                    </Link>
                  ) : (
                    u.name
                  )}
                </span>
                <span className="text-xs text-slate-400">{u.email}</span>
                <Badge variant="muted">{u.role.replace(/_/g, " ")}</Badge>
                <StatusBadge value={u.status} />
              </li>
            ))}
            {data.length === 0 && <li className="py-2 text-sm text-slate-500">No administrator accounts.</li>}
          </ul>
        )}
      </section>
    </div>
  );
}
