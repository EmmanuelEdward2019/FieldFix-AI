"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, ShieldAlert, Sparkles, Store, UserRound } from "lucide-react";
import type { AdminNotification } from "@fieldfix/contracts";
import { Button } from "@/components/ui/button";
import {
  describeApiError,
  isAbortError,
  markAllNotificationsReadApi,
  markNotificationReadApi,
  myNotificationsApi,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Icon per notification kind. Every kind renders the same title/body/
 * link row — these branches only give technician and shop events a
 * recognisable glyph. Unknown kinds fall back to the bell.
 */
export function notificationKindIcon(kind: string) {
  if (kind === "safety_critical") {
    return <ShieldAlert className="size-4 shrink-0 text-red-300" aria-hidden />;
  }
  if (kind === "announcement") {
    return <Sparkles className="size-4 shrink-0 text-cyan-300" aria-hidden />;
  }
  if (kind === "contact_request") {
    return <UserRound className="size-4 shrink-0 text-cyan-300" aria-hidden />;
  }
  if (kind === "shop" || kind.startsWith("shop_")) {
    return <Store className="size-4 shrink-0 text-amber-300" aria-hidden />;
  }
  return <Bell className="size-4 shrink-0 text-slate-400" aria-hidden />;
}

/**
 * Account notification bell: unread badge, dropdown feed, mark-read.
 * Owned rows carry read state; announcements are a shared broadcast.
 */
export function NotificationBell() {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AdminNotification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (!token) {
      return;
    }
    const controller = new AbortController();
    void myNotificationsApi(token, controller.signal).then(
      (res) => {
        setItems(res.notifications);
        setUnread(res.unread);
        setError(null);
      },
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setError(describeApiError(err));
        }
      },
    );
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    const cancel = load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancel?.();
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  const markOne = (id: string) => {
    if (!token || working) {
      return;
    }
    setWorking(true);
    void markNotificationReadApi(token, id).then(
      () => {
        setWorking(false);
        setItems((prev) =>
          prev == null ? prev : prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
        );
        setUnread((n) => Math.max(0, n - 1));
      },
      () => setWorking(false),
    );
  };

  const markAll = () => {
    if (!token || working) {
      return;
    }
    setWorking(true);
    void markAllNotificationsReadApi(token).then(
      () => {
        setWorking(false);
        setItems((prev) =>
          prev == null
            ? prev
            : prev.map((n) => (n.kind === "announcement" ? n : { ...n, is_read: true })),
        );
        setUnread(0);
      },
      () => setWorking(false),
    );
  };

  return (
    <div className="relative" ref={panelRef}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => {
          setOpen((o) => !o);
          load();
        }}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
      >
        <span className="relative">
          <Bell aria-hidden />
          {unread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-red-400 text-[10px] font-bold text-slate-950">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 flex max-h-96 w-80 flex-col overflow-hidden rounded-xl border border-edge bg-panel shadow-2xl"
        >
          <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
            <p className="text-sm font-medium text-slate-100">Notifications</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={markAll}
              disabled={working || unread === 0}
            >
              <CheckCheck aria-hidden />
              Mark all read
            </Button>
          </div>
          <div className="overflow-y-auto">
            {error != null && (
              <p role="alert" className="px-3 py-4 text-xs text-red-300">
                Couldn&apos;t load notifications: {error}
              </p>
            )}
            {error == null && items == null && (
              <p role="status" className="px-3 py-4 text-xs text-slate-500">
                Loading…
              </p>
            )}
            {items != null && items.length === 0 && (
              <p className="px-3 py-4 text-xs text-slate-500">
                Nothing yet — analysis results, reports, and safety alerts land here.
              </p>
            )}
            {items != null && items.length > 0 && (
              <ul role="list" className="divide-y divide-edge">
                {items.map((n) => (
                  <li
                    key={n.id}
                    className={cn("px-3 py-2.5", !n.is_read && n.kind !== "announcement" && "bg-cyan-400/5")}
                  >
                    <div className="flex items-start gap-2">
                      {notificationKindIcon(n.kind)}
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-slate-100">{n.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{n.body}</p>
                        <p className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                          {formatRelativeTime(n.created_at)}
                          {n.link && (
                            <Link
                              href={n.link}
                              onClick={() => setOpen(false)}
                              className="text-cyan-300 underline"
                            >
                              Open
                            </Link>
                          )}
                          {!n.is_read && n.kind !== "announcement" && (
                            <button
                              type="button"
                              onClick={() => markOne(n.id)}
                              disabled={working}
                              className="text-cyan-300 underline disabled:opacity-50"
                            >
                              Mark read
                            </button>
                          )}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
