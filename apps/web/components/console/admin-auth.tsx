"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AdminMe } from "@fieldfix/contracts";
import { consoleApi, consoleDownload, type ConsoleApi } from "@/lib/console";
import { isAbortError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface AdminAuthValue {
  loading: boolean;
  me: AdminMe | null;
  api: ConsoleApi | null;
  /** Authenticated binary fetch (report PDFs, evidence bytes). */
  download: ((path: string) => Promise<Blob>) | null;
  error: string | null;
  refresh: () => void;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

/**
 * Console authentication. Uses the signed-in user's login token with
 * role-based capabilities; there is no separate console credential.
 * Visitors without an admin-capable role land on the sign-in gate.
 */
export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const { status, token } = useAuth();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (status === "loading") {
      return;
    }
    if (!token) {
      setMe(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setError(null);
    void consoleApi(token)
      .me(controller.signal)
      .then(
        (identity) => {
          setMe(identity);
          setError(null);
        },
        (err: unknown) => {
          if (controller.signal.aborted || isAbortError(err)) {
            return;
          }
          setMe(null);
          setError(err instanceof Error ? err.message : "Admin verification failed.");
        },
      );
    return () => controller.abort();
  }, [status, token, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  const value = useMemo<AdminAuthValue>(
    () => ({
      loading: status === "loading" || (token != null && me == null && error == null),
      me,
      api: token && me ? consoleApi(token) : null,
      download: token && me ? (path: string) => consoleDownload(token, path) : null,
      error,
      refresh,
    }),
    [status, token, me, error, refresh],
  );
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthValue {
  const value = useContext(AdminAuthContext);
  if (!value) {
    throw new Error("useAdminAuth must be used inside AdminAuthProvider");
  }
  return value;
}

/** Capability check for navigation and action gating (UI only; backend enforces). */
export function useCan(capability: string): boolean {
  const { me } = useAdminAuth();
  return me?.capabilities.includes(capability) ?? false;
}
