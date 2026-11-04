import { cn } from "@/lib/utils";

/**
 * Safety shield illustration: concentric pulse rings around a shield
 * emblem. Tones follow the safety state; decorative, aria-hidden.
 */
export function SafetyScene({
  tone,
  className,
}: {
  tone: "stop" | "warn" | "ok";
  className?: string;
}) {
  const ring = tone === "stop" ? "text-red-400" : tone === "warn" ? "text-amber-300" : "text-emerald-300";
  return (
    <svg
      viewBox="0 0 120 120"
      aria-hidden
      className={cn("block h-auto w-full", className)}
    >
      <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeWidth="1" className={cn(ring, "opacity-20")} />
      <circle
        cx="60"
        cy="60"
        r="54"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="40 300"
        strokeLinecap="round"
        className={cn(ring, "opacity-70 [animation:radar-sweep_3.2s_linear_infinite]")}
        style={{ transformOrigin: "60px 60px" }}
      />
      <circle cx="60" cy="60" r="42" fill="none" stroke="currentColor" strokeWidth="1" className={cn(ring, "opacity-30")} />
      <path
        d="M60 28 L88 40 V62 C88 80 76 92 60 98 C44 92 32 80 32 62 V40 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
        className={ring}
      />
      {tone === "stop" ? (
        <g stroke="currentColor" strokeWidth="4" strokeLinecap="round" className={ring}>
          <line x1="60" y1="52" x2="60" y2="68" />
          <circle cx="60" cy="78" r="2.4" fill="currentColor" stroke="none" />
        </g>
      ) : tone === "warn" ? (
        <g>
          <path
            d="M60 46 L74 72 H46 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
            className={ring}
          />
          <line x1="60" y1="58" x2="60" y2="64" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className={ring} />
          <circle cx="60" cy="68" r="1.5" fill="currentColor" className={ring} />
        </g>
      ) : (
        <path
          d="M48 62 L56 70 L73 52"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={ring}
        />
      )}
    </svg>
  );
}
