import type { CSSProperties } from "react";
import { BatteryMedium, Cpu, Thermometer } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Scrolling sensor waveform on a dotted grid, echoing the monitor-app
 * charts. Two identical copies scroll as one seamless loop.
 */
export function Waveform({
  className,
  stroke = "#34d399",
}: {
  className?: string;
  stroke?: string;
}) {
  const line =
    "M0 40 H52 L60 40 L66 16 L72 54 L78 40 H124 L132 40 L138 26 L144 48 L150 40 H196 L204 40 L208 32 L212 44 L216 40 H256";
  const strip = (hidden: boolean) => (
    <svg
      viewBox="0 0 256 64"
      className="h-16 w-64 shrink-0"
      aria-hidden={hidden || undefined}
    >
      <defs>
        <pattern id="ff-wave-dots" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1" className="fill-slate-500/40" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="256" height="64" fill="url(#ff-wave-dots)" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
  return (
    <div className={cn("overflow-hidden", className)} aria-hidden>
      <div className="flex w-max animate-wave-scroll">
        {strip(false)}
        {strip(true)}
      </div>
    </div>
  );
}

/** Gauge ring that fills to `percent` on mount. Decorative. */
export function Gauge({
  percent,
  size = 96,
  tone = "stroke-emerald-400",
  children,
}: {
  percent: number;
  size?: number;
  tone?: string;
  children: React.ReactNode;
}) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const target = circumference * (1 - Math.min(100, Math.max(0, percent)) / 100);
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth="8"
          className="stroke-edge-strong"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          className={cn("animate-ring-fill", tone)}
          style={{ "--ring-c": circumference, "--ring-target": target } as CSSProperties}
        />
      </svg>
      <span className="absolute flex flex-col items-center text-slate-100">{children}</span>
    </span>
  );
}

const CORES = [
  { label: "C1 · 2.80 GHz", from: 0.42, to: 0.62, duration: "2.2s", pct: "52%" },
  { label: "C2 · 2.80 GHz", from: 0.7, to: 0.92, duration: "3.1s", pct: "88%" },
  { label: "C3 · 2.02 GHz", from: 0.3, to: 0.48, duration: "2.6s", pct: "41%" },
  { label: "C4 · 2.02 GHz", from: 0.55, to: 0.75, duration: "2.9s", pct: "66%" },
  { label: "C5 · 2.02 GHz", from: 0.24, to: 0.4, duration: "2.4s", pct: "33%" },
  { label: "C6 · 3.19 GHz", from: 0.62, to: 0.85, duration: "3.4s", pct: "79%" },
];

/** Per-core usage bars that breathe between two widths. Decorative. */
function CoreBars() {
  return (
    <ul className="flex flex-col gap-2" aria-hidden>
      {CORES.map((core, i) => (
        <li key={core.label} className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[10px] text-slate-400 tabular-nums">
            {core.label}
          </span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-canvas">
            <span
              className="block h-full w-full origin-left animate-bar-pulse rounded-full bg-emerald-400"
              style={
                {
                  "--bar-from": core.from,
                  "--bar-to": core.to,
                  animationDuration: core.duration,
                  animationDelay: `${i * 0.35}s`,
                } as CSSProperties
              }
            />
          </span>
          <span className="w-8 shrink-0 text-right text-[10px] text-slate-300 tabular-nums">
            {core.pct}
          </span>
        </li>
      ))}
    </ul>
  );
}

const SUMMARY_ROWS = [
  { label: "Model", value: "Sample handset · 8-core" },
  { label: "System", value: "Android 14 · API 34" },
  { label: "Kernel", value: "5.15.123-android13" },
  { label: "Screen", value: "1080 × 2400 · 440 dpi" },
  { label: "Battery", value: "Health good · 4153 mV" },
];

/**
 * Widget cluster recreating the monitor-app visual language — gauges,
 * waveforms, core bars, and a detailed system summary — as live FieldFix
 * styling. All readings are illustrative samples, labelled as such.
 */
export function TelemetryDeck() {
  return (
    <figure aria-label="Sample device telemetry: processor gauge, sensor waveform, per-core usage, and system summary">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12" aria-hidden>
        <div className="flex items-center gap-4 rounded-xl border border-edge bg-panel p-4 md:col-span-5">
          <Gauge percent={62} tone="stroke-cyan-300">
            <span className="text-xl font-semibold tabular-nums">62%</span>
            <span className="text-[10px] tracking-wide text-slate-400 uppercase">CPU</span>
          </Gauge>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
              <Cpu className="size-3.5 text-cyan-300" />
              Octa-core · 3.19 GHz max
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full border border-edge bg-canvas px-2 py-0.5 text-[11px] text-slate-200">
                <Thermometer className="size-3 text-amber-300" />
                36°C
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-edge bg-canvas px-2 py-0.5 text-[11px] text-slate-200">
                <BatteryMedium className="size-3 text-emerald-300" />
                80%
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-200">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                </span>
                Live
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-edge bg-panel p-4 md:col-span-7">
          <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
            Gyroscope · x / y / z rad/s
          </p>
          <Waveform className="mt-2 rounded-lg border border-edge bg-canvas" />
        </div>

        <div className="rounded-xl border border-edge bg-panel p-4 md:col-span-7">
          <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
            Per-core usage
          </p>
          <div className="mt-2">
            <CoreBars />
          </div>
        </div>

        <div className="rounded-xl border border-edge bg-panel p-4 md:col-span-5">
          <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
            System summary
          </p>
          <dl className="mt-2 flex flex-col gap-1.5">
            {SUMMARY_ROWS.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3 text-xs">
                <dt className="shrink-0 text-slate-400">{row.label}</dt>
                <dd className="truncate text-right font-medium text-emerald-300">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <figcaption className="mt-2 text-xs text-slate-500">
        Sample telemetry for illustration — your readings render here during a live diagnosis.
      </figcaption>
    </figure>
  );
}
