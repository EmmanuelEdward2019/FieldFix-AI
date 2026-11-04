"use client";

import { DEFAULT_PLATFORM_NAME, usePlatformMeta } from "@/lib/platform-meta";

/** Platform name from public metadata, with a static fallback. */
export function PlatformName({ className }: { className?: string }) {
  const meta = usePlatformMeta();
  return <span className={className}>{meta?.platform_name ?? DEFAULT_PLATFORM_NAME}</span>;
}

/** Support contact from public metadata; renders nothing when unavailable. */
export function SupportContact() {
  const meta = usePlatformMeta();
  if (!meta?.support_contact) {
    return null;
  }
  return <span>Support: {meta.support_contact}</span>;
}
