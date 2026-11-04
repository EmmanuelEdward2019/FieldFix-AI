"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { describeApiError, forgotPasswordApi } from "@/lib/api";

const inputClass =
  "w-full rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || sent) {
      return;
    }
    setSubmitting(true);
    setError(null);
    void forgotPasswordApi(email.trim()).then(
      () => {
        setSubmitting(false);
        setSent(true);
      },
      (err: unknown) => {
        setSubmitting(false);
        setError(describeApiError(err));
      },
    );
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <span className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-md border border-edge bg-panel">
          <Wrench className="size-4 text-cyan-300" aria-hidden />
        </span>
        <span className="text-sm font-semibold tracking-tight text-slate-50">FieldFix AI</span>
      </span>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p role="status" className="flex items-start gap-2 text-sm text-slate-200">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden />
              If an account uses {email.trim()}, a reset link is on its way (expires in 1
              hour).
            </p>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <div>
                <label htmlFor="forgot-email" className="text-xs font-medium text-slate-300">
                  Email
                </label>
                <input
                  id="forgot-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={`${inputClass} mt-1`}
                />
              </div>
              {error != null && (
                <p role="alert" className="text-xs text-red-300">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          )}
          <p className="mt-3 text-xs text-slate-400">
            <Link href="/login" className="text-cyan-300 underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
