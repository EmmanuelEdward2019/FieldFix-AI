"use client";

import { useConsoleFetch } from "@/components/console/use-fetch";
import { PageError, Stat, StatSkeleton } from "@/components/console/widgets";
import { CheckCircle2, ClipboardList, FileCheck2, FlaskConical, Lightbulb, XCircle } from "lucide-react";

/** Measured quality indicators only — no invented accuracy percentages. */
export default function AdminQualityPage() {
  const { data, error, loading, reload } = useConsoleFetch((client, signal) => client.quality(signal));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-50">Diagnostic quality</h1>
      {error && <PageError message={error} onRetry={reload} />}
      {loading && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <StatSkeleton key={i} />
          ))}
        </div>
      )}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Stat icon={CheckCircle2} label="Sessions completed" value={data.sessions_completed} tone="text-emerald-300" />
            <Stat icon={XCircle} label="Sessions abandoned (7d)" value={data.sessions_abandoned_7d} tone="text-amber-300" />
            <Stat icon={ClipboardList} label="Tests proposed" value={data.tests_proposed} tone="text-cyan-300" />
            <Stat icon={FlaskConical} label="Results recorded" value={data.tests_recorded} tone="text-cyan-300" />
            <Stat icon={Lightbulb} label="Hypotheses" value={data.hypotheses.total} tone="text-cyan-300" />
            <Stat icon={FileCheck2} label="Reports generated" value={data.reports.total} tone="text-cyan-300" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Stat icon={Lightbulb} label="Hypotheses supported / weakened" value={`${data.hypotheses.supported} / ${data.hypotheses.weakened}`} tone="text-cyan-300" />
            <Stat icon={CheckCircle2} label="Hypotheses verified / ruled out" value={`${data.hypotheses.verified} / ${data.hypotheses.ruled_out}`} tone="text-emerald-300" />
            <Stat icon={FileCheck2} label="Reports with verified findings" value={data.reports.with_verified} tone="text-emerald-300" />
            <Stat icon={XCircle} label="AI validation failures" value={data.validation_failures} tone="text-red-300" />
          </div>
        </>
      )}
    </div>
  );
}
