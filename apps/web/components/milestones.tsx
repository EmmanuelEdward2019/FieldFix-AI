"use client";

import { useEffect, useState } from "react";
import { Award } from "lucide-react";
import {
  MILESTONES,
  earnedMilestones,
  subscribeMilestones,
  type Milestone,
  type MilestoneEvent,
} from "@/lib/milestones";
import { cn } from "@/lib/utils";

/** Toast stack celebrating newly earned badges. Mount once per layout. */
export function MilestoneToasts() {
  const [toasts, setToasts] = useState<{ id: number; milestone: Milestone }[]>([]);
  useEffect(() => {
    let nextId = 1;
    return subscribeMilestones((milestone) => {
      const id = nextId++;
      setToasts((current) => [...current.slice(-2), { id, milestone }]);
      setTimeout(() => {
        setToasts((current) => current.filter((t) => t.id !== id));
      }, 5000);
    });
  }, []);
  if (toasts.length === 0) {
    return null;
  }
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-[70] flex w-72 flex-col gap-2"
    >
      {toasts.map(({ id, milestone }) => {
        const Icon = milestone.icon;
        return (
          <div
            key={id}
            className="pointer-events-auto flex items-center gap-3 rounded-xl border border-amber-400/40 bg-panel p-3 shadow-2xl [animation:fade-in_180ms_ease-out]"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/10">
              <Icon className="size-5 text-amber-300" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-wide text-amber-300 uppercase">
                Badge earned
              </p>
              <p className="truncate text-sm font-medium text-slate-100">{milestone.title}</p>
              <p className="truncate text-xs text-slate-400">{milestone.blurb}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Badge shelf for dashboards: earned badges lit, the rest dimmed. */
export function BadgeShelf({ scope }: { scope: string }) {
  const [earned, setEarned] = useState<MilestoneEvent[]>([]);
  useEffect(() => {
    setEarned(earnedMilestones(scope));
    return subscribeMilestones(() => setEarned(earnedMilestones(scope)));
  }, [scope]);
  if (earned.length === 0) {
    return null;
  }
  return (
    <section aria-label="Earned badges">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
        <Award className="size-4 text-amber-300" aria-hidden />
        Your badges
      </h2>
      <ul className="mt-2 flex flex-wrap gap-2" role="list">
        {MILESTONES.map((m) => {
          const has = earned.includes(m.event);
          const Icon = m.icon;
          return (
            <li
              key={m.event}
              title={has ? `${m.title} — ${m.blurb}` : `Locked: ${m.blurb}`}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
                has
                  ? "border-amber-400/40 bg-amber-400/10 text-slate-100"
                  : "border-edge bg-panel text-slate-500",
              )}
            >
              <Icon
                className={cn("size-4", has ? "text-amber-300" : "text-slate-600")}
                aria-hidden
              />
              {m.title}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
