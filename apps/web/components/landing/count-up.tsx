"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Counts from 0 to `value` when scrolled into view. Server-rendered (and
 * no-JS) output shows the final value; reduced motion skips the count.
 */
export function CountUp({
  value,
  suffix = "",
  durationMs = 1200,
  className,
}: {
  value: number;
  suffix?: string;
  durationMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  const [display, setDisplay] = useState(value);

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (
      !el ||
      started.current ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    started.current = true;
    setDisplay(0);
    let raf = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        observer.disconnect();
        const t0 = performance.now();
        const frame = (now: number) => {
          const progress = Math.min(1, (now - t0) / durationMs);
          setDisplay(Math.round(value * (1 - Math.pow(1 - progress, 3))));
          if (progress < 1) {
            raf = requestAnimationFrame(frame);
          }
        };
        raf = requestAnimationFrame(frame);
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => {
      started.current = false;
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, durationMs]);

  return (
    <span ref={ref} className={className}>
      {display}
      {suffix}
    </span>
  );
}
