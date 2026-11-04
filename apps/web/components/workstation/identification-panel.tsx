"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Cpu, ScanSearch } from "lucide-react";
import type { IdentificationResponse, IdentifyResponse } from "@fieldfix/contracts";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  describeApiError,
  getIdentificationApi,
  identifyEvidenceApi,
} from "@/lib/api";

export interface IdentificationState {
  status: "loading" | "idle" | "identifying" | "ready" | "error";
  identification: IdentificationResponse | null;
  warnings: string[];
  message: string | null;
  identify: () => void;
  retry: () => void;
}

/**
 * In-flight identification passes by session + file. Mounts that overlap
 * (StrictMode remounts, retries racing a pass) attach to the same
 * promise instead of firing duplicate vision + SAM calls.
 */
const identifyInflight = new Map<string, Promise<IdentifyResponse>>();

function autoIdentify(
  key: string,
  sessionId: string,
  fileId: string,
  token: string,
): Promise<IdentifyResponse> {
  const existing = identifyInflight.get(key);
  if (existing) {
    return existing;
  }
  // Own controller: the pass must survive the effect unmount that a
  // remount performs between the 404 read and the pass itself.
  const controller = new AbortController();
  const promise = identifyEvidenceApi(sessionId, fileId, token, controller.signal).finally(
    () => {
      if (identifyInflight.get(key) === promise) {
        identifyInflight.delete(key);
      }
    },
  );
  identifyInflight.set(key, promise);
  return promise;
}

/**
 * Visual identification for one live evidence image. Reads the latest
 * persisted pass on mount; with `auto` a missing pass starts
 * immediately instead of waiting for a button that no longer exists.
 * On success the caller should refresh segmentations — identification
 * localizes components into the shared annotation layer.
 */
export function useIdentification(
  sessionId: string,
  token: string,
  fileId: string,
  enabled = true,
  auto = false,
): IdentificationState {
  const [status, setStatus] = useState<IdentificationState["status"]>("loading");
  const [identification, setIdentification] = useState<IdentificationResponse | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    setMessage(null);
    void getIdentificationApi(sessionId, fileId, token, controller.signal).then(
      (res) => {
        setIdentification(res.identification);
        setStatus("ready");
      },
      (err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (err instanceof ApiError && err.code === "identification_not_found") {
          if (auto) {
            setStatus("identifying");
            setWarnings([]);
            void autoIdentify(`${sessionId}:${fileId}`, sessionId, fileId, token).then(
              (res) => {
                if (controller.signal.aborted) {
                  return;
                }
                setIdentification(res.identification);
                setWarnings(res.warnings);
                setStatus("ready");
              },
              (passError: unknown) => {
                if (controller.signal.aborted) {
                  return;
                }
                setMessage(describeApiError(passError));
                setStatus("error");
              },
            );
            return;
          }
          setIdentification(null);
          setStatus("idle");
          return;
        }
        setMessage(describeApiError(err));
        setStatus("error");
      },
    );
    return () => controller.abort();
  }, [sessionId, fileId, token, reload, enabled, auto]);

  const identify = useCallback(() => {
    if (!enabled) {
      return;
    }
    const controller = new AbortController();
    setStatus("identifying");
    setMessage(null);
    setWarnings([]);
    void identifyEvidenceApi(sessionId, fileId, token, controller.signal).then(
      (res) => {
        setIdentification(res.identification);
        setWarnings(res.warnings);
        setStatus("ready");
      },
      (err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setMessage(describeApiError(err));
        setStatus("error");
      },
    );
  }, [sessionId, fileId, token, enabled]);

  const retry = useCallback(() => setReload((n) => n + 1), []);

  return { status, identification, warnings, message, identify, retry };
}

/**
 * Broadcast when the selected photo gains (or loses) named components,
 * so the analysis buttons elsewhere on the page can demand attention.
 * The canvas owns the per-file hook; props cannot reach across the
 * workspace composition, hence a window event with a boolean detail.
 */
export const IDENTIFICATION_EVENT = "fieldfix:identification-ready";

/** True once the current photo has named components. */
export function useIdentificationReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const handler = (event: Event) => {
      setReady(
        (event as CustomEvent<{ ready?: boolean }>).detail?.ready === true,
      );
    };
    window.addEventListener(IDENTIFICATION_EVENT, handler);
    return () => window.removeEventListener(IDENTIFICATION_EVENT, handler);
  }, []);
  return ready;
}

/**
 * The analysis button earns its attention animation exactly when the
 * photo is identified, nothing has been diagnosed yet, and the button
 * is actionable.
 */
