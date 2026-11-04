"use client";

import { AlertTriangle, OctagonX } from "lucide-react";
import type {
  EstimateStatus,
  JobEventKind,
  JobPriority,
  JobStatus,
  RepairEstimateItem,
  RepairJob,
  RepairJobEvent,
  SafetyState,
  ShopCustomer,
  ShopMemberRole,
} from "@fieldfix/contracts";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/format";

/* Pure helpers and presentational components for the repair-shop
 * workspace. No data fetching here — pages pass rows in, so these
 * render on the server and stay unit-testable. */

export const ALL_JOB_STATUSES: JobStatus[] = [
  "received",
  "awaiting_diagnosis",
  "diagnosing",
  "awaiting_approval",
  "awaiting_parts",
  "in_repair",
  "testing",
  "completed",
  "ready_for_collection",
  "collected",
  "cancelled",
];

export const ACTIVE_JOB_STATUSES: JobStatus[] = [
  "received",
  "awaiting_diagnosis",
  "diagnosing",
  "awaiting_approval",
  "awaiting_parts",
  "in_repair",
  "testing",
];

export const TERMINAL_JOB_STATUSES: JobStatus[] = [
  "completed",
  "ready_for_collection",
  "collected",
  "cancelled",
];

export function jobStatusLabel(status: JobStatus): string {
  switch (status) {
    case "received":
      return "Received";
    case "awaiting_diagnosis":
      return "Awaiting diagnosis";
    case "diagnosing":
      return "Diagnosing";
    case "awaiting_approval":
      return "Awaiting approval";
    case "awaiting_parts":
      return "Awaiting parts";
    case "in_repair":
      return "In repair";
    case "testing":
      return "Testing";
    case "completed":
      return "Completed";
    case "ready_for_collection":
      return "Ready for collection";
    case "collected":
      return "Collected";
    case "cancelled":
      return "Cancelled";
  }
}

export function jobPriorityLabel(priority: JobPriority): string {
  switch (priority) {
    case "low":
      return "Low";
    case "normal":
      return "Normal";
    case "high":
      return "High";
    case "urgent":
      return "Urgent";
  }
}

export function estimateStatusLabel(status: EstimateStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "sent":
      return "Sent";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "converted":
      return "Converted";
  }
}

export function memberRoleLabel(role: ShopMemberRole): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "technician":
      return "Technician";
    case "front_desk":
      return "Front desk";
  }
}

export function jobEventKindLabel(kind: JobEventKind): string {
  switch (kind) {
    case "note":
      return "Note";
    case "status_change":
      return "Status change";
    case "assignment":
      return "Assignment";
    case "estimate":
      return "Estimate";
    case "inventory":
      return "Inventory";
  }
}

function jobStatusVariant(
  status: JobStatus,
): "default" | "secondary" | "success" | "warning" | "danger" | "muted" {
  switch (status) {
    case "received":
    case "awaiting_diagnosis":
      return "secondary";
    case "diagnosing":
    case "in_repair":
    case "testing":
      return "default";
    case "awaiting_approval":
    case "awaiting_parts":
      return "warning";
    case "completed":
    case "ready_for_collection":
    case "collected":
      return "success";
    case "cancelled":
      return "muted";
  }
}

function jobPriorityVariant(
  priority: JobPriority,
): "default" | "secondary" | "success" | "warning" | "danger" | "muted" {
  switch (priority) {
    case "low":
      return "muted";
    case "normal":
      return "secondary";
    case "high":
      return "warning";
    case "urgent":
      return "danger";
  }
}

function estimateStatusVariant(
  status: EstimateStatus,
): "default" | "secondary" | "success" | "warning" | "danger" | "muted" {
  switch (status) {
    case "draft":
      return "secondary";
    case "sent":
      return "default";
    case "approved":
      return "success";
    case "rejected":
      return "danger";
    case "converted":
      return "muted";
  }
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <Badge variant={jobStatusVariant(status)}>{jobStatusLabel(status)}</Badge>;
}

export function JobPriorityBadge({ priority }: { priority: JobPriority }) {
  return <Badge variant={jobPriorityVariant(priority)}>{jobPriorityLabel(priority)} priority</Badge>;
}

export function EstimateStatusBadge({ status }: { status: EstimateStatus }) {
  return <Badge variant={estimateStatusVariant(status)}>{estimateStatusLabel(status)}</Badge>;
}

export function MemberRoleBadge({ role }: { role: ShopMemberRole }) {
  return (
    <Badge variant={role === "owner" || role === "admin" ? "default" : "secondary"}>
      {memberRoleLabel(role)}
    </Badge>
  );
}

/** States that need a prominent hazard banner on the job. */
export function isHazardousSafetyState(state: SafetyState | null): boolean {
  return state === "critical_stop" || state === "caution";
}

