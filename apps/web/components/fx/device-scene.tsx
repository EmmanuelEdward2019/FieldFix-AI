import { cn } from "@/lib/utils";

type DeviceKind = "laptop" | "desktop" | "smartphone";

/**
 * Line-art device illustration in a diagnostic targeting frame, with an
 * animated scan beam. Decorative only — always aria-hidden at call sites.
 */
export function DeviceScene({
  device,
  scanning = true,
  className,
}: {
  device: string;
  scanning?: boolean;
  className?: string;
}) {
  const kind: DeviceKind =
    device === "smartphone" ? "smartphone" : device === "desktop" ? "desktop" : "laptop";
  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-edge bg-canvas", className)}>
      <svg viewBox="0 0 200 140" className="block h-auto w-full" aria-hidden>
        {/* targeting corners */}
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-cyan-400/60">
          <path d="M8 24 V10 Q8 8 10 8 H24" fill="none" />
          <path d="M176 8 H190 Q192 8 192 10 V24" fill="none" />
          <path d="M8 116 V130 Q8 132 10 132 H24" fill="none" />
          <path d="M176 132 H190 Q192 132 192 130 V116" fill="none" />
        </g>
        {/* faint grid */}
        <g stroke="currentColor" strokeWidth="0.5" className="text-slate-500/25">
          {Array.from({ length: 9 }, (_, i) => (
            <line key={`v${i}`} x1={20 + i * 20} y1={8} x2={20 + i * 20} y2={132} />
          ))}
          {Array.from({ length: 6 }, (_, i) => (
            <line key={`h${i}`} x1={8} y1={20 + i * 20} x2={192} y2={20 + i * 20} />
          ))}
        </g>
        {kind === "laptop" && (
          <g>
            <rect x="55" y="38" width="90" height="58" rx="4" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-slate-300" />
            <rect x="63" y="46" width="74" height="34" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-cyan-300/70" />
            <circle cx="100" cy="53" r="2" fill="currentColor" className="text-amber-300" />
            <line x1="70" y1="62" x2="130" y2="62" stroke="currentColor" strokeWidth="1.5" className="text-cyan-300/40" />
            <line x1="70" y1="68" x2="118" y2="68" stroke="currentColor" strokeWidth="1.5" className="text-cyan-300/25" />
            <path d="M45 104 H155 L145 96 H55 Z" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-slate-300" />
            <rect x="88" y="97" width="24" height="5" rx="1" fill="currentColor" className="text-slate-500/50" />
          </g>
        )}
        {kind === "desktop" && (
          <g>
            <rect x="70" y="30" width="80" height="58" rx="4" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-slate-300" />
            <rect x="78" y="38" width="64" height="30" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-cyan-300/70" />
            <circle cx="100" cy="76" r="2" fill="currentColor" className="text-amber-300" />
            <line x1="100" y1="88" x2="100" y2="100" stroke="currentColor" strokeWidth="2.5" className="text-slate-300" />
            <line x1="84" y1="100" x2="116" y2="100" stroke="currentColor" strokeWidth="2.5" className="text-slate-300" />
            <rect x="48" y="44" width="14" height="56" rx="3" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400" />
            <circle cx="55" cy="52" r="1.6" fill="currentColor" className="text-emerald-300" />
            <rect x="138" y="60" width="14" height="40" rx="3" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400" />
          </g>
        )}
        {kind === "smartphone" && (
          <g>
            <rect x="78" y="22" width="44" height="96" rx="8" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-slate-300" />
            <line x1="92" y1="30" x2="108" y2="30" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-slate-500" />
            <rect x="85" y="38" width="30" height="56" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-cyan-300/70" />
            <circle cx="100" cy="52" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-300/80" />
            <line x1="90" y1="66" x2="110" y2="66" stroke="currentColor" strokeWidth="1.5" className="text-cyan-300/40" />
            <line x1="90" y1="72" x2="104" y2="72" stroke="currentColor" strokeWidth="1.5" className="text-cyan-300/25" />
            <line x1="90" y1="78" x2="108" y2="78" stroke="currentColor" strokeWidth="1.5" className="text-cyan-300/25" />
            <circle cx="100" cy="110" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-400" />
          </g>
        )}
        {/* marching ants selection box on the screen area */}
        <rect
          x={kind === "laptop" ? 63 : kind === "desktop" ? 78 : 85}
          y={kind === "laptop" ? 46 : 38}
          width={kind === "laptop" ? 74 : kind === "desktop" ? 64 : 30}
          height={kind === "laptop" ? 34 : kind === "desktop" ? 30 : 56}
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="5 4"
          className="text-amber-300/70 [animation:march_1.1s_linear_infinite]"
        />
      </svg>
      {scanning && (
        <div
          aria-hidden
          className="pointer-events-none absolute right-[4%] left-[4%] h-8 -translate-y-1/2 [animation:scan-y_2.8s_ease-in-out_infinite]"
          style={{
            background:
              "linear-gradient(to bottom, transparent, rgb(34 211 238 / 0.14) 45%, rgb(34 211 238 / 0.5) 50%, rgb(34 211 238 / 0.14) 55%, transparent)",
          }}
        />
      )}
    </div>
  );
}
