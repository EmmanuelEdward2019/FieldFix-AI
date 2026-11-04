"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CircleHelp, Cpu, ScanSearch } from "lucide-react";
import type { IdentificationResponse } from "@fieldfix/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  describeApiError,
  getIdentificationApi,
  identifyEvidenceApi,
} from "@/lib/api";
import { colorForLabel } from "./segmentation-layer";

export interface IdentificationState {
  status: "loading" | "idle" | "identifying" | "ready" | "error";
  identification: IdentificationResponse | null;
  warnings: string[];
  message: string | null;
  identify: () => void;
  retry: () => void;
}

/**
 * Visual identification for one live evidence image. Reads the latest
 * persisted pass on mount (a missing pass is idle, not an error);
 * `identify` runs a new vision + localization pass. On success the
 * caller should refresh segmentations — identification localizes
 * components into the shared annotation layer.
 */
export function useIdentification(
  sessionId: string,
  token: string,
  fileId: string,
  enabled = true,
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
          setIdentification(null);
          setStatus("idle");
          return;
        }
        setMessage(describeApiError(err));
        setStatus("error");
      },
    );
    return () => controller.abort();
  }, [sessionId, fileId, token, reload, enabled]);

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

function ConfidenceBadge({ level }: { level: string }) {
  switch (level) {
    case "high":
      return <Badge variant="success">High</Badge>;
    case "medium":
      return <Badge variant="secondary">Medium</Badge>;
    default:
      return <Badge variant="muted">Low</Badge>;
  }
}

/**
 * Identification panel: device name, identified components (select to
 * highlight on the photo), the suspected fault area framed as a
 * visual hypothesis, and regions the model could not name.
 */
export function IdentificationPanel({
  state,
  selectedLabel,
  onSelectLabel,
  onLocalized,
}: {
  state: IdentificationState;
  selectedLabel: string | null;
  onSelectLabel: (label: string | null) => void;
  /** Refresh the shared annotation overlay after a pass localizes. */
  onLocalized: () => void;
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

  if (status === "loading" || status === "identifying") {
    return (
      <div role="status" aria-label="Identifying components" className="text-xs text-slate-400">
        {status === "loading" ? "Checking for a previous identification…" : "Identifying components…"}
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

  if (status === "idle" || !identification) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={state.identify}
        >
          <ScanSearch aria-hidden />
          Identify components
        </Button>
        <span className="text-xs text-slate-500">
          Names the device and visible parts, then marks them on the photo.
        </span>
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={state.identify}
          className="ml-auto"
        >
          Re-run
        </Button>
      </div>

      {identification.components.length === 0 ? (
        <p className="text-xs text-slate-400">
          No components could be named confidently in this photo.
        </p>
      ) : (
        <ul aria-label="Identified components" className="flex flex-col gap-1" role="list">
          {identification.components.map((item) => {
            const selected = selectedLabel === item.name;
            return (
              <li key={`${item.name}-${item.confidence}`}>
                <button
                  type="button"
                  onClick={() => onSelectLabel(selected ? null : item.name)}
                  aria-pressed={selected}
                  title="Highlight on the photo"
                  className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                    selected
                      ? "border-cyan-400/40 bg-cyan-400/5 text-slate-100"
                      : "border-edge text-slate-300 hover:border-edge-strong hover:text-slate-100"
                  }`}
                >
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: colorForLabel(item.name) }}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                  <ConfidenceBadge level={item.confidence} />
                </button>
                {item.note && (
                  <p className="px-2 pt-0.5 pb-1 text-[11px] text-slate-500">{item.note}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

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

      {identification.unidentifiable.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <CircleHelp className="size-3.5" aria-hidden />
            Could not confidently identify
          </p>
          <ul className="mt-1 flex flex-col gap-0.5" role="list">
            {identification.unidentifiable.map((region) => (
              <li key={region} className="text-xs text-slate-500">
                · {region}
              </li>
            ))}
          </ul>
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
