"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordInput } from "@/components/ui/password-input";
import { describeApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const inputClass =
  "w-full rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500";

export default function RegisterPage() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && password !== confirm;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    void signUp(name.trim(), email.trim(), password).then(
      () => router.push("/login?notice=confirm-email"),
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
        <span className="text-sm font-semibold tracking-tight text-slate-50">
          FieldFix AI
        </span>
      </span>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create account</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div>
              <label htmlFor="register-name" className="text-xs font-medium text-slate-300">
                Name
              </label>
              <input
                id="register-name"
                name="name"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada T."
                maxLength={120}
                className={`${inputClass} mt-1`}
              />
            </div>
            <div>
              <label htmlFor="register-email" className="text-xs font-medium text-slate-300">
                Email
              </label>
              <input
                id="register-email"
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
            <PasswordInput
              label="Password"
              id="register-password"
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
              label="Confirm password"
              id="register-confirm"
              name="confirm-password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              className={inputClass}
              aria-invalid={mismatch}
              aria-describedby={mismatch ? "register-mismatch" : undefined}
            />
            {mismatch && (
              <p id="register-mismatch" role="alert" className="text-xs text-amber-300">
                Passwords do not match yet.
              </p>
            )}
            {error != null && (
              <p role="alert" className="text-xs text-red-300">
                {error}
              </p>
            )}
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating account…" : "Create account"}
            </Button>
            <p className="text-xs text-slate-400">
              Already have an account?{" "}
              <Link href="/login" className="text-cyan-300 underline">
                Sign in
              </Link>
            </p>
            <p className="text-xs text-slate-500">
              We&apos;ll email you a confirmation link to activate your account.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
