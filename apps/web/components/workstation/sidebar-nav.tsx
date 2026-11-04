"use client";

import {
  BookOpen,
  FlaskConical,
  Laptop,
  LayoutDashboard,
  Mic,
  Monitor,
  Plus,
  Settings2,
  ShoppingBag,
  Smartphone,
  Wrench,
} from "lucide-react";
import type { SafetyState } from "@fieldfix/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatRelativeTime } from "@/lib/format";
import type { DemoSession } from "@/lib/demo-data";
import type { StoredRealSession } from "@/lib/session-store";
import { cn } from "@/lib/utils";
import { humanize, safetyStateVariant } from "./status-badges";

/** Minimal fields the session list renders (demo + live both satisfy). */
interface SidebarSession {
  id: string;
  device_type: "laptop" | "desktop" | "smartphone";
  model?: string | null;
  symptoms: string;
  safety_state: SafetyState;
  updatedAt: string;
}

interface SidebarNavProps {
  sessions: DemoSession[];
  realSessions: StoredRealSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
}

const PLANNED_MODULES = [
  { icon: Mic, label: "Voice guidance" },
  { icon: ShoppingBag, label: "Parts advisor" },
  { icon: Settings2, label: "Shop workspace" },
];

function SessionItem({
  session,
  active,
  onSelect,
  badge,
}: {
  session: SidebarSession;
  active: boolean;
  onSelect: (id: string) => void;
  badge: React.ReactNode;
}) {
  const DeviceIcon =
    session.device_type === "smartphone"
      ? Smartphone
      : session.device_type === "desktop"
        ? Monitor
        : Laptop;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(session.id)}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors",
          active
            ? "border-cyan-400/40 bg-cyan-400/5"
            : "border-transparent hover:border-edge hover:bg-panel",
        )}
      >
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border",
            active
              ? "border-cyan-400/30 text-cyan-300"
              : "border-edge text-slate-400",
          )}
        >
          <DeviceIcon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-100">
            {session.model ?? humanize(session.device_type)}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-xs text-slate-400">
            {session.symptoms}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {badge}
            <Badge
              variant={safetyStateVariant(session.safety_state)}
              className="text-[10px]"
            >
              {humanize(session.safety_state)}
            </Badge>
            <span className="text-[11px] text-slate-500">
              {formatRelativeTime(session.updatedAt)}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

export function SidebarNav({
  sessions,
  realSessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
}: SidebarNavProps) {
  return (
    <nav aria-label="Workstation" className="flex flex-col gap-5">
      <div>
        <div className="flex items-center justify-between gap-2 px-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
            <LayoutDashboard className="size-3.5" aria-hidden />
            Sessions
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onNewSession}
            aria-label="Create a new live session"
          >
            <Plus aria-hidden />
            New
          </Button>
        </div>
        {realSessions.length > 0 && (
          <>
            <p className="mt-3 px-2 text-[11px] font-medium tracking-wider text-slate-500 uppercase">
              Your sessions
            </p>
            <ul className="mt-1.5 flex flex-col gap-1" role="list" aria-label="Your live sessions">
              {realSessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  active={session.id === activeSessionId}
                  onSelect={onSelectSession}
                  badge={
                    <Badge variant="success" className="text-[10px]">
                      Live
                    </Badge>
                  }
                />
              ))}
            </ul>
          </>
        )}
        <p className="mt-3 px-2 text-[11px] font-medium tracking-wider text-slate-500 uppercase">
          Demo sessions
        </p>
        <ul className="mt-1.5 flex flex-col gap-1" role="list" aria-label="Demo sessions">
          {sessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              active={session.id === activeSessionId}
              onSelect={onSelectSession}
              badge={
                <Badge variant="warning" className="text-[10px]">
                  Demo
                </Badge>
              }
            />
          ))}
        </ul>
      </div>

      <Separator />

      <div>
        <p className="flex items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
          <FlaskConical className="size-3.5" aria-hidden />
          Device categories
        </p>
        <ul className="mt-2 flex flex-col gap-1 text-sm" role="list">
          <li className="flex items-center gap-2 rounded-md px-2 py-1.5 text-slate-300">
            <Laptop className="size-4 text-slate-500" aria-hidden />
            Laptops & computers
          </li>
          <li className="flex items-center gap-2 rounded-md px-2 py-1.5 text-slate-300">
            <Smartphone className="size-4 text-slate-500" aria-hidden />
            Mobile phones
          </li>
        </ul>
      </div>

      <div>
        <p className="flex items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
          <BookOpen className="size-3.5" aria-hidden />
          Knowledge centre
        </p>
        <div className="mt-2 rounded-lg border border-edge bg-panel p-3">
          <p className="text-xs font-medium text-slate-200">
            2 demo documents · 5 excerpts
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Fictional service manual and safety notice used for citations.
          </p>
        </div>
      </div>

      <div>
        <p className="flex items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
          <Wrench className="size-3.5" aria-hidden />
          Coming soon
        </p>
        <ul className="mt-2 flex flex-col gap-1" role="list">
          {PLANNED_MODULES.map(({ icon: Icon, label }) => (
            <li
              key={label}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5"
            >
              <span className="flex items-center gap-2 text-sm text-slate-500">
                <Icon className="size-4" aria-hidden />
                {label}
              </span>
              <Badge variant="muted" className="text-[10px]">
                Coming soon
              </Badge>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
