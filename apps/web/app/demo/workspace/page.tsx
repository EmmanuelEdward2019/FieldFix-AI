"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { DemoGate } from "@/components/demo-gate";
import { DashboardShell } from "@/components/workstation/dashboard-shell";
import { DashboardSkeleton } from "@/components/workstation/dashboard-skeleton";

function DemoWorkspace() {
  const params = useSearchParams();
  return (
    <DashboardShell
      mode="demo"
      initialSessionId={params.get("session") ?? undefined}
      initialDevice={params.get("device") ?? undefined}
    />
  );
}

/**
 * Guest diagnostic workspace: synthetic fixtures only, no API writes.
 * Deep-linkable from the demo dashboard (?session= / ?device=).
 */
export default function DemoWorkspacePage() {
  return (
    <DemoGate>
      <Suspense fallback={<DashboardSkeleton />}>
        <DemoWorkspace />
      </Suspense>
    </DemoGate>
  );
}
