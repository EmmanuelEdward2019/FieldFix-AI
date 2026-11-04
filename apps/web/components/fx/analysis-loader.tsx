"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Cpu,
  Gauge,
  Loader2,
  Plug,
  ThermometerSun,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { DeviceScene } from "./device-scene";

const TOOL_CYCLE: LucideIcon[] = [Wrench, Gauge, ThermometerSun, Cpu, Plug];

/**
 * Animated "analysis in progress" display: scanning device scene, radar
 * ring with cycling bench tools, and a staged checklist. Parents drive
 * `activeStep` from real progress (live) or the demo timeline (guest).
 * Simulated runs are always badged — never presented as live AI.
 */
export function AnalysisLoader({
  device,
  title,
  steps,
  activeStep,
  simulated = false,
  variant = "inline",
}: {
  device: string;
  title: string;
  steps: string[];
  activeStep: number;
  simulated?: boolean;
  variant?: "inline" | "overlay";
}) {
  const [toolIndex, setToolIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setToolIndex((i) => (i + 1) % TOOL_CYCLE.length), 1400);
    return () => clearInterval(timer);
  }, []);
  const ToolIcon = TOOL_CYCLE[toolIndex] ?? Wrench;
  const done = Math.min(activeStep, steps.length);
  const pct = steps.length === 0 ? 0 : Math.round((100 * done) / steps.length);

  const body = (
    <div
      role="status"
      aria-label={`${title}: stage ${Math.min(done + 1, steps.length)} of ${steps.length}`}
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-edge bg-panel p-4 sm:p-5",
        variant === "overlay" && "w-full max-w-md shadow-2xl",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="relative flex size-12 shrink-0 items-center justify-center">
          <span
            aria-hidden
            className="absolute inset-0 rounded-full [animation:radar-sweep_2.4s_linear_infinite]"
            style={{
              background:
                "conic-gradient(from 0deg, rgb(34 211 238 / 0.45), transparent 32%)",
            }}
          />
          <span aria-hidden className="absolute inset-0 rounded-full border border-cyan-400/30" />
          <span aria-hidden className="absolute inset-2 rounded-full border border-edge" />
          <ToolIcon className="relative size-5 text-cyan-300 [animation:float-y_3.6s_ease-in-out_infinite]" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-100">
            {title}
            {simulated ? (
              <Badge variant="warning">Simulated</Badge>
            ) : (
              <Badge variant="default">Live</Badge>
            )}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            {done >= steps.length ? "Wrapping up…" : steps[done] ?? "Working…"}
          </p>
        </div>
      </div>

      <DeviceScene device={device} />

      <div>
        <Progress value={pct} aria-label={`Analysis progress: ${pct} percent`} />
        <ol className="mt-2.5 flex flex-col gap-1.5" aria-label="Analysis stages">
          {steps.map((step, i) => (
            <li key={step} className="flex items-center gap-2 text-xs">
              {i < done ? (
                <Check className="size-3.5 shrink-0 text-emerald-300" aria-hidden />
              ) : i === done ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-cyan-300" aria-hidden />
              ) : (
                <span aria-hidden className="size-3.5 shrink-0 rounded-full border border-edge-strong" />
              )}
              <span className={i <= done ? "text-slate-200" : "text-slate-500"}>{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );

  if (variant === "overlay") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-sm [animation:fade-in_180ms_ease-out]">
        {body}
      </div>
    );
  }
  return body;
}
