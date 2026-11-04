"use client";

import { useEffect, useState } from "react";
import { Check, FileText, Package, RotateCcw, Wrench, X } from "lucide-react";
import type {
  PartRecommendation,
  RecommendationStatus,
  ToolRecommendation,
} from "@fieldfix/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  describeApiError,
  isAbortError,
  listPartRecommendationsApi,
  listToolRecommendationsApi,
  updatePartRecommendationApi,
  updateToolRecommendationApi,
} from "@/lib/api";
import { EmptyState } from "./empty-state";

export interface PartsLiveActions {
  sessionId: string;
  token: string;
  onChanged: () => void;
}

interface PartsPanelProps {
  live?: PartsLiveActions;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; parts: PartRecommendation[]; tools: ToolRecommendation[] }
  | { status: "error"; message: string };

function statusBadge(status: RecommendationStatus) {
  switch (status) {
    case "accepted":
      return <Badge variant="success">Accepted</Badge>;
    case "dismissed":
      return <Badge variant="muted">Dismissed</Badge>;
    default:
      return <Badge variant="secondary">Proposed</Badge>;
  }
}

/**
 * Parts and tools advisor, mounted inside the diagnostic workspace.
 * Live sessions list suggested replacement parts and tools with
 * compatibility notes and verbatim manual excerpts, and each
 * suggestion can be accepted or dismissed; demo mode shows an
 * honest placeholder and never calls the API.
 */
export function PartsPanel({ live }: PartsPanelProps) {
  if (!live) {
    return <PartsDemoCard />;
  }
  return <PartsLivePanel live={live} />;
}

function PartsDemoCard() {
  return (
    <Card aria-labelledby="parts-demo-title">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle id="parts-demo-title" className="flex items-center gap-2">
          <Package className="size-4 text-cyan-300" aria-hidden />
          Parts &amp; tools
        </CardTitle>
        <Badge variant="warning">Demo</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-slate-300">
          Live sessions list suggested replacement parts and tools here,
          each linked to a hypothesis or test with compatibility notes
          and manual excerpts.
        </p>
        <p className="text-xs text-slate-500">
          The demo never calls the parts API.
        </p>
      </CardContent>
    </Card>
  );
}

