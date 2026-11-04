"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DiagnosisWizard, type WizardStartInput } from "@/components/diagnosis-wizard";
import { Skeleton } from "@/components/ui/skeleton";
import { createSessionApi, describeApiError, uploadEvidenceApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { recordMilestone } from "@/lib/milestones";

function Wizard() {
  const router = useRouter();
  const params = useSearchParams();
  const { token, user } = useAuth();
  const initialDevice = (() => {
    const d = params.get("device");
    return d === "desktop" || d === "smartphone" || d === "laptop" ? d : "laptop";
  })();

  const [starting, setStarting] = useState(false);
  const [startStep, setStartStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const start = (input: WizardStartInput) => {
    if (!token || starting) {
      return;
    }
    setStarting(true);
    setStartStep(0);
    setError(null);
    const scope = user ? `user:${user.id}` : "guest";
    const run = async () => {
      const created = await createSessionApi(
        {
          device_type: input.device,
          manufacturer: input.manufacturer || undefined,
          model: input.model || undefined,
          operating_system: input.os || undefined,
          symptoms: input.symptoms,
          user_mode: input.userMode,
        },
        undefined,
        token,
      );
      setStartStep(1);
      recordMilestone(scope, "session_started");
      for (const file of input.files) {
        await uploadEvidenceApi(created.session.id, created.accessToken, file);
      }
      if (input.files.length > 0) {
        recordMilestone(scope, "evidence_added");
      }
      setStartStep(2);
      router.push(`/diagnostics/${created.session.id}`);
    };
    void run().then(undefined, (err: unknown) => {
      setStarting(false);
      setError(describeApiError(err));
    });
  };

  return (
    <DiagnosisWizard
      initialDevice={initialDevice}
      starting={starting}
      startStep={startStep}
      startError={error}
      startDisabled={!token}
      onStart={start}
    />
  );
}

export default function NewDiagnosisPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto mt-6 h-96 w-full max-w-3xl" />}>
      <Wizard />
    </Suspense>
  );
}
