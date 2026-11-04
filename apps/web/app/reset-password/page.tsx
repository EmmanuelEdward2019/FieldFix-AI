"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError, resetPasswordApi } from "@/lib/api";

const inputClass =
  "w-full rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500";

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = params.get("token") ?? "";
  const mismatch = confirm.length > 0 && password !== confirm;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    if (!token) {
      setError("This reset link is missing its token. Request a fresh one.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    void resetPasswordApi({ token, new_password: password }).then(
      () => router.push("/login?notice=password-reset"),
      (err: unknown) => {
        setSubmitting(false);
        setError(describeApiError(err));
      },
    );
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <PasswordInput
            label="New password"
            id="reset-password"
            name="new-password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8+ characters"
            className={inputClass}
          />
          <PasswordInput
            label="Confirm new password"
            id="reset-confirm"
            name="confirm-password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat your password"
            className={inputClass}
            aria-invalid={mismatch}
          />
          {mismatch && (
            <p role="alert" className="text-xs text-amber-300">
              Passwords do not match yet.
            </p>
          )}
          {error != null && (
            <p role="alert" className="text-xs text-red-300">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Updating…" : "Update password"}
          </Button>
          <p className="text-xs text-slate-500">
            Reset links are single-use and expire after 1 hour. Updating signs you out
            everywhere.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <span className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-md border border-edge bg-panel">
          <Wrench className="size-4 text-cyan-300" aria-hidden />
        </span>
        <span className="text-sm font-semibold tracking-tight text-slate-50">FieldFix AI</span>
      </span>
      <Suspense fallback={<Skeleton className="h-64 w-full max-w-sm" />}>
        <ResetForm />
      </Suspense>
      <Link href="/login" className="text-xs text-slate-500 underline">
        Back to sign in
      </Link>
    </div>
  );
}
