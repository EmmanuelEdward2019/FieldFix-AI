"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronLeft, ChevronRight, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Overview stat card; links to its management page when href is set. */
export function Stat({
  icon: Icon,
  label,
  value,
  tone,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  tone: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="flex items-center gap-2 text-xs text-slate-400">
        <Icon className={cn("size-4", tone)} aria-hidden />
        {label}
      </p>
      <p className="mt-1 text-3xl font-semibold text-slate-50">{value}</p>
    </>
  );
  const cls = "rounded-xl border border-edge bg-panel p-4 text-left transition-colors";
  if (!href) {
    return <div className={cls}>{body}</div>;
  }
  return (
    <a href={href} className={cn(cls, "hover:border-cyan-400/40")}>
      {body}
    </a>
  );
}

export function StatSkeleton() {
  return <Skeleton className="h-24" role="status" aria-label="Loading" />;
}

export function PageError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5"
    >
      <p className="text-sm text-slate-200">{message}</p>
      {onRetry && (
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-edge-strong p-6 text-center">
      <SearchX className="mx-auto size-6 text-slate-500" aria-hidden />
      <p className="mt-2 text-sm text-slate-300">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export const PAGE_SIZE = 25;

export function Pagination({
  total,
  offset,
  onOffset,
}: {
  total: number;
  offset: number;
  onOffset: (next: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.floor(offset / PAGE_SIZE) + 1;
  if (total <= PAGE_SIZE) {
    return null;
  }
  return (
    <nav className="flex items-center gap-2 text-xs text-slate-400" aria-label="Pagination">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={offset <= 0}
        onClick={() => onOffset(Math.max(0, offset - PAGE_SIZE))}
        aria-label="Previous page"
      >
        <ChevronLeft aria-hidden />
      </Button>
      <span role="status">
        Page {Math.min(current, pages)} of {pages} · {total} total
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={offset + PAGE_SIZE >= total}
        onClick={() => onOffset(offset + PAGE_SIZE)}
        aria-label="Next page"
      >
        <ChevronRight aria-hidden />
      </Button>
    </nav>
  );
}

/** Compact labelled filter select. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-400">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-edge bg-panel px-2 py-1.5 text-xs text-slate-100"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const fieldCls =
  "rounded-md border border-edge-strong bg-canvas px-3 py-2 text-sm font-normal text-slate-100 placeholder:text-slate-500";

/** Native search input in the established app style. */
export function SearchInput({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="search"
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(fieldCls, className ?? "w-52")}
    />
  );
}

/** Native labelled text field in the established app style. */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  className,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
  className?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-slate-300">
      {label}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className={cn(fieldCls, className)}
      />
    </label>
  );
}

/** Native labelled textarea in the established app style. */
export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  rows = 2,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-slate-300">
      {label}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
        className={fieldCls}
      />
    </label>
  );
}

/** Two-click inline confirmation for privileged actions. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  busy,
  variant = "secondary",
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  variant?: "secondary" | "ghost";
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Button type="button" variant={variant} size="sm" onClick={() => setArmed(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5">
      <span className="text-xs text-amber-200">Sure?</span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {busy ? "…" : confirmLabel}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </span>
  );
}

const SUCCESS = new Set([
  "indexed",
  "succeeded",
  "success",
  "active",
  "approved",
  "ok",
  "normal",
  "ready",
  "enabled",
  "completed",
  "verified",
]);
const DANGER = new Set([
  "failed",
  "failure",
  "critical_stop",
  "suspended",
  "deactivated",
  "down",
  "rejected",
  "timeout",
  "denied",
  "error",
]);
const WARNING = new Set([
  "processing",
  "running",
  "pending",
  "queued",
  "review_required",
  "caution",
  "warning",
  "degraded",
  "restricted",
  "awaiting_test",
  "in_progress",
  "open",
  "archived",
]);

export function StatusBadge({ value }: { value: string }) {
  const v = value.toLowerCase();
  const variant = SUCCESS.has(v) ? "success" : DANGER.has(v) ? "danger" : WARNING.has(v) ? "warning" : "muted";
  return <Badge variant={variant}>{value.replace(/_/g, " ")}</Badge>;
}
