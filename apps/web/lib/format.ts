/** Format a byte count as B / KB / MB with one decimal at most. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${trim(kb)} KB`;
  }
  return `${trim(kb / 1024)} MB`;
}

function trim(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Short relative time ("just now", "5m ago", "3h ago", "2d ago"). */
export function formatRelativeTime(iso: string, nowMs?: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "—";
  }
  const now = nowMs ?? Date.now();
  const diffMs = Math.max(0, now - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

/** Minor-unit price ("1200000", "NGN") as "₦12,000.00". Falls back to code + amount. */
export function formatPrice(priceCents: number | null, currency: string | null): string {
  if (priceCents === null || !Number.isFinite(priceCents) || priceCents < 0) {
    return "Price on site";
  }
  const amount = priceCents / 100;
  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
      }).format(amount);
    } catch {
      return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  }
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Full local date-time for tooltips and <time dateTime> titles. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
