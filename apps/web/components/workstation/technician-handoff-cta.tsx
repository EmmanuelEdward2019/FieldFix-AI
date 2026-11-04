"use client";

import Link from "next/link";
import { ShieldAlert, UserSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { workspaceTechnicianSignal } from "@/lib/technician-handoff";

/**
 * Technician handoff call-to-action for the diagnostic workspace.
 * Renders nothing while a safe test remains. On critical_stop it
 * recommends professional help WITHOUT further DIY steps; when the
 * diagnosis stalls inconclusive it links the technician directory.
 */
export function TechnicianHandoffCta({
  safetyState,
  tests,
  hypotheses,
}: {
  safetyState: string;
  tests: Array<{ result: unknown; status: string }>;
  hypotheses: Array<{ status: string }>;
}) {
  const signal = workspaceTechnicianSignal({
    safety_state: safetyState,
    tests,
    hypotheses,
  });
  if (signal == null) {
    return null;
  }
  if (signal === "critical_stop") {
    return (
      <section
        aria-label="Recommended: professional help"
        className="rounded-xl border border-red-400/40 bg-red-400/[0.06] p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-red-400/15">
            <ShieldAlert className="size-5 text-red-300" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 basis-64">
            <h2 className="text-base font-semibold text-slate-50">
              Get professional help — don&apos;t attempt further repairs yourself
            </h2>
            <p className="mt-0.5 text-sm text-slate-300">
              This session is stopped for safety. A local technician can
              review the hazard and take over from here.
            </p>
          </div>
          <Button type="button" asChild>
            <Link href="/technicians">
              <UserSearch aria-hidden />
              Contact Technicians Near Me
            </Link>
          </Button>
        </div>
      </section>
    );
  }
  return (
    <section
      aria-label="Diagnosis stalled: contact a technician"
      className="rounded-xl border border-amber-400/40 bg-amber-400/[0.06] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-400/15">
          <UserSearch className="size-5 text-amber-300" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-base font-semibold text-slate-50">
            Stuck? A technician can take it from here
          </h2>
          <p className="mt-0.5 text-sm text-slate-300">
            Every safe test is done and nothing is verified yet. Share this
            diagnosis with a local technician instead of guessing.
          </p>
        </div>
        <Button type="button" variant="secondary" asChild>
          <Link href="/technicians">
            Contact Technicians Near Me
          </Link>
        </Button>
      </div>
    </section>
  );
}
