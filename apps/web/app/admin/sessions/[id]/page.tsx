"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCan } from "@/components/console/admin-auth";
import { useConsoleFetch } from "@/components/console/use-fetch";
import { PageError, StatusBadge } from "@/components/console/widgets";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

/** Read-only session inspection. Views are audit-logged; nothing here can edit findings. */
export default function AdminSessionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const canEvidence = useCan("evidence:view");
  const { data, error, loading, reload } = useConsoleFetch(
    (client, signal) => client.sessionDetail(id, signal),
    [id],
  );

  return (
    <div className="flex flex-col gap-4">
      <p>
        <Link href="/admin/sessions" className="text-sm text-cyan-300 hover:underline">
          ← Sessions
        </Link>
      </p>
      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading session">
          <Skeleton className="h-10 w-1/3" />
          <Skeleton className="h-48" />
        </div>
      )}
      {error && <PageError message={error} onRetry={reload} />}
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-base font-semibold text-slate-50">{data.session.id.slice(0, 13)}…</h1>
            <StatusBadge value={data.session.status} />
            <StatusBadge value={data.session.safety_state} />
          </div>

          <dl className="grid gap-2 rounded-xl border border-edge bg-panel p-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-500">Device</dt><dd className="text-slate-100">{data.session.device_type} {[data.session.manufacturer, data.session.model].filter(Boolean).join(" ")}</dd></div>
            <div><dt className="text-xs text-slate-500">OS</dt><dd className="text-slate-100">{data.session.operating_system ?? "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Created / updated</dt><dd className="text-slate-100">{formatDateTime(data.session.created_at)} / {formatRelativeTime(data.session.updated_at)}</dd></div>
            <div><dt className="text-xs text-slate-500">Mode</dt><dd className="text-slate-100">{data.session.user_mode}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Symptoms (user-reported)</dt><dd className="text-slate-100">{data.session.symptoms}</dd></div>
          </dl>

          <div className="grid gap-3 xl:grid-cols-2">
            <section aria-label="Hypotheses" className="rounded-xl border border-edge bg-panel p-4">
              <h2 className="text-sm font-medium text-slate-200">Hypotheses (AI inference)</h2>
              {data.hypotheses.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">None recorded.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2" role="list">
                  {data.hypotheses.map((h) => (
                    <li key={h.id} className="rounded-lg border border-edge bg-canvas p-2 text-xs">
                      <p className="text-slate-100">{h.title}</p>
                      <p className="mt-1 text-slate-500">
                        {h.confidence_label} confidence · {h.status}
                        {h.verified_by_test_result_id ? " · verified by test" : " · unverified"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="Tests and results" className="rounded-xl border border-edge bg-panel p-4">
              <h2 className="text-sm font-medium text-slate-200">Tests & results</h2>
              {data.tests.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">No tests recorded.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2" role="list">
                  {data.tests.map(({ test, result }) => (
                    <li key={test.id} className="rounded-lg border border-edge bg-canvas p-2 text-xs">
                      <p className="text-slate-100">{test.name}</p>
                      <p className="mt-1 text-slate-500">
                        {result ? `Result recorded ${formatRelativeTime(result.created_at)}` : "Awaiting result"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section aria-label="Model runs" className="rounded-xl border border-edge bg-panel p-4">
            <h2 className="text-sm font-medium text-slate-200">Model runs</h2>
            {data.model_runs.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">No model runs for this session.</p>
            ) : (
              <ul className="mt-2 divide-y divide-edge" role="list">
                {data.model_runs.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5 text-xs">
                    <Badge variant="muted">{r.provider} · {r.model_id}</Badge>
                    <span className="text-slate-400">{r.task_type}</span>
                    <StatusBadge value={r.status} />
                    <span className="ml-auto text-slate-500">
                      {r.latency_ms == null ? "—" : `${r.latency_ms} ms`} · {formatRelativeTime(r.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-3 xl:grid-cols-2">
            <section aria-label="Evidence" className="rounded-xl border border-edge bg-panel p-4">
              <h2 className="text-sm font-medium text-slate-200">Evidence ({data.evidence.length})</h2>
              {data.evidence.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">No evidence attached.</p>
              ) : (
                <ul className="mt-2 divide-y divide-edge" role="list">
                  {data.evidence.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-2 py-1.5 text-xs">
                      <span className="text-slate-300">{e.original_filename ?? e.id.slice(0, 8)}</span>
                      <Badge variant="muted">{e.kind}</Badge>
                      <StatusBadge value={e.processing_status} />
                      {canEvidence && (
                        <Link href="/admin/evidence" className="text-cyan-300 hover:underline">
                          Open in evidence
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="Safety events" className="rounded-xl border border-edge bg-panel p-4">
              <h2 className="text-sm font-medium text-slate-200">Safety events</h2>
              {data.safety_events.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">None recorded.</p>
              ) : (
                <ul className="mt-2 divide-y divide-edge" role="list">
                  {data.safety_events.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-2 py-1.5 text-xs">
                      <StatusBadge value={e.new_state} />
                      <span className="text-slate-300">{e.trigger_type}</span>
                      <span className="ml-auto text-slate-500">{formatRelativeTime(e.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {data.citations.length > 0 && (
            <section aria-label="Citations" className="rounded-xl border border-edge bg-panel p-4">
              <h2 className="text-sm font-medium text-slate-200">Citations ({data.citations.length})</h2>
              <ul className="mt-2 divide-y divide-edge" role="list">
                {data.citations.map((c) => (
                  <li key={c.id} className="py-1.5 text-xs">
                    <p className="text-slate-200">{c.document_title}</p>
                    <p className="mt-0.5 line-clamp-2 text-slate-500">{c.excerpt}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="Timeline" className="rounded-xl border border-edge bg-panel p-4">
            <h2 className="text-sm font-medium text-slate-200">Timeline</h2>
            {data.events.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">No events recorded.</p>
            ) : (
              <ul className="mt-2 divide-y divide-edge" role="list">
                {data.events.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 py-1.5 text-xs">
                    <Badge variant="muted">{t.event_type}</Badge>
                    <span className="ml-auto shrink-0 text-slate-500">{formatRelativeTime(t.created_at)}</span>
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
