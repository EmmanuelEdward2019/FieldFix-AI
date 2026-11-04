"use client";

import Link from "next/link";
import {
  ArrowRight,
  FileText,
  FlaskConical,
  Package,
  Plus,
  Store,
  UserSearch,
} from "lucide-react";
import type { MySessionItem } from "@fieldfix/contracts";
import { Badge } from "@/components/ui/badge";
import { humanize } from "@/components/workstation/status-badges";
import { sessionTechnicianSignal } from "@/lib/technician-handoff";

/**
 * Contextual dashboard shortcuts (Phase 5). Presentational: the
 * dashboard page loads the data with the existing API clients and
 * passes it in. Every widget states its empty case honestly instead
 * of linking somewhere useless.
 */

const ACTIVE_STATUSES = new Set(["open", "in_progress", "awaiting_test"]);

/** Latest session the user can still work on, if any. */
export function latestActiveSession(sessions: MySessionItem[]): MySessionItem | null {
  const active = sessions.filter((s) => ACTIVE_STATUSES.has(s.status));
  active.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return active[0] ?? null;
}

export function sessionDeviceLabel(session: MySessionItem): string {
  return session.model ?? humanize(session.device_type);
}

function WidgetShell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="rounded-xl border border-edge bg-panel p-4">
      <p className="text-xs font-semibold tracking-wider text-slate-400 uppercase">{label}</p>
      <div className="mt-2">{children}</div>
    </li>
  );
}

export function NewDiagnosisWidget() {
  return (
    <WidgetShell label="Start fresh">
      <Link
        href="/diagnostics/new"
        className="flex items-center gap-2 text-sm font-medium text-slate-100 hover:text-cyan-200"
      >
        <Plus className="size-4 text-cyan-300" aria-hidden />
        New Diagnosis
        <ArrowRight className="size-4 text-slate-500" aria-hidden />
      </Link>
      <p className="mt-1 text-xs text-slate-500">Guided 4-step intake, under a minute.</p>
    </WidgetShell>
  );
}

export function ContinueDiagnosisWidget({ session }: { session: MySessionItem | null }) {
  return (
    <WidgetShell label="Pick up where you left off">
      {session == null ? (
        <p className="text-sm text-slate-400">
          No in-progress diagnoses — start a new one when a device acts up.
        </p>
      ) : (
        <>
          <Link
            href={`/diagnostics/${session.id}`}
            className="flex items-center gap-2 text-sm font-medium text-slate-100 hover:text-cyan-200"
          >
            <FlaskConical className="size-4 text-cyan-300" aria-hidden />
            Continue: {sessionDeviceLabel(session)}
            <ArrowRight className="size-4 text-slate-500" aria-hidden />
          </Link>
          <p className="mt-1 truncate text-xs text-slate-500">{session.symptoms}</p>
        </>
      )}
    </WidgetShell>
  );
}

export function TechnicianShortcutWidget({ sessions }: { sessions: MySessionItem[] }) {
  const flagged = sessions.filter((s) => sessionTechnicianSignal(s) != null);
  const top = flagged[0] ?? null;
  const critical = top?.safety_state === "critical_stop";
  return (
    <WidgetShell label="Find a Technician">
      <Link
        href="/technicians"
        className="flex items-center gap-2 text-sm font-medium text-slate-100 hover:text-cyan-200"
      >
        <UserSearch className="size-4 text-cyan-300" aria-hidden />
        {top == null ? "Browse local technicians" : `Recommended for ${sessionDeviceLabel(top)}`}
        <ArrowRight className="size-4 text-slate-500" aria-hidden />
      </Link>
      {top == null ? (
        <p className="mt-1 text-xs text-slate-500">
          No diagnosis needs a human right now — your sessions are progressing.
        </p>
      ) : (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
          <Badge variant={critical ? "danger" : "warning"}>
            {critical ? "Critical stop" : "Tests exhausted"}
          </Badge>
          {flagged.length > 1 ? `+${flagged.length - 1} more stalled` : sessionDeviceLabel(top)}
        </p>
      )}
    </WidgetShell>
  );
}

export interface PartsHint {
  sessionId: string;
  deviceLabel: string;
  acceptedCount: number;
}

export function PartsHintWidget({ hint }: { hint: PartsHint | null }) {
  return (
    <WidgetShell label="Parts Advisor">
      {hint == null ? (
        <p className="text-sm text-slate-400">
          No accepted parts yet — suggested parts appear inside each diagnosis.
        </p>
      ) : (
        <>
          <Link
            href={`/diagnostics/${hint.sessionId}`}
            className="flex items-center gap-2 text-sm font-medium text-slate-100 hover:text-cyan-200"
          >
            <Package className="size-4 text-cyan-300" aria-hidden />
            {hint.acceptedCount} accepted part{hint.acceptedCount === 1 ? "" : "s"} for{" "}
            {hint.deviceLabel}
            <ArrowRight className="size-4 text-slate-500" aria-hidden />
          </Link>
          <p className="mt-1 text-xs text-slate-500">
            Review them in the diagnosis workspace before ordering.
          </p>
        </>
      )}
    </WidgetShell>
  );
}

export function ShopShortcutWidget() {
  return (
    <WidgetShell label="Shop Workspace">
      <Link
        href="/shop"
        className="flex items-center gap-2 text-sm font-medium text-slate-100 hover:text-cyan-200"
      >
        <Store className="size-4 text-cyan-300" aria-hidden />
        Open Shop Workspace
        <ArrowRight className="size-4 text-slate-500" aria-hidden />
      </Link>
      <p className="mt-1 text-xs text-slate-500">
        Jobs, customers, and inventory live inside your shops.
      </p>
    </WidgetShell>
  );
}

export function ReportsShortcutWidget({ reportCount }: { reportCount: number | null }) {
  return (
    <WidgetShell label="Repair Reports">
      <Link
        href="/reports"
        className="flex items-center gap-2 text-sm font-medium text-slate-100 hover:text-cyan-200"
      >
        <FileText className="size-4 text-cyan-300" aria-hidden />
        {reportCount == null
          ? "Repair Reports"
          : reportCount === 0
            ? "No reports yet"
            : `${reportCount} report${reportCount === 1 ? "" : "s"}`}
        <ArrowRight className="size-4 text-slate-500" aria-hidden />
      </Link>
      <p className="mt-1 text-xs text-slate-500">
        {reportCount === 0
          ? "Reports compile automatically as diagnoses progress."
          : "Findings, evidence, and PDF downloads."}
      </p>
    </WidgetShell>
  );
}

export function ContextualShortcuts({
  sessions,
  reportCount,
  partsHint,
}: {
  sessions: MySessionItem[];
  reportCount: number | null;
  partsHint: PartsHint | null;
}) {
  return (
    <section aria-labelledby="shortcuts-title">
      <h2 id="shortcuts-title" className="text-sm font-semibold text-slate-200">
        Suggested next steps
      </h2>
      <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list">
        <NewDiagnosisWidget />
        <ContinueDiagnosisWidget session={latestActiveSession(sessions)} />
        <TechnicianShortcutWidget sessions={sessions} />
        <PartsHintWidget hint={partsHint} />
        <ShopShortcutWidget />
        <ReportsShortcutWidget reportCount={reportCount} />
      </ul>
    </section>
  );
}
