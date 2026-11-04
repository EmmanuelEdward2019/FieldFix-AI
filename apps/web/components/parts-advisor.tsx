"use client";

import { useState } from "react";
import { ExternalLink, FlaskConical, Lightbulb, Package, Store, Wrench } from "lucide-react";
import type {
  PartOffer,
  PartOffersResponse,
  PartRecommendation,
  RecommendationStatus,
  SupplierStockStatus,
  ToolRecommendation,
} from "@fieldfix/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError, isAbortError, partOffersApi } from "@/lib/api";
import { formatPrice, formatRelativeTime } from "@/lib/format";

export function RecommendationStatusBadge({ status }: { status: RecommendationStatus }) {
  switch (status) {
    case "accepted":
      return <Badge variant="success">Accepted</Badge>;
    case "dismissed":
      return <Badge variant="muted">Dismissed</Badge>;
    default:
      return <Badge variant="secondary">Proposed</Badge>;
  }
}

function EvidenceLine({ hypothesisId, testId }: { hypothesisId: string | null; testId: string | null }) {
  if (testId) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <FlaskConical className="size-3.5 shrink-0 text-cyan-300" aria-hidden />
        Grounded in a recorded diagnostic test
      </p>
    );
  }
  if (hypothesisId) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <Lightbulb className="size-3.5 shrink-0 text-cyan-300" aria-hidden />
        Linked to a fault hypothesis
      </p>
    );
  }
  return null;
}

function StatusActions({
  status,
  working,
  onSelect,
}: {
  status: RecommendationStatus;
  working: boolean;
  onSelect: (next: "accepted" | "dismissed") => void;
}) {
  if (status === "proposed") {
    return (
      <div className="flex gap-2">
        <Button size="sm" disabled={working} onClick={() => onSelect("accepted")}>
          Accept
        </Button>
        <Button size="sm" variant="outline" disabled={working} onClick={() => onSelect("dismissed")}>
          Dismiss
        </Button>
      </div>
    );
  }
  const next = status === "accepted" ? "dismissed" : "accepted";
  return (
    <Button size="sm" variant="ghost" disabled={working} onClick={() => onSelect(next)}>
      Mark {next}
    </Button>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-xs text-slate-400">
      <span className="font-medium text-slate-300">{label}:</span> {value}
    </p>
  );
}

function StockBadge({ status }: { status: SupplierStockStatus }) {
  switch (status) {
    case "in_stock":
      return <Badge variant="success">In stock</Badge>;
    case "out_of_stock":
      return <Badge variant="danger">Out of stock</Badge>;
    default:
      return <Badge variant="muted">Stock unknown</Badge>;
  }
}

function OfferRow({ offer }: { offer: PartOffer }) {
  const { product } = offer;
  return (
    <li className="flex flex-col gap-1 border-t border-edge py-2.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-2">
        <a
          href={product.product_url}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-cyan-200 underline-offset-2 hover:underline"
        >
          {product.name}
        </a>
        <StockBadge status={product.stock_status} />
      </div>
      <p className="text-xs text-slate-400">
        <span className="font-semibold text-slate-100">
          {formatPrice(product.price_cents, product.currency)}
        </span>
        {" · "}
        {offer.supplier_name}
        {product.last_seen_at && (
          <> · verified {formatRelativeTime(product.last_seen_at)}</>
        )}
      </p>
      <p className="text-[11px] text-slate-500">
        {offer.match_kind === "part_number"
          ? `Part no. match: ${offer.matched_terms.join(", ")}`
          : `Matches: ${offer.matched_terms.join(", ")}`}
      </p>
    </li>
  );
}

export function PartOffersSection({
  sessionId,
  recId,
  token,
}: {
  sessionId: string;
  recId: string;
  token: string;
}) {
  const [state, setState] = useState<
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "error"; message: string }
    | { phase: "ready"; data: PartOffersResponse }
  >({ phase: "idle" });

  function load() {
    setState({ phase: "loading" });
    const controller = new AbortController();
    void partOffersApi(sessionId, recId, token, controller.signal).then(
      (data) => setState({ phase: "ready", data }),
      (err: unknown) => {
        if (!isAbortError(err)) {
          setState({ phase: "error", message: describeApiError(err) });
        }
      },
    );
  }

  if (state.phase === "idle") {
    return (
      <Button size="sm" variant="outline" onClick={load}>
        <Store className="size-3.5" aria-hidden />
        Find suppliers
      </Button>
    );
  }
  if (state.phase === "loading") {
    return (
      <div role="status" aria-label="Loading supplier offers" className="flex flex-col gap-2">
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-red-300">{state.message}</p>
        <Button size="sm" variant="ghost" onClick={load}>
          Retry
        </Button>
      </div>
    );
  }
  const { data } = state;
  return (
    <div className="flex flex-col gap-2">
      {data.offers.length > 0 ? (
        <ul aria-label="Matched supplier listings">
          {data.offers.map((offer) => (
            <OfferRow key={offer.product.id} offer={offer} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">
          No live listing matches this part yet — check the stores directly:
        </p>
      )}
      {data.outbound_links.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {data.outbound_links.map((link) => (
            <a
              key={link.supplier_id}
              href={link.search_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-slate-400 underline-offset-2 hover:text-cyan-200 hover:underline"
            >
              {link.has_live_prices ? "Browse" : "Search"} {link.supplier_name}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function PartRecommendationCard({
  part,
  working,
  onStatus,
  sessionId,
  token,
}: {
  part: PartRecommendation;
  working: boolean;
  onStatus: (next: "accepted" | "dismissed") => void;
  sessionId?: string;
  token?: string;
}) {
  return (
    <article className="flex flex-col gap-2.5 rounded-lg border border-edge bg-panel p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Package className="size-4 shrink-0 text-cyan-300" aria-hidden />
          {part.part_name}
        </h3>
        <RecommendationStatusBadge status={part.status} />
      </div>
      {part.part_number && <Meta label="Part no." value={part.part_number} />}
      {part.manufacturer && <Meta label="Brand" value={part.manufacturer} />}
      {part.model_compat && <Meta label="Fits" value={part.model_compat} />}
      {part.excerpt && (
        <blockquote className="border-l-2 border-cyan-400/40 pl-2.5 text-xs text-slate-300 italic">
          {part.excerpt}
        </blockquote>
      )}
      <EvidenceLine hypothesisId={part.hypothesis_id} testId={part.test_id} />
      {sessionId && token && (
        <PartOffersSection sessionId={sessionId} recId={part.id} token={token} />
      )}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <p className="text-[11px] text-slate-500">{formatRelativeTime(part.created_at)}</p>
        <StatusActions status={part.status} working={working} onSelect={onStatus} />
      </div>
    </article>
  );
}

export function ToolRecommendationCard({
  tool,
  working,
  onStatus,
}: {
  tool: ToolRecommendation;
  working: boolean;
  onStatus: (next: "accepted" | "dismissed") => void;
}) {
  return (
    <article className="flex flex-col gap-2.5 rounded-lg border border-edge bg-panel p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Wrench className="size-4 shrink-0 text-cyan-300" aria-hidden />
          {tool.tool_name}
        </h3>
        <RecommendationStatusBadge status={tool.status} />
      </div>
      {tool.spec && <Meta label="Spec" value={tool.spec} />}
      <EvidenceLine hypothesisId={null} testId={tool.test_id} />
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <p className="text-[11px] text-slate-500">{formatRelativeTime(tool.created_at)}</p>
        <StatusActions status={tool.status} working={working} onSelect={onStatus} />
      </div>
    </article>
  );
}
