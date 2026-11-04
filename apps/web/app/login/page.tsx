"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, describeApiError, resendConfirmationApi } from "@/lib/api";
import { MfaRequiredError, useAuth } from "@/lib/auth";

const inputClass =
  "w-full rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { signIn, completeMfaSignIn, rememberedEmail } = useAuth();
  const [email, setEmail] = useState(rememberedEmail);
  // No password state: the field is uncontrolled so React never overwrites
  // manager autofill; submit reads DOM truth via FormData below.
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resent, setResent] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const next = params.get("next") || "/dashboard";
  const notice = params.get("notice");

  useEffect(() => {
    // Prefill the last remembered email without clobbering typed input.
    setEmail((current) => current || rememberedEmail);
  }, [rememberedEmail]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    // DOM truth wins over React state so autofill that landed without an
    // onChange sync still submits correctly.
    const data = new FormData(event.currentTarget);
    const emailValue = String(data.get("email") ?? "").trim();
    const passwordValue = String(data.get("password") ?? "");
    setSubmitting(true);
    setError(null);
    setUnconfirmed(false);
    void signIn(emailValue, passwordValue, remember).then(
      () => router.push(next.startsWith("/") ? next : "/dashboard"),
      (err: unknown) => {
        setSubmitting(false);
        if (err instanceof MfaRequiredError) {
          setMfaToken(err.mfaToken);
          setMfaCode("");
          return;
        }
        setError(describeApiError(err));
        setUnconfirmed(err instanceof ApiError && err.code === "email_unconfirmed");
      },
    );
  };

  const submitMfa = (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || !mfaToken) {
      return;
    }
    setSubmitting(true);
    setError(null);
    void completeMfaSignIn(mfaToken, mfaCode.trim(), remember).then(
      () => router.push(next.startsWith("/") ? next : "/dashboard"),
      (err: unknown) => {
        setSubmitting(false);
        if (err instanceof ApiError && err.code === "invalid_challenge") {
          setMfaToken(null);
        }
        setError(describeApiError(err));
      },
    );
  };

  const resend = () => {
    if (!email.trim() || resent) {
      return;
    }
    setResent(true);
    void resendConfirmationApi(email.trim()).catch(() => undefined);
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
      </CardHeader>
      <CardContent>
        {mfaToken != null ? (
          <form onSubmit={submitMfa} className="flex flex-col gap-3">
            <p role="status" className="text-xs text-slate-300">
              Password accepted. Enter the 6-digit code from your authenticator app, or a
              backup code.
            </p>
            <div>
              <label htmlFor="login-mfa-code" className="text-xs font-medium text-slate-300">
                Two-factor code
              </label>
              <input
                id="login-mfa-code"
                name="code"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                required
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="123456 or xxxxx-xxxxx"
                className={`${inputClass} mt-1 tracking-widest`}
              />
            </div>
            {error != null && (
              <p role="alert" className="text-xs text-red-300">
                {error}
              </p>
            )}
            <Button type="submit" disabled={submitting}>
              {submitting ? "Verifying…" : "Verify & sign in"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setMfaToken(null);
                setError(null);
              }}
              className="text-left text-xs text-slate-400 underline"
            >
              Back to password sign-in
            </button>
          </form>
        ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          {notice === "confirm-email" && (
            <p
              role="status"
              className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs text-slate-200"
            >
              Account created — check your email for the confirmation link, then sign in.
            </p>
          )}
          {notice === "password-reset" && (
            <p
              role="status"
              className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-slate-200"
            >
              Password updated — sign in with your new password.
            </p>
          )}
          <div>
            <label htmlFor="login-email" className="text-xs font-medium text-slate-300">
              Email
            </label>
            <input
              id="login-email"
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
            id="login-password"
            name="password"
            autoComplete="current-password"
            required
            className={inputClass}
          />
          <label
            htmlFor="login-remember"
            className="flex cursor-pointer items-center gap-2 text-xs text-slate-300"
          >
            <input
              id="login-remember"
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="size-4 rounded border-edge-strong accent-cyan-400"
            />
            Remember me on this device
          </label>
          {error != null && (
            <p role="alert" className="text-xs text-red-300">
              {error}
            </p>
          )}
          {unconfirmed && (
            <p className="text-xs text-slate-300">
              No link yet?{" "}
              <button
                type="button"
                onClick={resend}
                disabled={resent}
                className="text-cyan-300 underline disabled:text-slate-500 disabled:no-underline"
              >
                {resent ? "Confirmation re-sent — check your inbox" : "Re-send confirmation email"}
              </button>
            </p>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-xs text-slate-400">
            <Link href="/forgot-password" className="text-cyan-300 underline">
              Forgot your password?
            </Link>
          </p>
          <p className="text-xs text-slate-400">
            New here?{" "}
            <Link href="/register" className="text-cyan-300 underline">
              Create an account
            </Link>
          </p>
        </form>
        )}
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
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
      <Suspense fallback={<Skeleton className="h-64 w-full max-w-sm" />}>
        <LoginForm />
      </Suspense>
      <Link href="/demo" className="text-xs text-slate-500 underline">
        Just looking? Explore the demo instead.
      </Link>
    </div>
  );
}
