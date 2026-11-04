"use client";

import Link from "next/link";
import { useState } from "react";
import { useAdminAuth, useCan } from "@/components/console/admin-auth";
import { useConsoleFetch } from "@/components/console/use-fetch";
import {
  EmptyState,
  FilterSelect,
  PAGE_SIZE,
  PageError,
  Pagination,
  StatusBadge,
} from "@/components/console/widgets";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";

const STATUSES = [
  { value: "", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
];

const CONNECTORS = [
  {
    value: "ifixit_api",
    label: "iFixit guide",
    refLabel: "Guide ID",
    refPlaceholder: "e.g. 208289",
    refHint: "Numeric guide id from the iFixit guide URL — only explicitly listed guides are fetched.",
  },
  {
    value: "myfixit_dataset",
    label: "MyFixit dataset file",
    refLabel: "Server file path",
    refPlaceholder: "/data/myfixit/phones.jsonl",
    refHint: "Local checkout path on the server — never fetched remotely.",
  },
] as const;

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
      <IngestionTrigger onDone={reload} />
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

function IngestionTrigger({ onDone }: { onDone: () => void }) {
  const { api } = useAdminAuth();
  const canManage = useCan("documents:manage");
  const [connector, setConnector] = useState<(typeof CONNECTORS)[number]["value"]>("ifixit_api");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const meta = CONNECTORS.find((c) => c.value === connector) ?? CONNECTORS[0]!;

  if (!canManage) {
    return null;
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!api || busy || ref.trim() === "") {
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.registerConnector({ connector, ref: ref.trim() });
      if ("document" in res) {
        setResult(
          res.document
            ? `Imported “${res.document.title}” — job ${res.job.status}. Approve it under Knowledge Centre to make it citable.`
            : `Import recorded — job ${res.job.status}.`,
        );
      } else {
        const imported = res.items.filter((i) => i.status === "indexed").length;
        const duplicates = res.items.filter((i) => i.status === "duplicate").length;
        const failed = res.items.filter((i) => i.status === "failed").length;
        setResult(
          `${imported} imported, ${duplicates} duplicates, ${failed} failed from ${res.file}. Approve new documents under Knowledge Centre to make them citable.`,
        );
      }
      setRef("");
      onDone();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl border border-edge bg-panel p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-44 flex-col gap-1 text-xs font-medium text-slate-300">
          Source
          <select
            value={connector}
            onChange={(e) => setConnector(e.target.value as typeof connector)}
            className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
          >
            {CONNECTORS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-medium text-slate-300">
          {meta.refLabel}
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder={meta.refPlaceholder}
            className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
        </label>
        <Button type="submit" disabled={busy || ref.trim() === ""}>
          {busy ? "Importing…" : "Import"}
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        {meta.refHint} Imports land as pending —{" "}
        <Link href="/admin/knowledge" className="text-cyan-300 hover:underline">
          approve them
        </Link>{" "}
        before diagnosis can cite them.
      </p>
      {error != null && (
        <p role="alert" className="text-xs text-red-300">
          Import failed: {error}
        </p>
      )}
      {result != null && (
        <p role="status" className="text-xs text-emerald-300">
          {result}
        </p>
      )}
    </form>
  );
}
