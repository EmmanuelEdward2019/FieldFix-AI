"use client";

import { useState } from "react";
import { useAdminAuth } from "@/components/console/admin-auth";
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
import { formatBytes, formatDateTime } from "@/lib/format";

const DEVICES = [
  { value: "", label: "All" },
  { value: "laptop", label: "Laptop" },
  { value: "desktop", label: "Desktop" },
  { value: "smartphone", label: "Smartphone" },
];

const PROCESSING = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "ready", label: "Ready" },
  { value: "failed", label: "Failed" },
];

export default function AdminEvidencePage() {
  const { download } = useAdminAuth();
  const [device, setDevice] = useState("");
  const [processing, setProcessing] = useState("");
  const [offset, setOffset] = useState(0);
  const [preview, setPreview] = useState<{ name: string; url: string; media: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const { data, error, loading, reload } = useConsoleFetch(
    (client, signal) =>
      client.evidence(
        { device: device || undefined, processing: processing || undefined, limit: PAGE_SIZE, offset },
        signal,
      ),
    [device, processing, offset],
  );

  async function openPreview(fileId: string, name: string, media: string) {
    if (!download) {
      return;
    }
    setPreviewError(null);
    setLoadingId(fileId);
    try {
      const blob = await download(`/api/v1/admin/evidence/${fileId}/download`);
      if (preview) {
        URL.revokeObjectURL(preview.url);
      }
      setPreview({ name, url: URL.createObjectURL(blob), media });
    } catch (err) {
      setPreviewError(describeApiError(err));
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-50">Evidence management</h1>
      <p className="text-xs text-slate-500">
        Previews are permission-controlled and audit-logged. No bulk download.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="Device" value={device} onChange={(v) => { setDevice(v); setOffset(0); }} options={DEVICES} />
        <FilterSelect label="Processing" value={processing} onChange={(v) => { setProcessing(v); setOffset(0); }} options={PROCESSING} />
      </div>

      {previewError && (
        <p role="alert" className="text-sm text-red-300">
          {previewError}
        </p>
      )}
      {error && <PageError message={error} onRetry={reload} />}
      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading evidence">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      )}
      {data && data.evidence.length === 0 && <EmptyState title="No evidence found" />}
      {data && data.evidence.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-edge">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-edge bg-panel text-xs text-slate-400">
                <th scope="col" className="px-3 py-2 font-medium">File</th>
                <th scope="col" className="px-3 py-2 font-medium">Session</th>
                <th scope="col" className="px-3 py-2 font-medium">Media</th>
                <th scope="col" className="px-3 py-2 font-medium">Size</th>
                <th scope="col" className="px-3 py-2 font-medium">Processing</th>
                <th scope="col" className="px-3 py-2 font-medium">Uploaded</th>
                <th scope="col" className="px-3 py-2 font-medium">Preview</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge bg-panel">
              {data.evidence.map((e) => (
                <tr key={e.id}>
                  <td className="max-w-56 truncate px-3 py-2 font-medium text-slate-100">
                    {e.original_filename ?? e.id.slice(0, 8)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">{e.session_id.slice(0, 8)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-300">{e.media_type}</td>
                  <td className="px-3 py-2 text-slate-300 tabular-nums">{formatBytes(e.byte_size)}</td>
                  <td className="px-3 py-2">
                    <StatusBadge value={e.processing_status} />
                  </td>
                  <td className="px-3 py-2 text-slate-400">{formatDateTime(e.created_at)}</td>
                  <td className="px-3 py-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={loadingId === e.id}
                      onClick={() => void openPreview(e.id, e.original_filename ?? "evidence", e.media_type)}
                    >
                      {loadingId === e.id ? "…" : "Preview"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pagination total={data.total} offset={offset} onOffset={setOffset} />}

      {preview && (
        <section aria-label="Evidence preview" className="rounded-xl border border-edge bg-panel p-4">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-medium text-slate-200">{preview.name}</h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => {
                URL.revokeObjectURL(preview.url);
                setPreview(null);
              }}
            >
              Close
            </Button>
          </div>
          <div className="mt-2 flex justify-center rounded-lg border border-edge bg-canvas p-2">
            {preview.media.startsWith("image/") ? (
              <img src={preview.url} alt={`Evidence preview: ${preview.name}`} className="max-h-96 rounded" />
            ) : preview.media.startsWith("video/") ? (
              <video src={preview.url} controls className="max-h-96 rounded" aria-label={`Evidence preview: ${preview.name}`} />
            ) : (
              <p className="py-6 text-xs text-slate-500">
                Preview is available for images and video only. The file reference remains in the audit record.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
