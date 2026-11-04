"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { DashboardShell } from "@/components/workstation/dashboard-shell";
import { useAuth } from "@/lib/auth";

export default function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { token, user } = useAuth();
  if (!token) {
    return null;
  }
  return (
    <div>
      <div className="mx-auto w-full max-w-[100rem] px-4 pt-3 sm:px-6">
        <Link
          href="/diagnostics"
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          All diagnoses
        </Link>
      </div>
      <DashboardShell
        mode="live"
        sessionId={id}
        token={token}
        milestoneScope={user ? `user:${user.id}` : undefined}
      />
    </div>
  );
}
