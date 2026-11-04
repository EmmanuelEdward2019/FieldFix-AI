import Link from "next/link";
import { FileCheck2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DemoSession } from "@/lib/demo-data";
import { ProgressRing } from "../fx/progress-ring";
import { humanize } from "./status-badges";

/**
 * Demo-mode report card. Completed guest runs get a sample summary of
 * their own recorded results (illustrative only, never a real report);
 * everything else keeps the honest placeholder + signup path.
 */
export function DemoReportCard({ session }: { session: DemoSession }) {
  const recorded = session.tests.filter((t) => t.result != null);
  const complete = session.tests.length > 0 && recorded.length === session.tests.length;

  return (
    <Card aria-labelledby="demo-report-title">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle id="demo-report-title">Repair report</CardTitle>
        <Badge variant="warning">Sample · unvalidated</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {session.tests.length > 0 && (
          <div className="flex items-center gap-3">
            <ProgressRing
              value={recorded.length}
              total={session.tests.length}
              label={`${recorded.length} of ${session.tests.length} sample tests recorded`}
            />
            <p className="text-sm text-slate-300">
              {complete
                ? "Sample workup complete — here is what you recorded."
                : `${recorded.length} of ${session.tests.length} sample tests recorded so far.`}
            </p>
          </div>
        )}
        {complete ? (
          <ul className="flex flex-col gap-2" role="list">
            {session.tests.map((t) => (
              <li
                key={t.id}
                className="flex items-start gap-2 rounded-lg border border-edge bg-canvas p-2.5 text-xs"
              >
                <FileCheck2 className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden />
                <span>
                  <span className="font-medium text-slate-100">{t.name}: </span>
                  <span className="text-slate-300">
                    {t.result_options.find((o) => o.value === t.result?.selected_option)?.label ??
                      t.result?.selected_option}
                  </span>
                  {t.result?.observation && (
                    <span className="block text-slate-400">“{t.result.observation}”</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">
            {session.hypotheses.length === 0
              ? "Run the sample analysis above to draft possible causes and tests."
              : "Record each recommended test result to complete this sample report."}
          </p>
        )}
        {session.hypotheses.length > 0 && (
          <p className="text-xs text-slate-500">
            Suspected causes:{" "}
            {session.hypotheses.map((h) => `${h.title} (${humanize(h.status)})`).join(" · ")}
          </p>
        )}
        <div>
          <Button type="button" size="sm" asChild>
            <Link href="/register">Create an account for verified reports</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
