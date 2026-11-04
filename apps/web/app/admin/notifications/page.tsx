"use client";

import { useState } from "react";
import { useAdminAuth, useCan } from "@/components/console/admin-auth";
import { useConsoleFetch } from "@/components/console/use-fetch";
import {
  EmptyState,
  FilterSelect,
  PAGE_SIZE,
  PageError,
  Pagination,
  TextAreaField,
  TextField,
} from "@/components/console/widgets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";

export default function AdminNotificationsPage() {
  const { api } = useAdminAuth();
  const canManage = useCan("notifications:manage");
  const [unreadOnly, setUnreadOnly] = useState("");
  const [offset, setOffset] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, error, loading, reload } = useConsoleFetch(
    (client, signal) =>
      client.notifications(
        { unread: unreadOnly === "1" ? "1" : undefined, limit: PAGE_SIZE, offset },
        signal,
      ),
    [unreadOnly, offset],
  );

  async function markRead(id: string) {
    if (!api) {
      return;
    }
    setActionError(null);
    try {
      await api.markRead(id);
      reload();
    } catch (err) {
      setActionError(describeApiError(err));
    }
  }

  async function markAll() {
    if (!api) {
      return;
    }
    setActionError(null);
    try {
      await api.readAll();
      reload();
    } catch (err) {
      setActionError(describeApiError(err));
    }
  }

  async function announce(e: React.FormEvent) {
    e.preventDefault();
    if (!api || !title.trim() || !body.trim()) {
      return;
    }
    setNotice(null);
    setActionError(null);
    setBusy(true);
    try {
      await api.announce({ title: title.trim(), body: body.trim() });
      setNotice("Announcement recorded.");
      setTitle("");
      setBody("");
      reload();
    } catch (err) {
      setActionError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-slate-50">Notifications</h1>
        {data && data.unread > 0 && <Badge variant="default">{data.unread} unread</Badge>}
        <span className="ml-auto">
          <Button type="button" variant="secondary" size="sm" onClick={() => void markAll()}>
            Mark all read
          </Button>
        </span>
      </div>
      <p className="text-xs text-slate-500">
        In-app records only — no email, SMS, or push delivery is wired to these events.
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

      {canManage && (
        <section aria-label="Post announcement" className="rounded-xl border border-edge bg-panel p-4">
          <h2 className="text-sm font-medium text-slate-200">Post announcement</h2>
          <form onSubmit={(e) => void announce(e)} className="mt-2 flex max-w-md flex-col gap-2">
            <TextField label="Title" value={title} maxLength={200} onChange={setTitle} placeholder="Title" />
            <TextAreaField
              label="Body"
              value={body}
              maxLength={2000}
              onChange={setBody}
              placeholder="What should administrators know?"
            />
            <div>
              <Button type="submit" size="sm" disabled={busy || !title.trim() || !body.trim()}>
                {busy ? "Posting…" : "Post"}
              </Button>
            </div>
          </form>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Show"
          value={unreadOnly}
          onChange={(v) => {
            setUnreadOnly(v);
            setOffset(0);
          }}
          options={[
            { value: "", label: "All" },
            { value: "1", label: "Unread only" },
          ]}
        />
      </div>

      {error && <PageError message={error} onRetry={reload} />}
      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading notifications">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      )}
      {data && data.notifications.length === 0 && <EmptyState title="No notifications" />}
      {data && data.notifications.length > 0 && (
        <ul className="flex flex-col gap-2" role="list">
          {data.notifications.map((n) => (
            <li key={n.id} className="rounded-xl border border-edge bg-panel p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={n.is_read ? "muted" : "default"}>{n.kind.replace(/_/g, " ")}</Badge>
                <span className="text-sm font-medium text-slate-100">{n.title}</span>
                <span className="ml-auto text-xs text-slate-500">{formatRelativeTime(n.created_at)}</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{n.body}</p>
              {!n.is_read && (
                <div className="mt-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => void markRead(n.id)}>
                    Mark read
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && <Pagination total={data.total} offset={offset} onOffset={setOffset} />}
    </div>
  );
}
