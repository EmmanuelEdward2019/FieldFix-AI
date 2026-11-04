"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, CircleAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError, verifyEmailApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { adoptSession } = useAuth();
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const token = params.get("token") ?? "";

  useEffect(() => {
    if (!token) {
      setState({ ok: false, message: "This confirmation link is missing its token." });
      return;
    }
    let cancelled = false;
    void verifyEmailApi(token).then(
      (result) => {
        if (cancelled) {
          return;
        }
        adoptSession(result.user, result.token);
        setState({ ok: true, message: `Welcome, ${result.user.name} — your email is confirmed.` });
        setTimeout(() => {
          if (!cancelled) {
            router.push("/dashboard");
          }
        }, 1200);
      },
      (err: unknown) => {
        if (!cancelled) {
          setState({ ok: false, message: describeApiError(err) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, adoptSession, router]);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Confirm your email</CardTitle>
      </CardHeader>
      <CardContent>
        {state == null && (
          <div className="flex flex-col gap-2" role="status" aria-label="Confirming">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}
        {state != null && (
          <div className="flex flex-col items-start gap-3">
            <p
              role={state.ok ? "status" : "alert"}
              className={`flex items-start gap-2 text-sm ${state.ok ? "text-emerald-300" : "text-red-300"}`}
            >
              {state.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
              ) : (
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              )}
              {state.message}
            </p>
            {state.ok ? (
              <p className="text-xs text-slate-400">Taking you to your dashboard…</p>
            ) : (
              <Button type="button" variant="secondary" size="sm" asChild>
                <Link href="/login">Back to sign in</Link>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <span className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-md border border-edge bg-panel">
          <Wrench className="size-4 text-cyan-300" aria-hidden />
        </span>
        <span className="text-sm font-semibold tracking-tight text-slate-50">FieldFix AI</span>
      </span>
      <Suspense fallback={<Skeleton className="h-48 w-full max-w-sm" />}>
        <VerifyForm />
      </Suspense>
    </div>
  );
}