export function SafetyWarningBanner({ state }: { state: SafetyState | null }) {
  if (state == null || !isHazardousSafetyState(state)) {
    return null;
  }
  const critical = state === "critical_stop";
  return (
    <div
      role="alert"
      className={
        critical
          ? "flex items-start gap-2 rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2.5"
          : "flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2.5"
      }
    >
      {critical ? (
        <OctagonX className="mt-0.5 size-4 shrink-0 text-red-300" aria-hidden />
      ) : (
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
      )}
      <div>
        <p
          className={
            critical ? "text-sm font-semibold text-red-200" : "text-sm font-semibold text-amber-200"
          }
        >
          {critical ? "Safety stop — do not power on" : "Caution — check safety guidance"}
        </p>
        <p className="mt-0.5 text-xs text-slate-300">
          The linked diagnostic session is flagged{" "}
          {critical ? "critical stop" : "caution"}. Open the session and follow its safety
          guidance before handling this device.
        </p>
      </div>
    </div>
  );
}

/** Group jobs by status for the kanban columns (stable column order). */
export function groupJobsByStatus(jobs: RepairJob[]): Array<{ status: JobStatus; jobs: RepairJob[] }> {
  return ALL_JOB_STATUSES.map((status) => ({
    status,
    jobs: jobs.filter((job) => job.status === status),
  }));
}

/** Job card: reference, fault, customer, assignee, status, last activity. */
export function JobCard({
  job,
  customerName,
  deviceLabel,
  hazardous,
  onOpen,
}: {
  job: RepairJob;
  customerName: string | null;
  deviceLabel: string | null;
  hazardous: boolean;
  onOpen: (job: RepairJob) => void;
}) {
  return (
    <li
      className={
        hazardous
          ? "rounded-xl border border-red-400/40 bg-panel p-3"
          : "rounded-xl border border-edge bg-panel p-3"
      }
    >
      <button
        type="button"
        onClick={() => onOpen(job)}
        className="flex w-full flex-col gap-1.5 text-left"
        aria-label={`Open job ${job.job_reference}`}
      >
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold text-slate-100">{job.job_reference}</span>
          <JobPriorityBadge priority={job.priority} />
          {hazardous && <Badge variant="danger">Hazard</Badge>}
        </span>
        <span className="line-clamp-2 text-sm text-slate-300">{job.reported_fault}</span>
        <span className="text-xs text-slate-400">
          {customerName ?? "Unknown customer"}
          {deviceLabel ? ` · ${deviceLabel}` : ""}
        </span>
        <span className="flex flex-wrap items-center justify-between gap-1.5">
          <JobStatusBadge status={job.status} />
          <span className="text-[11px] text-slate-500">
            {job.assignee_user_id ? "Assigned · " : ""}
            {formatRelativeTime(job.updated_at)}
          </span>
        </span>
      </button>
    </li>
  );
}

/** One timeline row: status transitions read as from → to with a timestamp. */
export function JobEventRow({ event }: { event: RepairJobEvent }) {
  return (
    <li className="flex flex-col gap-0.5 rounded-lg border border-edge bg-canvas px-3 py-2">
      <p className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-medium text-slate-200">{jobEventKindLabel(event.kind)}</span>
        {event.kind === "status_change" && event.from_status && event.to_status && (
          <span className="text-slate-400">
            {jobStatusLabel(event.from_status)} → {jobStatusLabel(event.to_status)}
          </span>
        )}
        <span className="ml-auto text-slate-500">{formatRelativeTime(event.created_at)}</span>
      </p>
      {event.body && <p className="text-sm text-slate-300">{event.body}</p>}
    </li>
  );
}

/** Customer row: reference, name, and contact line. */
export function CustomerRow({
  customer,
  deviceCount,
  onOpen,
}: {
  customer: ShopCustomer;
  deviceCount: number | null;
  onOpen: (customer: ShopCustomer) => void;
}) {
  return (
    <li className="rounded-xl border border-edge bg-panel p-3">
      <button
        type="button"
        onClick={() => onOpen(customer)}
        className="flex w-full flex-col gap-1 text-left"
        aria-label={`Open customer ${customer.reference}`}
      >
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold text-slate-100">{customer.reference}</span>
          <span className="text-sm text-slate-300">{customer.name}</span>
        </span>
        <span className="text-xs text-slate-500">
          {[customer.phone, customer.email].filter(Boolean).join(" · ") || "No contact details"}
          {deviceCount != null ? ` · ${deviceCount} device${deviceCount === 1 ? "" : "s"}` : ""}
        </span>
      </button>
    </li>
  );
}

export function formatCents(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function estimateItemsTotalCents(items: RepairEstimateItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unit_cents, 0);
}

export function estimateGrandTotalCents(args: {
  items: RepairEstimateItem[];
  labor_cents: number;
  other_cents: number;
}): number {
  return estimateItemsTotalCents(args.items) + args.labor_cents + args.other_cents;
}

export function isLowStock(quantity: number, lowThreshold: number): boolean {
  return quantity <= lowThreshold;
}
