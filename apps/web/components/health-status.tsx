"use client";

import { useEffect, useState } from "react";
import { healthResponseSchema } from "@fieldfix/contracts";
import { getApiBaseUrl } from "@/lib/env";
import { cn } from "@/lib/utils";

type State =
  | { kind: "loading" }
  | { kind: "ok"; version: string }
  | { kind: "error"; message: string };

export function HealthStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(`${getApiBaseUrl()}/health`, {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const parsed = healthResponseSchema.safeParse(await res.json());
        if (!parsed.success) {
          throw new Error("unexpected response shape");
        }
        if (!cancelled) {
          setState({ kind: "ok", version: parsed.data.version });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : "request failed",
          });
        }
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        aria-hidden
        className={cn(
          "inline-block size-2 rounded-full",
          state.kind === "ok" && "bg-emerald-400",
          state.kind === "loading" && "animate-pulse bg-slate-500",
          state.kind === "error" && "bg-red-400",
        )}
      />
      {state.kind === "loading" && (
        <span className="text-slate-300">Checking API…</span>
      )}
      {state.kind === "ok" && (
        <span className="text-slate-200">
          API connected <span className="text-slate-400">· v{state.version}</span>
        </span>
      )}
      {state.kind === "error" && (
        <span className="text-slate-200">
          API unreachable ({state.message}). Start it with{" "}
          <code className="rounded bg-slate-800 px-1 py-0.5 text-xs">
            npm run dev:api
          </code>
        </span>
      )}
    </div>
  );
}
