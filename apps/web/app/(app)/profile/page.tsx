"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, FlaskConical, LogOut, Settings } from "lucide-react";
import { MfaSecurity } from "@/components/mfa-security";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isAbortError, myReportsApi, mySessionsApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function ProfilePage() {
  const { user, token, signOut } = useAuth();
  const router = useRouter();
  const [counts, setCounts] = useState<{ sessions: number; reports: number } | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }
    const controller = new AbortController();
    void Promise.all([mySessionsApi(token, controller.signal), myReportsApi(token, controller.signal)]).then(
      ([sessions, reports]) =>
        setCounts({ sessions: sessions.sessions.length, reports: reports.reports.length }),
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setCounts({ sessions: 0, reports: 0 });
        }
      },
    );
    return () => controller.abort();
  }, [token]);

  const initial = (user?.name.trim().charAt(0) || user?.email.charAt(0) || "?").toUpperCase();
  const memberSince = user ? new Date(user.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "";

  const onSignOut = () => {
    if (signingOut) {
      return;
    }
    setSigningOut(true);
    void signOut().then(
      () => router.push("/login"),
      () => router.push("/login"),
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-xl font-semibold tracking-tight text-slate-50">Profile</h1>

      <section aria-label="Account" className="rounded-xl border border-edge bg-panel p-5">
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 text-xl font-semibold text-cyan-200"
          >
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-slate-50">{user?.name ?? "…"}</p>
            <p className="truncate text-sm text-slate-400">{user?.email ?? "…"}</p>
            {memberSince && <p className="mt-0.5 text-xs text-slate-500">Member since {memberSince}</p>}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-edge bg-canvas p-3">
            {counts == null ? (
              <Skeleton className="h-12" />
            ) : (
              <>
                <p className="flex items-center gap-1.5 text-xs text-slate-400">
                  <FlaskConical className="size-3.5 text-cyan-300" aria-hidden />
                  Diagnoses
                </p>
                <p className="mt-1 text-2xl font-semibold text-slate-50">{counts.sessions}</p>
              </>
            )}
          </div>
          <div className="rounded-lg border border-edge bg-canvas p-3">
            {counts == null ? (
              <Skeleton className="h-12" />
            ) : (
              <>
                <p className="flex items-center gap-1.5 text-xs text-slate-400">
                  <FileText className="size-3.5 text-cyan-300" aria-hidden />
                  Reports
                </p>
                <p className="mt-1 text-2xl font-semibold text-slate-50">{counts.reports}</p>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" asChild>
            <Link href="/settings">
              <Settings aria-hidden />
              Account settings
            </Link>
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onSignOut} disabled={signingOut}>
            <LogOut aria-hidden />
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </section>

      <MfaSecurity token={token} />
    </div>
  );
}
