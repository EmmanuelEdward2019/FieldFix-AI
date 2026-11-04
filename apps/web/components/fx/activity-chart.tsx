"use client";

import { useMemo } from "react";

/**
 * Session activity area chart: honest per-day counts over the trailing
 * 14 days, rendered as a cyan area sparkline. All values come from the
 * caller's real session list — never synthesized.
 */
export function ActivityChart({
  timestamps,
  label,
}: {
  timestamps: string[];
  label: string;
}) {
  const { points, total, peak } = useMemo(() => {
    const days: number[] = Array.from({ length: 14 }, () => 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const iso of timestamps) {
      const at = new Date(iso);
      if (Number.isNaN(at.getTime())) {
        continue;
      }
      const diffDays = Math.floor((today.getTime() - at.getTime()) / 86_400_000);
      if (diffDays >= 0 && diffDays < 14) {
        days[13 - diffDays] = (days[13 - diffDays] ?? 0) + 1;
      }
    }
    const max = Math.max(1, ...days);
    const pts = days.map((count, i) => ({
      x: 8 + (i * (296 - 16)) / 13,
      y: 76 - (count / max) * 60,
      count,
    }));
    return { points: pts, total: days.reduce((n, c) => n + c, 0), peak: max };
  }, [timestamps]);

  const line = points.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `8,84 ${line} 288,84`;

  return (
    <figure role="img" aria-label={`${label}: ${total} sessions in 14 days, peak ${peak} per day`}>
      <svg viewBox="0 0 296 96" className="block h-auto w-full" aria-hidden>
        <defs>
          <linearGradient id="ff-activity-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[20, 44, 68].map((y) => (
          <line key={y} x1="8" y1={y} x2="288" y2={y} strokeWidth="0.5" className="stroke-slate-500/25" />
        ))}
        <polygon points={area} fill="url(#ff-activity-fill)" />
        <polyline
          points={line}
          fill="none"
          stroke="#22d3ee"
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) =>
          p.count > 0 ? <circle key={i} cx={p.x} cy={p.y} r="2.4" fill="#22d3ee" /> : null,
        )}
        <text x="8" y="94" fontSize="8" className="fill-slate-500">
          14 days ago
        </text>
        <text x="288" y="94" fontSize="8" textAnchor="end" className="fill-slate-500">
          today
        </text>
      </svg>
    </figure>
  );
}
