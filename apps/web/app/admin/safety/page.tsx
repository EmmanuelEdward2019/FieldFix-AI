"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAdminAuth, useCan } from "@/components/console/admin-auth";
import { useConsoleFetch } from "@/components/console/use-fetch";
import {
  EmptyState,
  FilterSelect,
  PAGE_SIZE,
  PageError,
  Pagination,
  StatusBadge,
  TextAreaField,
} from "@/components/console/widgets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";

const STATES = [
  { value: "", label: "All" },
  { value: "normal", label: "Normal" },
  { value: "caution", label: "Caution" },
  { value: "review_required", label: "Review required" },
  { value: "critical_stop", label: "Critical stop" },
];

const REVIEWED = [
  { value: "", label: "All" },
  { value: "no", label: "Unreviewed" },
  { value: "yes", label: "Reviewed" },
];

function SafetyBody({ initialState }: { initialState: string }) {
  const { api } = useAdminAuth();
  const canReview = useCan("safety:manage");
  const [state, setState] = useState(initialState);
  const [reviewed, setReviewed] = useState("");
  const [offset, setOffset] = useState(0);
  const [reviewFor, setReviewFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, error, loading, reload } = useConsoleFetch(
    (client, signal) =>
      client.safetyEvents(
        { state: state || undefined, reviewed: reviewed || undefined, limit: PAGE_SIZE, offset },
        signal,
      ),
    [state, reviewed, offset],
  );

  async function submitReview(id: string) {
    if (!api || !note.trim()) {
      return;
    }
    setNotice(null);
    setActionError(null);
    setBusy(true);
    try {
      await api.reviewSafety(id, { note: note.trim() });
      setNotice("Incident marked as reviewed. The safety state is unchanged.");
      setReviewFor(null);
      setNote("");
      reload();
    } catch (err) {
      setActionError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-50">Safety incidents</h1>
      <p className="text-xs text-slate-500">
        Reviews record that a person looked at the incident. They never override the safety
        controller or release a critical stop.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="State" value={state} onChange={(v) => { setState(v); setOffset(0); }} options={STATES} />
        <FilterSelect label="Review" value={reviewed} onChange={(v) => { setReviewed(v); setOffset(0); }} options={REVIEWED} />
      </div>

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
        <div className="flex flex-col gap-2" role="status" aria-label="Loading safety events">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      {data && data.events.length === 0 && <EmptyState title="No safety events found" />}
      {data && data.events.length > 0 && (
        <ul className="flex flex-col gap-2" role="list">
          {data.events.map((e) => (
            <li key={e.id} className="rounded-xl border border-edge bg-panel p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge value={e.new_state} />
                <span className="text-slate-200">{e.trigger_type}</span>
                <span className="text-slate-500">· {e.device_type}</span>
                {e.reviewed ? (
                  <Badge variant="success">reviewed</Badge>
                ) : (
                  <Badge variant="warning">unreviewed</Badge>
                )}
                <span className="ml-auto text-xs text-slate-500">{formatRelativeTime(e.created_at)}</span>
              </div>
              <p className="mt-1 font-mono text-xs text-slate-500">
                Session{" "}
                <Link href={`/admin/sessions/${e.session_id}`} className="text-cyan-300 hover:underline">
                  {e.session_id.slice(0, 8)}
                </Link>
                {e.trigger_detail ? ` · ${e.trigger_detail}` : ""}
                {e.blocked_action ? ` · blocked: ${e.blocked_action}` : ""}
              </p>
              {e.review_note && <p className="mt-1 text-xs text-slate-400">Note: {e.review_note}</p>}
              {canReview && !e.reviewed && reviewFor !== e.id && (
                <div className="mt-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => { setReviewFor(e.id); setNote(""); }}>
                    Mark reviewed
                  </Button>
                </div>
              )}
              {canReview && reviewFor === e.id && (
                <form
                  className="mt-2 flex max-w-md flex-col gap-2"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    void submitReview(e.id);
                  }}
                >
                  <TextAreaField
                    label="Review note (required)"
                    value={note}
                    maxLength={2000}
                    onChange={setNote}
                    placeholder="What did you verify?"
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={busy || !note.trim()}>
                      {busy ? "Saving…" : "Save review"}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setReviewFor(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && <Pagination total={data.total} offset={offset} onOffset={setOffset} />}
    </div>
  );
}

export default function AdminSafetyPage() {
  return (
    <Suspense fallback={<Skeleton className="h-48" aria-label="Loading safety events" />}>
      <SafetyFromQuery />
    </Suspense>
  );
}

function SafetyFromQuery() {
  const params = useSearchParams();
  return <SafetyBody initialState={params.get("state") ?? ""} />;
}
