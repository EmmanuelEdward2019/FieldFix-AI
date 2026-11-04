import { cn } from "@/lib/utils";

/** SVG progress ring for diagnostic completion (tests recorded / total). */
export function ProgressRing({
  value,
  total,
  size = 44,
  label,
  className,
}: {
  value: number;
  total: number;
  size?: number;
  label: string;
  className?: string;
}) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = total <= 0 ? 0 : Math.min(1, Math.max(0, value / total));
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth="5"
          className="stroke-edge-strong"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className={ratio >= 1 ? "stroke-emerald-300" : "stroke-cyan-300"}
          style={{ transition: "stroke-dashoffset 400ms ease-out" }}
        />
      </svg>
      <span className="absolute text-[11px] font-semibold text-slate-200 tabular-nums">
        {value}/{total}
      </span>
    </span>
  );
}
