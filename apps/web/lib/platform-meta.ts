"use client";

import { useEffect, useState } from "react";
import type { PublicMeta } from "@fieldfix/contracts";
import { publicMetaApi } from "./console";
import { isAbortError } from "./api";

export const DEFAULT_PLATFORM_NAME = "FieldFix AI";

/**
 * Public platform metadata (name, support contact, demo flag).
 * Fail-soft: null means "backend unreachable, use defaults".
 */
export function usePlatformMeta(): PublicMeta | null | undefined {
  const [meta, setMeta] = useState<PublicMeta | null | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    void publicMetaApi(controller.signal).then(
      (res) => {
        if (!controller.signal.aborted) {
          setMeta(res);
        }
      },
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setMeta(null);
        }
      },
    );
    return () => controller.abort();
  }, []);

  return meta;
}
