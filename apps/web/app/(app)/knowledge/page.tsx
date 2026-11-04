"use client";

import { useState } from "react";
import { BookOpen, FileText, RotateCcw, Search } from "lucide-react";
import type { KnowledgeSearchHit } from "@fieldfix/contracts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError, knowledgeSearchApi } from "@/lib/api";

function HitCard({ hit }: { hit: KnowledgeSearchHit }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-xl border border-edge bg-panel p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-edge bg-canvas">
          <FileText className="size-4 text-slate-300" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-100">{hit.document_title}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {[hit.heading, hit.page_number != null ? `Page ${hit.page_number}` : null]
              .filter(Boolean)
              .join(" · ") || "Reference"}
          </p>
          <p className={`mt-1.5 text-sm leading-relaxed text-slate-300 ${open ? "" : "line-clamp-3"}`}>
            {hit.excerpt}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-0 py-1 text-xs"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Show less" : "Read excerpt"}
          </Button>
        </div>
      </div>
    </li>
  );
}

export default function KnowledgePage() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KnowledgeSearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState("");
  const [error, setError] = useState<string | null>(null);

  const search = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    void knowledgeSearchApi({ query: trimmed, limit: 10 }).then(
      (res) => {
        setLoading(false);
        setHits(res.hits);
        setSearched(trimmed);
      },
      (err: unknown) => {
        setLoading(false);
        setError(describeApiError(err));
      },
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-50">Knowledge Centre</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          Search approved technical documents. Excerpts cite the real source and page.
        </p>
      </div>

      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search(query);
        }}
      >
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search manuals and guides…"
            aria-label="Search technical documents"
            className="w-full rounded-md border border-edge bg-panel py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500"
          />
        </div>
        <Button type="submit" disabled={loading || !query.trim()}>
          {loading ? "Searching…" : "Search"}
        </Button>
      </form>

      {error != null && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5" role="alert">
          <p className="text-sm text-slate-200">{error}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => search(query)}>
            <RotateCcw aria-hidden />
            Retry
          </Button>
        </div>
      )}

      {hits == null && !loading && error == null && (
        <div className="rounded-xl border border-dashed border-edge-strong p-8 text-center">
          <BookOpen className="mx-auto size-6 text-slate-500" aria-hidden />
          <p className="mt-2 text-sm text-slate-300">
            Search the library to find relevant procedures and specifications.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Only approved documents are indexed — every excerpt references its source.
          </p>
        </div>
      )}

      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="Searching">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}

      {hits != null && !loading && (
        <>
          <p className="text-xs text-slate-400" role="status">
            {hits.length === 0
              ? `No matches for "${searched}".`
              : `${hits.length} result${hits.length === 1 ? "" : "s"} for "${searched}".`}
          </p>
          <ul className="flex flex-col gap-2" role="list">
            {hits.map((hit) => (
              <HitCard key={hit.chunk_id} hit={hit} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
