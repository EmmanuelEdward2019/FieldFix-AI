"use client";

import { useEffect, useState } from "react";
import { describeApiError, isAbortError } from "@/lib/api";
import type { ConsoleApi } from "@/lib/console";
import { useAdminAuth } from "./admin-auth";

/** Fetch-once (plus manual reload) against the console API with abort safety. */
export function useConsoleFetch<T>(
  run: (api: ConsoleApi, signal: AbortSignal) => Promise<T>,
  deps: unknown[] = [],
): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const { api } = useAdminAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadCounter, setReloadCounter] = useState(0);
  // Serialize deps so callers can pass inline objects safely.
  const key = JSON.stringify([deps, reloadCounter]);

  useEffect(() => {
    if (!api) {
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void run(api, controller.signal).then(
      (res) => {
        setData(res);
        setLoading(false);
      },
      (err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) {
          return;
        }
        setError(describeApiError(err));
        setLoading(false);
      },
    );
    return () => controller.abort();
    // `key` stands in for deps+reload; `run` is intentionally stable per call site.
  }, [api, key]);

  return {
    data,
    error,
    loading,
    reload: () => setReloadCounter((n) => n + 1),
  };
}
