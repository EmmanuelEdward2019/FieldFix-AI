import Link from "next/link";
import { ArrowRight, BookOpenText, CircleCheck, CircleX, FileDown } from "lucide-react";

/**
 * Mini repair report: verified vs ruled-out findings plus a manual
 * citation, linking to the interactive demo for the full sample.
 */
export function ReportPreview() {
  return (
    <figure
      aria-label="Sample repair report separating a verified finding from a ruled-out cause, with a manual citation"
      className="overflow-hidden rounded-2xl border border-edge bg-panel"
    >
      <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
        <FileDown className="size-4 text-cyan-300" aria-hidden />
        <p className="text-sm font-semibold text-slate-100">Repair report</p>
        <span className="ml-auto rounded-full border border-edge bg-canvas px-2 py-0.5 text-[11px] text-slate-400">
          PDF · sample
        </span>
      </div>
      <ul className="flex flex-col gap-2 px-4 py-3" role="list">
        <li className="flex items-start gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/5 px-3 py-2">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden />
          <span>
            <span className="block text-xs font-semibold text-slate-100">
              Verified · Worn charging port
            </span>
            <span className="block text-[11px] text-slate-400">
              Confirmed by VBUS measurement · confidence 94%
            </span>
          </span>
        </li>
        <li className="flex items-start gap-2 rounded-xl border border-edge bg-canvas px-3 py-2">
          <CircleX className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden />
          <span>
            <span className="block text-xs font-semibold text-slate-200">
              Ruled out · Battery failure
            </span>
            <span className="block text-[11px] text-slate-400">
              Health good · 4153 mV under load
            </span>
          </span>
        </li>
        <li className="flex items-start gap-2 px-1 text-[11px] text-slate-400">
          <BookOpenText className="mt-0.5 size-3.5 shrink-0 text-cyan-300" aria-hidden />
          Cited: Service Manual §4.2, p.42 — port inspection procedure
        </li>
      </ul>
      <div className="border-t border-edge px-4 py-3">
        <Link
          href="/demo"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-300 underline"
        >
          Open the interactive sample
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </figure>
  );
}
