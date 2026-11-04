"use client";

import { useState } from "react";
import { useAdminAuth, useCan } from "@/components/console/admin-auth";
import { useConsoleFetch } from "@/components/console/use-fetch";
import { ConfirmButton, PageError, StatusBadge } from "@/components/console/widgets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";

/** Provider ops: kill-switches, connection tests. Credentials stay server-side. */
export default function AdminProvidersPage() {
  const { api } = useAdminAuth();
  const canManage = useCan("ai:manage");
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, loading, reload } = useConsoleFetch((client, signal) => client.providers(signal));

  async function toggle(id: string, enabled: boolean) {
    if (!api) {
      return;
    }
    setNotice(null);
    setActionError(null);
    setBusy(id);
    try {
      await api.toggleProvider(id, { enabled });
      setNotice(`Provider ${enabled ? "enabled" : "disabled"}.`);
      reload();
    } catch (err) {
      setActionError(describeApiError(err));
    } finally {
      setBusy(null);
    }
  }

  async function test(id: string) {
    if (!api) {
      return;
    }
    setNotice(null);
    setActionError(null);
    setBusy(id);
    try {
      const res = await api.testProvider(id);
      setNotice(
        res.ok
          ? `Connection test passed${res.latency_ms == null ? "" : ` in ${res.latency_ms} ms`}. ${res.detail}`
          : `Connection test failed: ${res.detail}`,
      );
      reload();
    } catch (err) {
      setActionError(describeApiError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-50">AI provider configuration</h1>
      <p className="text-xs text-slate-500">
        Masked identifiers only — API keys and tokens never leave the server.
      </p>
      {notice && (
        <p role="status" className="text-sm text-emerald-300">
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className="text-sm text-red-300">
          {actionError}
        </p>
      )}
      {error && <PageError message={error} onRetry={reload} />}
      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading providers">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      )}
      {data && (
        <div className="grid gap-3 xl:grid-cols-2">
          {data.providers.map((p) => (
            <section key={p.id} aria-label={`${p.display_name} provider`} className="rounded-xl border border-edge bg-panel p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-100">{p.display_name}</h2>
                <StatusBadge value={p.enabled ? "active" : "suspended"} />
                {p.configured ? (
                  <Badge variant="success">key configured</Badge>
                ) : (
                  <Badge variant="warning">key missing</Badge>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div><dt className="text-slate-500">Model</dt><dd className="font-mono text-slate-200">{p.model_id}</dd></div>
                <div><dt className="text-slate-500">Last run</dt><dd className="text-slate-200">{p.last_run_at ? `${formatRelativeTime(p.last_run_at)} · ${p.last_status ?? "—"}` : "—"}</dd></div>
                <div><dt className="text-slate-500">Runs (24h)</dt><dd className="text-slate-200 tabular-nums">{p.runs_24h}</dd></div>
                <div><dt className="text-slate-500">Succeeded / failed (24h)</dt><dd className="text-slate-200 tabular-nums">{p.succeeded_24h} / {p.failed_24h}</dd></div>
                <div><dt className="text-slate-500">Avg latency</dt><dd className="text-slate-200 tabular-nums">{p.avg_latency_ms == null ? "—" : `${Math.round(p.avg_latency_ms)} ms`}</dd></div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                {canManage && p.id === "meta" && (
                  <Button type="button" variant="secondary" size="sm" disabled={busy === p.id} onClick={() => void test(p.id)}>
                    {busy === p.id ? "Testing…" : "Test connection"}
                  </Button>
                )}
                {canManage && p.enabled && (
                  <ConfirmButton label="Disable" confirmLabel="Disable" busy={busy === p.id} onConfirm={() => void toggle(p.id, false)} />
                )}
                {canManage && !p.enabled && (
                  <Button type="button" variant="secondary" size="sm" disabled={busy === p.id} onClick={() => void toggle(p.id, true)}>
                    Enable
                  </Button>
                )}
              </div>
              {!canManage && (
                <p className="mt-2 text-xs text-slate-500">Provider tests and toggles require the Super Admin role.</p>
              )}
              {canManage && p.id !== "meta" && (
                <p className="mt-2 text-xs text-slate-500">Connection tests are only available for the reasoning provider.</p>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