export function analysisAttention(input: {
  live: boolean;
  identificationReady: boolean;
  hypothesisCount: number;
  busy: boolean;
  blocked: boolean;
}): boolean {
  return (
    input.live &&
    input.identificationReady &&
    input.hypothesisCount === 0 &&
    !input.busy &&
    !input.blocked
  );
}

/**
 * Identification panel: device name, recognition framing, and the
 * suspected fault area as a visual hypothesis. Components themselves
 * are labelled graphically on the photo (circles, arrows, boxes) with
 * a tappable legend — never as a typed list.
 */
export function IdentificationPanel({
  state,
  onLocalized,
  labelledCount,
}: {
  state: IdentificationState;
  /** Refresh the shared annotation overlay after a pass localizes. */
  onLocalized: () => void;
  /** Distinct components outlined on the photo; named-but-unoutlined parts stay counted, not claimed. */
  labelledCount: number;
}) {
  const { status, identification, warnings, message } = state;
  const prevStatus = useRef(status);

  useEffect(() => {
    // Refresh the shared overlay only when a fresh pass completes —
    // not when a persisted identification loads on mount.
    if (prevStatus.current === "identifying" && status === "ready" && identification) {
      onLocalized();
    }
    prevStatus.current = status;
  }, [status, identification, onLocalized]);

  useEffect(() => {
    const ready =
      status === "ready" && (identification?.components.length ?? 0) > 0;
    window.dispatchEvent(
      new CustomEvent(IDENTIFICATION_EVENT, { detail: { ready } }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent(IDENTIFICATION_EVENT, { detail: { ready: false } }),
      );
    };
  }, [status, identification]);

  if (status === "loading" || status === "identifying" || status === "idle") {
    return (
      <div
        role="status"
        aria-label="Identifying components"
        className="flex items-center gap-2 rounded-lg border border-dashed border-cyan-400/40 bg-cyan-400/[0.04] p-3 text-xs text-slate-300"
      >
        <ScanSearch className="size-4 shrink-0 text-cyan-300 motion-safe:animate-pulse-soft" aria-hidden />
        {status === "loading"
          ? "Checking for a previous identification…"
          : "Identifying components automatically — names and outlines appear on the photo above."}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        className="flex flex-wrap items-center gap-2 rounded-md border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs text-slate-300"
        role="alert"
      >
        <span>Component identification failed: {message ?? "unknown error"}</span>
        <Button type="button" variant="secondary" size="sm" onClick={state.retry}>
          Retry
        </Button>
      </div>
    );
  }

  if (!identification) {
    // Unreachable in practice (ready always carries an identification),
    // kept so a missing pass can never render an empty panel.
    return (
      <div
        role="status"
        aria-label="Identifying components"
        className="flex items-center gap-2 rounded-lg border border-dashed border-cyan-400/40 bg-cyan-400/[0.04] p-3 text-xs text-slate-300"
      >
        <ScanSearch className="size-4 shrink-0 text-cyan-300 motion-safe:animate-pulse-soft" aria-hidden />
        Identifying components automatically — names and outlines appear on the photo above.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-slate-300 uppercase">
          <Cpu className="size-3.5 text-cyan-300" aria-hidden />
          Identified components
        </h3>
        {identification.device_name && (
          <span className="text-xs text-slate-400">· {identification.device_name}</span>
        )}
        <span className="rounded border border-edge bg-canvas px-1.5 py-0.5 text-[11px] text-slate-400">
          Recognition — not a diagnosis
        </span>
      </div>

      <p className="text-xs text-slate-400">
        {identification.components.length === 0
          ? "No components could be named confidently in this photo."
          : labelledCount === 0
            ? `${identification.components.length} component${identification.components.length === 1 ? "" : "s"} named, but none could be outlined on this photo — try a closer, brighter shot of the parts.`
            : `${identification.components.length} named · ${labelledCount} outlined on the photo above — tap a legend chip to isolate one.`}
      </p>

      {identification.suspected_fault_area && (
        <div
          className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2"
          role="note"
          aria-label="Potential fault area"
        >
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-200">
            <AlertTriangle className="size-3.5" aria-hidden />
            Potential fault area: {identification.suspected_fault_area.component_name}
          </p>
          <p className="mt-1 text-xs text-slate-300">{identification.suspected_fault_area.rationale}</p>
          <p className="mt-1 text-[11px] text-slate-500">
            A visual hypothesis only — it needs testing before any conclusion. It does not change
            the diagnosis.
          </p>
        </div>
      )}

      {warnings.length > 0 && (
        <p className="text-[11px] text-slate-500" role="status">
          {warnings.join(" ")}
        </p>
      )}
    </div>
  );
}
