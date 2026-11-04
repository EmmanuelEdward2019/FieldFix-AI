import { BookOpen, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DemoCitation } from "@/lib/demo-data";
import { EmptyState } from "./empty-state";

interface ReferencePanelProps {
  citations: DemoCitation[];
  live?: boolean;
}

/** Source references with real excerpts and page numbers. */
export function ReferencePanel({ citations, live = false }: ReferencePanelProps) {
  return (
    <Card aria-labelledby="references-title">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle id="references-title">Source references</CardTitle>
          {citations.length > 0 && (
            <p className="mt-0.5 text-xs text-slate-400">
              {citations.length} manual passage{citations.length === 1 ? "" : "s"} consulted
              during diagnosis.
            </p>
          )}
        </div>
        {live ? (
          <Badge variant="default">Live</Badge>
        ) : (
          <Badge variant="warning">Demo docs · fictional</Badge>
        )}
      </CardHeader>
      <CardContent>
        {citations.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No citations yet"
            hint="Manual excerpts that support a hypothesis or test will be cited here with page references."
          />
        ) : (
          <ul className="flex flex-col gap-3" role="list">
            {citations.map((citation) => (
              <li
                key={citation.id}
                className="rounded-lg border border-edge bg-canvas p-3"
              >
                <p className="flex items-start gap-2 text-xs text-slate-400">
                  <FileText
                    className="mt-0.5 size-3.5 shrink-0"
                    aria-hidden
                  />
                  <span>
                    <span className="font-medium text-slate-200">
                      {citation.document_title}
                    </span>
                    {citation.page_number != null && (
                      <span> · p. {citation.page_number}</span>
                    )}
                  </span>
                </p>
                <blockquote className="mt-2 border-l-2 border-cyan-400/50 pl-3 text-sm text-slate-200 italic">
                  “{citation.excerpt}”
                </blockquote>
                {citation.note != null && (
                  <p className="mt-2 text-xs text-slate-400">{citation.note}</p>
                )}
                <p className="mt-2 text-[11px] text-slate-500">
                  Linked to{" "}
                  {citation.hypothesis_id != null
                    ? "a hypothesis"
                    : "a diagnostic test"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
