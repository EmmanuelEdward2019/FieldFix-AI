"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, PackageSearch } from "lucide-react";
import type {
  MySessionItem,
  PartRecommendation,
  RecommendationStatus,
  ToolRecommendation,
} from "@fieldfix/contracts";
import {
  PartRecommendationCard,
  ToolRecommendationCard,
} from "@/components/parts-advisor";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  describeApiError,
  isAbortError,
  listPartRecommendationsApi,
  listToolRecommendationsApi,
  mySessionsApi,
  updatePartRecommendationApi,
  updateToolRecommendationApi,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tab = "parts" | "tools";
type StatusFilter = "all" | RecommendationStatus;

function sessionLabel(session: MySessionItem): string {
  const device = [session.manufacturer, session.model].filter(Boolean).join(" ").trim();
  const head = device ? `${session.device_type} · ${device}` : session.device_type;
  const symptoms = session.symptoms.length > 60 ? `${session.symptoms.slice(0, 60)}…` : session.symptoms;
  return `${head} — ${symptoms}`;
}

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "proposed", label: "Proposed" },
  { value: "accepted", label: "Accepted" },
  { value: "dismissed", label: "Dismissed" },
];

export default function PartsAdvisorPage() {
  const { token } = useAuth();
  const [sessions, setSessions] = useState<MySessionItem[] | null>(null);
  const [sessionId, setSessionId] = useState<string>("");
  const [tab, setTab] = useState<Tab>("parts");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [parts, setParts] = useState<PartRecommendation[] | null>(null);
  const [tools, setTools] = useState<ToolRecommendation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }
    const controller = new AbortController();
    void mySessionsApi(token, controller.signal).then(
      (res) => {
        setSessions(res.sessions);
        setSessionId((current) => current || res.sessions[0]?.id || "");
      },
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setSessions([]);
          setError(describeApiError(err));
        }
      },
    );
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!token || !sessionId) {
      return;
    }
    const controller = new AbortController();
    setParts(null);
    setTools(null);
    setError(null);
    const { signal } = controller;
    void Promise.all([
      listPartRecommendationsApi(sessionId, token, signal),
      listToolRecommendationsApi(sessionId, token, signal),
    ]).then(
      ([partRes, toolRes]) => {
        setParts(partRes.recommendations);
        setTools(toolRes.recommendations);
      },
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setParts([]);
          setTools([]);
          setError(describeApiError(err));
        }
      },
    );
    return () => controller.abort();
  }, [token, sessionId]);

  const setStatus = useCallback(
    (kind: Tab, id: string, next: "accepted" | "dismissed") => {
      if (!token || !sessionId || workingId) {
        return;
      }
      setWorkingId(id);
      setError(null);
      const call =
        kind === "parts"
          ? updatePartRecommendationApi(sessionId, id, token, { status: next })
          : updateToolRecommendationApi(sessionId, id, token, { status: next });
      void call.then(
        () => {
          setWorkingId(null);
          if (kind === "parts") {
            setParts((prev) => prev?.map((p) => (p.id === id ? { ...p, status: next } : p)) ?? null);
          } else {
            setTools((prev) => prev?.map((t) => (t.id === id ? { ...t, status: next } : t)) ?? null);
          }
        },
        (err: unknown) => {
          setWorkingId(null);
          setError(describeApiError(err));
        },
      );
    },
    [token, sessionId, workingId],
  );

  const visibleParts = (parts ?? []).filter((p) => filter === "all" || p.status === filter);
  const visibleTools = (tools ?? []).filter((t) => filter === "all" || t.status === filter);
  const loadingLists = parts == null || tools == null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50">Parts Advisor</h1>
          <p className="mt-1 text-sm text-slate-400">
            Parts and tools grounded in your diagnostic evidence. Accept what you need, dismiss
            what you don&apos;t.
          </p>
        </div>
        {sessionId && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/diagnostics/${sessionId}`}>
              Open in workspace <ArrowRight aria-hidden />
            </Link>
          </Button>
        )}
      </header>

      {sessions == null ? (
        <Skeleton className="h-10 w-full max-w-md" />
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-edge bg-panel p-6">
          <PackageSearch className="size-8 text-slate-500" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold text-slate-100">No diagnoses yet</h2>
            <p className="mt-1 text-sm text-slate-400">
              Recommendations appear here once a diagnosis produces part or tool suggestions.
            </p>
          </div>
          <Button asChild>
            <Link href="/diagnostics">Start a diagnosis</Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="parts-session" className="text-xs font-medium text-slate-300">
            Diagnosis
          </label>
          <select
            id="parts-session"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="w-full max-w-md rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {sessionLabel(session)} · {formatRelativeTime(session.created_at)}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}

      {sessions != null && sessions.length > 0 && (
        <>
          <div role="tablist" aria-label="Recommendation kind" className="flex gap-2">
            {(
              [
                { value: "parts", label: `Parts (${parts?.length ?? 0})` },
                { value: "tools", label: `Tools (${tools?.length ?? 0})` },
              ] as { value: Tab; label: string }[]
            ).map(({ value, label }) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  tab === value
                    ? "bg-cyan-400 text-slate-950"
                    : "bg-panel text-slate-300 hover:bg-slate-800",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div aria-label="Filter by status" className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  filter === value
                    ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                    : "border-edge text-slate-400 hover:text-slate-200",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {loadingLists ? (
            <div role="status" aria-label="Loading recommendations" className="flex flex-col gap-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : tab === "parts" ? (
            visibleParts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-edge p-6 text-center text-sm text-slate-400">
                {filter === "all"
                  ? "No part recommendations for this diagnosis yet."
                  : `No ${filter} parts for this diagnosis.`}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {visibleParts.map((part) => (
                  <PartRecommendationCard
                    key={part.id}
                    part={part}
                    working={workingId === part.id}
                    onStatus={(next) => setStatus("parts", part.id, next)}
                    sessionId={sessionId}
                    token={token ?? undefined}
                  />
                ))}
              </div>
            )
          ) : visibleTools.length === 0 ? (
            <p className="rounded-lg border border-dashed border-edge p-6 text-center text-sm text-slate-400">
              {filter === "all"
                ? "No tool recommendations for this diagnosis yet."
                : `No ${filter} tools for this diagnosis.`}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {visibleTools.map((tool) => (
                <ToolRecommendationCard
                  key={tool.id}
                  tool={tool}
                  working={workingId === tool.id}
                  onStatus={(next) => setStatus("tools", tool.id, next)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
