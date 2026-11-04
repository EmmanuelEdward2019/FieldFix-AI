import Image from "next/image";
import { BadgeCheck } from "lucide-react";
import { ProgressRing } from "@/components/fx/progress-ring";
import { Waveform } from "./telemetry";

/**
 * Hero visual: a technician repairing a phone, with floating diagnosis
 * cards (verdict, live sensor trace, test progress) layered on top.
 */
export function HeroVisual() {
  return (
    <figure
      aria-label="A repair technician fixing a smartphone while FieldFix AI verifies the diagnosis"
      className="relative"
    >
      <div className="overflow-hidden rounded-3xl border border-edge">
        <Image
          src="/landing/technician-phone.jpg"
          alt="Repair technician's hands fixing an opened smartphone on a workbench, with a laptop showing diagnostics"
          width={1280}
          height={960}
          priority
          className="block h-auto w-full object-cover"
        />
      </div>

      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute top-3 left-3 flex animate-float-y items-center gap-1.5 rounded-full border border-edge bg-panel/95 px-2.5 py-1 text-[11px] font-medium text-slate-100 shadow-lg">
          <span className="size-1.5 animate-pulse-soft rounded-full bg-emerald-400" />
          Live diagnosis · Bench 3
        </div>

        <div
          className="absolute -right-2 bottom-16 hidden w-52 animate-float-y rounded-2xl border border-edge bg-panel/95 p-3 shadow-xl sm:block"
          style={{ animationDelay: "1.2s" }}
        >
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-100">
            <BadgeCheck className="size-3.5 text-emerald-300" />
            Hypothesis verified
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Charging port wear · <span className="text-slate-200 tabular-nums">94%</span>
          </p>
          <Waveform className="mt-2 rounded-lg border border-edge bg-canvas" stroke="#22d3ee" />
        </div>

        <div
          className="absolute -bottom-4 left-6 flex animate-float-y items-center gap-2.5 rounded-2xl border border-edge bg-panel/95 py-2 pr-4 pl-2 shadow-xl"
          style={{ animationDelay: "2.1s" }}
        >
          <ProgressRing value={7} total={8} size={46} label="7 of 8 guided tests recorded" />
          <div>
            <p className="text-[11px] font-semibold text-slate-100">Guided tests</p>
            <p className="text-[11px] text-slate-400">One safe step at a time</p>
          </div>
        </div>
      </div>
    </figure>
  );
}