function PartsLivePanel({ live }: { live: PartsLiveActions }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadCounter, setReloadCounter] = useState(0);
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    setActionError(null);
    void Promise.all([
      listPartRecommendationsApi(live.sessionId, live.token, controller.signal),
      listToolRecommendationsApi(live.sessionId, live.token, controller.signal),
    ]).then(
      ([partsRes, toolsRes]) => {
        setState({
          status: "ready",
          parts: partsRes.recommendations,
          tools: toolsRes.recommendations,
        });
      },
      (err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) {
          return;
        }
        setState({ status: "error", message: describeApiError(err) });
      },
    );
    return () => controller.abort();
  }, [live.sessionId, live.token, reloadCounter]);

  const setStatus = (kind: "part" | "tool", id: string, status: "accepted" | "dismissed") => {
    if (actingId != null) {
      return;
    }
    setActingId(id);
    setActionError(null);
    const call =
      kind === "part"
        ? updatePartRecommendationApi(live.sessionId, id, live.token, { status })
        : updateToolRecommendationApi(live.sessionId, id, live.token, { status });
    void call.then(
      () => {
        setActingId(null);
        setState((prev) =>
          prev.status === "ready"
            ? {
                ...prev,
                parts:
                  kind === "part"
                    ? prev.parts.map((p) => (p.id === id ? { ...p, status } : p))
                    : prev.parts,
                tools:
                  kind === "tool"
                    ? prev.tools.map((t) => (t.id === id ? { ...t, status } : t))
                    : prev.tools,
              }
            : prev,
        );
        live.onChanged();
      },
      (err: unknown) => {
        setActingId(null);
        setActionError(describeApiError(err));
      },
    );
  };

  return (
    <Card aria-labelledby="parts-title">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle id="parts-title" className="flex items-center gap-2">
          <Package className="size-4 text-cyan-300" aria-hidden />
          Parts &amp; tools
        </CardTitle>
        <Badge variant="default">Live</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {actionError != null && (
          <p role="alert" className="text-xs text-red-300">
            Update failed: {actionError}
          </p>
        )}
        {state.status === "loading" && (
          <div role="status" aria-label="Loading recommendations" className="flex flex-col gap-2">
            <p className="text-xs text-slate-500">Loading recommendations…</p>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
        {state.status === "error" && (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-sm text-slate-300">
              Couldn&apos;t load recommendations: {state.message}
            </p>
            <Button type="button" size="sm" onClick={() => setReloadCounter((n) => n + 1)}>
              <RotateCcw aria-hidden />
              Retry
            </Button>
          </div>
        )}
        {state.status === "ready" && (
          <>
            <section aria-labelledby="parts-list-title">
              <h3 id="parts-list-title" className="text-sm font-medium text-slate-200">
                Recommended parts
              </h3>
              <div className="mt-2">
                {state.parts.length === 0 ? (
                  <EmptyState
                    icon={Package}
                    title="No part suggestions yet"
                    hint="Replacement parts linked to a hypothesis or test will appear here with compatibility notes."
                  />
                ) : (
                  <ul className="flex flex-col gap-3" role="list">
                    {state.parts.map((part) => (
                      <PartItem
                        key={part.id}
                        part={part}
                        busy={actingId === part.id}
                        actionsDisabled={actingId != null}
                        onAccept={() => setStatus("part", part.id, "accepted")}
                        onDismiss={() => setStatus("part", part.id, "dismissed")}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </section>
            <section aria-labelledby="tools-list-title">
              <h3 id="tools-list-title" className="text-sm font-medium text-slate-200">
                Recommended tools
              </h3>
              <div className="mt-2">
                {state.tools.length === 0 ? (
                  <EmptyState
                    icon={Wrench}
                    title="No tool suggestions yet"
                    hint="Tools for the diagnostic tests will appear here with any specification notes."
                  />
                ) : (
                  <ul className="flex flex-col gap-3" role="list">
                    {state.tools.map((tool) => (
                      <ToolItem
                        key={tool.id}
                        tool={tool}
                        busy={actingId === tool.id}
                        actionsDisabled={actingId != null}
                        onAccept={() => setStatus("tool", tool.id, "accepted")}
                        onDismiss={() => setStatus("tool", tool.id, "dismissed")}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface ItemActionsProps {
  status: RecommendationStatus;
  busy: boolean;
  actionsDisabled: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}

function ItemActions({ status, busy, actionsDisabled, onAccept, onDismiss }: ItemActionsProps) {
  if (status !== "proposed") {
    return null;
  }
  return (
    <div className="mt-2 flex gap-2">
      <Button type="button" size="sm" variant="secondary" disabled={actionsDisabled} onClick={onAccept}>
        <Check aria-hidden />
        {busy ? "Saving…" : "Accept"}
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={actionsDisabled} onClick={onDismiss}>
        <X aria-hidden />
        Dismiss
      </Button>
    </div>
  );
}

function PartItem({
  part,
  busy,
  actionsDisabled,
  onAccept,
  onDismiss,
}: {
  part: PartRecommendation;
  busy: boolean;
  actionsDisabled: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const detail = [part.part_number, part.manufacturer].filter((v) => v != null).join(" · ");
  return (
    <li className="rounded-lg border border-edge bg-canvas p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-100">{part.part_name}</p>
        {statusBadge(part.status)}
      </div>
      {detail !== "" && <p className="mt-1 text-xs text-slate-400">{detail}</p>}
      {part.model_compat != null && (
        <p className="mt-1 text-xs text-slate-400">
          <span className="font-medium text-slate-300">Compatibility:</span> {part.model_compat}
        </p>
      )}
      <p className="mt-1 text-[11px] text-slate-500">
        {part.hypothesis_id != null ? "Linked to a hypothesis" : "Linked to a diagnostic test"}
      </p>
      {part.excerpt != null && (
        <figure className="mt-2">
          <figcaption className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
            <FileText className="size-3" aria-hidden />
            Manual excerpt
          </figcaption>
          <blockquote className="mt-1 border-l-2 border-cyan-400/50 pl-3 text-sm text-slate-200 italic">
            &ldquo;{part.excerpt}&rdquo;
          </blockquote>
        </figure>
      )}
      <ItemActions
        status={part.status}
        busy={busy}
        actionsDisabled={actionsDisabled}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />
    </li>
  );
}

function ToolItem({
  tool,
  busy,
  actionsDisabled,
  onAccept,
  onDismiss,
}: {
  tool: ToolRecommendation;
  busy: boolean;
  actionsDisabled: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <li className="rounded-lg border border-edge bg-canvas p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-100">
          <Wrench className="size-3.5 text-slate-400" aria-hidden />
          {tool.tool_name}
        </p>
        {statusBadge(tool.status)}
      </div>
      {tool.spec != null && <p className="mt-1 text-xs text-slate-400">{tool.spec}</p>}
      <p className="mt-1 text-[11px] text-slate-500">
        {tool.test_id != null ? "Linked to a diagnostic test" : "General suggestion"}
      </p>
      {tool.chunk_id != null && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
          <FileText className="size-3" aria-hidden />
          References a service-manual passage.
        </p>
      )}
      <ItemActions
        status={tool.status}
        busy={busy}
        actionsDisabled={actionsDisabled}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />
    </li>
  );
}
