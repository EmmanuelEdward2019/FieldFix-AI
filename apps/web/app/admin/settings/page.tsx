"use client";

import { useEffect, useState } from "react";
import { useAdminAuth, useCan } from "@/components/console/admin-auth";
import { useConsoleFetch } from "@/components/console/use-fetch";
import { ConfirmButton, PageError, TextField } from "@/components/console/widgets";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError } from "@/lib/api";

/** Platform settings. Writes require Super Admin and are audit-logged. */
export default function AdminSettingsPage() {
  const { api } = useAdminAuth();
  const canManage = useCan("settings:manage");
  const { data, error, loading, reload } = useConsoleFetch((client, signal) => client.settings(signal));
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [demoEnabled, setDemoEnabled] = useState(true);
  const [metaEnabled, setMetaEnabled] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) {
      setName(data.platform_name);
      setContact(data.support_contact);
      setDemoEnabled(data.demo_enabled);
      setMetaEnabled(data.ai_meta_enabled);
    }
  }, [data]);

  async function save() {
    if (!api) {
      return;
    }
    setNotice(null);
    setActionError(null);
    setBusy(true);
    try {
      await api.updateSettings({
        platform_name: name.trim(),
        support_contact: contact.trim(),
        demo_enabled: demoEnabled,
        ai_meta_enabled: metaEnabled,
      });
      setNotice("Settings saved.");
      reload();
    } catch (err) {
      setActionError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-50">Platform settings</h1>
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
        <div className="flex flex-col gap-2" role="status" aria-label="Loading settings">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      )}
      {data && (
        <>
          <section aria-label="General settings" className="flex max-w-md flex-col gap-3 rounded-xl border border-edge bg-panel p-4">
            <TextField label="Platform name" value={name} maxLength={120} onChange={setName} />
            <TextField label="Support contact" value={contact} maxLength={254} onChange={setContact} />
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={demoEnabled}
                disabled={!canManage}
                onChange={(e) => setDemoEnabled(e.target.checked)}
                className="size-4 accent-cyan-400"
              />
              Demo mode enabled
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={metaEnabled}
                disabled={!canManage}
                onChange={(e) => setMetaEnabled(e.target.checked)}
                className="size-4 accent-cyan-400"
              />
              Meta AI reasoning enabled
            </label>
            {canManage ? (
              <div>
                <ConfirmButton label="Save settings" confirmLabel="Save" busy={busy} onConfirm={() => void save()} />
              </div>
            ) : (
              <p className="text-xs text-slate-500">Changing settings requires the Super Admin role.</p>
            )}
          </section>

          <section aria-label="Configured limits" className="rounded-xl border border-edge bg-panel p-4">
            <h2 className="text-sm font-medium text-slate-200">Configured limits</h2>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-slate-500">Upload limit</dt><dd className="text-slate-200 tabular-nums">{data.upload_limit_mb} MB</dd></div>
              <div><dt className="text-slate-500">Session retention</dt><dd className="text-slate-200 tabular-nums">{data.session_ttl_days} days</dd></div>
              <div><dt className="text-slate-500">Login rate limit</dt><dd className="text-slate-200">{data.login_rate_limit}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-slate-500">Limits are deployment configuration, not editable here.</p>
          </section>
        </>
      )}
    </div>
  );
}
