"use client";

import { useId } from "react";

/** Minimal hand-rolled SVG charts (no dependency): vertical bars. */
export function Bars({
  data,
  height = 120,
  label,
}: {
  data: { label: string; value: number }[];
  height?: number;
  label: string;
}) {
  const id = useId();
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = Math.max(1, data.length * 22);
  return (
    <figure role="img" aria-label={label} className="overflow-x-auto">
      <svg
        width={width}
        height={height + 20}
        viewBox={`0 0 ${width} ${height + 20}`}
        aria-hidden
      >
        <title id={id}>{label}</title>
        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 3 : 0, (d.value / max) * height);
          return (
            <g key={d.label}>
              <rect
                x={i * 22 + 5}
                y={height - h}
                width={12}
                height={h}
                rx={2}
                className="fill-cyan-400/70"
              >
                <title>{`${d.label}: ${d.value}`}</title>
              </rect>
              {data.length <= 12 && (
                <text
                  x={i * 22 + 11}
                  y={height + 14}
                  textAnchor="middle"
                  fontSize={9}
                  className="fill-slate-500"
                >
                  {d.label.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Horizontal labeled bars for categorical breakdowns. */
export function HBars({ data, label }: { data: { label: string; value: number }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="flex flex-col gap-1.5" role="list" aria-label={label}>
      {data.map((d) => (
        <li key={d.label} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 truncate text-slate-400">{d.label}</span>
          <span className="h-3 min-w-0 flex-1 overflow-hidden rounded bg-canvas">
            <span
              className="block h-full rounded bg-cyan-400/70"
              style={{ width: `${Math.max(d.value > 0 ? 4 : 0, (d.value / max) * 100)}%` }}
              role="img"
              aria-label={`${d.label}: ${d.value}`}
            />
          </span>
          <span className="w-8 shrink-0 text-right text-slate-300 tabular-nums">{d.value}</span>
        </li>
      ))}
    </ul>
  );
}
