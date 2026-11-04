import { BadgeCheck, Camera, ListChecks } from "lucide-react";

/**
 * FieldFix diagnosis flow inside a phone frame, styled after the monitor-app
 * reference shots: evidence photo with a scan beam, a popping checklist,
 * and a verified verdict. Decorative; described by the figure label.
 */
export function DiagnosisPhone() {
  return (
    <figure
      aria-label="Sample phone showing a FieldFix diagnosis: evidence scan, guided checklist, and a verified finding"
      className="mx-auto w-full max-w-63"
    >
      <div
        aria-hidden
        className="overflow-hidden rounded-[2rem] border-4 border-edge-strong bg-panel shadow-[0_24px_60px_-24px_rgb(0_0_0/0.7)]"
      >
        <div className="flex items-center justify-between px-5 pt-3 text-[10px] text-slate-400 tabular-nums">
          <span>7:32</span>
          <span className="flex items-center gap-1">
            <span className="flex items-end gap-px">
              <span className="h-1 w-0.5 rounded-full bg-slate-400" />
              <span className="h-1.5 w-0.5 rounded-full bg-slate-400" />
              <span className="h-2 w-0.5 rounded-full bg-slate-400" />
            </span>
            <span className="inline-block h-2 w-4 rounded-[3px] border border-slate-400" />
          </span>
        </div>

        <div className="flex items-center gap-2 px-4 pt-2">
          <span className="text-xs font-semibold tracking-tight text-slate-100">
            FieldFix AI
          </span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-px text-[10px] text-cyan-200">
            <span className="size-1.5 animate-pulse-soft rounded-full bg-cyan-300" />
            Diagnosing
          </span>
        </div>

        <div className="px-4 pt-3">
          <div className="relative overflow-hidden rounded-xl border border-edge bg-canvas">
            <div className="flex h-28 items-center justify-center bg-[radial-gradient(circle_at_50%_120%,rgb(34_211_238/0.18),transparent_60%)]">
              <Camera className="size-8 text-slate-500" />
            </div>
            <div className="pointer-events-none absolute right-[6%] left-[6%] h-6 -translate-y-1/2 animate-scan-y bg-[linear-gradient(to_bottom,transparent,rgb(34_211_238/0.14)_45%,rgb(34_211_238/0.5)_50%,rgb(34_211_238/0.14)_55%,transparent)]" />
            <div className="absolute top-2 left-2 flex items-center gap-1 rounded-md border border-amber-300/50 bg-canvas/80 px-1.5 py-0.5 text-[10px] text-amber-200">
              Charging port · region 2
            </div>
          </div>
        </div>

        <div className="px-4 pt-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-200">
            <ListChecks className="size-3.5 text-cyan-300" />
            Guided tests · 3 of 4
          </p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {[
              { text: "Inspect port for debris", delay: "0.2s" },
              { text: "Try a known-good cable", delay: "0.9s" },
              { text: "Measure 5V on VBUS", delay: "1.6s" },
            ].map((test) => (
              <li
                key={test.text}
                className="flex items-center gap-2 rounded-lg border border-edge bg-canvas px-2.5 py-1.5 text-[11px] text-slate-200"
              >
                <span
                  className="flex size-4 animate-tick-pop items-center justify-center rounded-full bg-emerald-400/15"
                  style={{ animationDelay: test.delay }}
                >
                  <BadgeCheck className="size-3 text-emerald-300" />
                </span>
                {test.text}
              </li>
            ))}
          </ul>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas">
            <div className="h-full w-3/4 rounded-full bg-cyan-300" />
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2">
            <BadgeCheck className="size-4 shrink-0 text-emerald-300" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-100">
                Hypothesis verified · 94%
              </p>
              <p className="truncate text-[10px] text-slate-400">
                Worn charging port — cited, manual p.42
              </p>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
