"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Wrench } from "lucide-react";
import { DemoGate } from "@/components/demo-gate";
import { DiagnosisWizard, type WizardStartInput } from "@/components/diagnosis-wizard";
import { MilestoneToasts } from "@/components/milestones";
import { PlatformName } from "@/components/platform-brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SAMPLE_ANALYSIS_STEPS,
  buildGuestSession,
  saveGuestSession,
} from "@/lib/demo-runner";
import { recordMilestone } from "@/lib/milestones";
import { ThemeToggle } from "@/lib/theme";

const STEP_MS = 750;

function DemoWizard() {
  const router = useRouter();
  const params = useSearchParams();
  const initialDevice = (() => {
    const d = params.get("device");
    return d === "desktop" || d === "smartphone" || d === "laptop" ? d : "laptop";
  })();

  const [starting, setStarting] = useState(false);
  const [startStep, setStartStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingSession = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (timer.current) {
        clearInterval(timer.current);
      }
    },
    [],
  );

  // Navigates once the staged analysis finishes. Kept out of the step
  // updater because updater functions must stay pure — navigating there
  // updates the Router mid-render (React setState-in-render warning).
  useEffect(() => {
    if (
      !starting ||
      startStep < SAMPLE_ANALYSIS_STEPS.length ||
      pendingSession.current == null
    ) {
      return;
    }
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    const sessionId = pendingSession.current;
    pendingSession.current = null;
    router.push(`/demo/workspace?session=${sessionId}`);
  }, [starting, startStep, router]);

  const start = (input: WizardStartInput) => {
    if (starting) {
      return;
    }
    setStarting(true);
    setStartStep(0);
    setError(null);
    let sessionId: string;
    try {
      const session = buildGuestSession({
        device: input.device,
        category: input.category,
        manufacturer: input.manufacturer,
        model: input.model,
        operatingSystem: input.os,
        symptoms: input.symptoms,
        userMode: input.userMode,
        photos: input.files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
      });
      saveGuestSession(session);
      sessionId = session.id;
      recordMilestone("guest", "session_started");
      if (input.files.length > 0) {
        recordMilestone("guest", "evidence_added");
      }
    } catch (err) {
      setStarting(false);
      setError(err instanceof Error ? err.message : "Could not build the sample session.");
      return;
    }
    pendingSession.current = sessionId;
    timer.current = setInterval(() => {
      setStartStep((step) => step + 1);
    }, STEP_MS);
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-edge bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2.5 px-4 py-2.5 sm:px-6">
          <Button type="button" variant="ghost" size="sm" asChild>
            <Link href="/demo" aria-label="Back to demo home">
              <ArrowLeft aria-hidden />
              <Wrench className="size-4 text-cyan-300" aria-hidden />
            </Link>
          </Button>
          <PlatformName className="text-sm font-semibold tracking-tight text-slate-50" />
          <Badge variant="warning">Demo</Badge>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Button type="button" variant="ghost" size="sm" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button type="button" size="sm" asChild>
              <Link href="/register">Create account</Link>
            </Button>
          </div>
        </div>
      </header>
      <main aria-label="Sample diagnosis">
        <DiagnosisWizard
          initialDevice={initialDevice}
          demo
          starting={starting}
          startStep={startStep}
          startError={error}
          onStart={start}
        />
        <div className="mx-auto w-full max-w-3xl px-4 pb-8 sm:px-6">
          <p className="rounded-xl border border-edge bg-panel p-4 text-center text-sm text-slate-400">
            Like what you see?{" "}
            <Link href="/register" className="font-medium text-cyan-300 underline">
              Create a free account
            </Link>{" "}
            to diagnose real devices with live AI analysis, private evidence storage, and repair
            reports.
          </p>
        </div>
      </main>
      <MilestoneToasts />
    </div>
  );
}

export default function DemoNewPage() {
  return (
    <DemoGate>
      <Suspense fallback={<Skeleton className="mx-auto mt-6 h-96 w-full max-w-3xl" />}>
        <DemoWizard />
      </Suspense>
    </DemoGate>
  );
}
