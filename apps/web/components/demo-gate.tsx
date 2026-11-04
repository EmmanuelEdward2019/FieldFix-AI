"use client";

import Link from "next/link";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PlatformName } from "@/components/platform-brand";
import { usePlatformMeta } from "@/lib/platform-meta";

/**
 * Gates the synthetic demo on the admin `demo_enabled` setting.
 * Fails open when the backend is unreachable (fixtures are local and
 * harmless); only an explicit `demo_enabled: false` blocks entry.
 */
export function DemoGate({ children }: { children: React.ReactNode }) {
  const meta = usePlatformMeta();

  if (meta === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-4 sm:p-6" role="status" aria-label="Loading demo">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (meta !== null && meta.demo_enabled === false) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 p-8 text-center">
        <ShieldX className="size-8 text-amber-300" aria-hidden />
        <h1 className="text-lg font-semibold text-slate-50">Demo unavailable</h1>
        <p className="text-sm text-slate-400">
          The guest demo for <PlatformName className="text-slate-200" /> is currently disabled by
          the administrator. Create an account to diagnose real devices.
        </p>
        <div className="flex gap-2">
          <Button type="button" asChild>
            <Link href="/register">Create account</Link>
          </Button>
          <Button type="button" variant="secondary" asChild>
            <Link href="/">Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
