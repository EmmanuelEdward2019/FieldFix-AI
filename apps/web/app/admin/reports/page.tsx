"use client";

import Link from "next/link";
import { useState } from "react";
import { useAdminAuth } from "@/components/console/admin-auth";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";

const VERIFIED = [
  { value: "", label: "All" },
  { value: "yes", label: "Verified findings" },
  { value: "no", label: "Unverified" },
];

export default function AdminReportsPage() {
  const { download } = useAdminAuth();
  const [user, setUser] = useState("");
  const [verified, setVerified] = useState("");
  const [offset, setOffset] = useState(0);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { data, error, loading, reload } = useConsoleFetch(
    (client, signal) =>
      client.reports(
        { user: user || undefined, verified: verified || undefined, limit: PAGE_SIZE, offset },
        signal,
      ),
    [user, verified, offset],
  );

  async function downloadPdf(id: string) {
    if (!download) {
      return;
    }
    setDownloadError(null);
    setDownloading(id);
    try {
      const blob = await download(`/api/v1/admin/reports/${id}/pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report-${id.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setDownloadError(describeApiError(err));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-50">Repair reports</h1>
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
        <FilterSelect
          label="Verification"
          value={verified}
          onChange={(v) => {
            setVerified(v);
            setOffset(0);
          }}
          options={VERIFIED}
        />
      </div>

      {downloadError && (
        <p role="alert" className="text-sm text-red-300">
          {downloadError}
        </p>
      )}
      {error && <PageError message={error} onRetry={reload} />}
      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading reports">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      )}
      {data && data.reports.length === 0 && <EmptyState title="No reports found" />}
      {data && data.reports.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-edge">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-edge bg-panel text-xs text-slate-400">
                <th scope="col" className="px-3 py-2 font-medium">Report</th>
                <th scope="col" className="px-3 py-2 font-medium">User</th>
                <th scope="col" className="px-3 py-2 font-medium">Device</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Verified</th>
                <th scope="col" className="px-3 py-2 font-medium">Created</th>
                <th scope="col" className="px-3 py-2 font-medium">PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge bg-panel">
              {data.reports.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-mono text-xs text-slate-100">
                    <Link href={`/admin/sessions/${r.session_id}`} className="hover:text-cyan-300 hover:underline">
                      {r.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{r.user_email ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-300">
                    {r.device_type} {[r.manufacturer, r.model].filter(Boolean).join(" ")}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge value={r.status} />
                  </td>
                  <td className="px-3 py-2 text-slate-300 tabular-nums">
                    {r.verified_findings}/{r.total_findings}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{formatRelativeTime(r.created_at)}</td>
                  <td className="px-3 py-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={downloading === r.id || download == null}
                      onClick={() => void downloadPdf(r.id)}
                    >
                      {downloading === r.id ? "…" : "Download"}
                    </Button>
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
