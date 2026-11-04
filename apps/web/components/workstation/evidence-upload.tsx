"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { describeApiError, uploadEvidenceApi } from "@/lib/api";
import {
  ACCEPTED_EVIDENCE_TYPES,
  EVIDENCE_TYPE_LABEL,
  validateEvidenceFile,
} from "@/lib/evidence-files";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

interface EvidenceUploadProps {
  sessionId: string;
  token: string;
  /** Client-side hint; the server limit is authoritative. */
  maxBytes?: number;
  onUploaded: () => void;
}

type UploadState =
  | { status: "idle" }
  | { status: "uploading"; fileName: string; loaded: number; total: number | null }
  | { status: "error"; message: string; file: File | null };

/** Drag-and-drop evidence upload with progress, cancel, and retry. */
export function EvidenceUpload({
  sessionId,
  token,
  maxBytes = 10 * 1024 * 1024,
  onUploaded,
}: EvidenceUploadProps) {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function startUpload(file: File, observation: string) {
    const problem = validateEvidenceFile(file, maxBytes);
    if (problem) {
      setState({ status: "error", message: problem, file });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "uploading", fileName: file.name, loaded: 0, total: file.size });
    void uploadEvidenceApi(sessionId, token, file, {
      observation: observation || undefined,
      signal: controller.signal,
      onProgress: ({ loaded, total }) =>
        setState({ status: "uploading", fileName: file.name, loaded, total }),
    }).then(
      () => {
        abortRef.current = null;
        setState({ status: "idle" });
        onUploaded();
      },
      (err: unknown) => {
        abortRef.current = null;
        if (controller.signal.aborted) {
          setState({ status: "idle" });
          return;
        }
        setState({ status: "error", message: describeApiError(err), file });
      },
    );
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file || state.status === "uploading") {
      return;
    }
    startUpload(file, note);
    setNote("");
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  const [note, setNote] = useState("");

  return (
    <div className="rounded-lg border border-edge bg-canvas p-3">
      <div
        role="button"
        tabIndex={state.status === "uploading" ? -1 : 0}
        aria-label="Upload evidence photo or video. Activate to choose a file, or drop a file here."
        aria-disabled={state.status === "uploading"}
        onClick={() => state.status !== "uploading" && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && state.status !== "uploading") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-dashed px-4 py-5 text-center transition-colors",
          dragging
            ? "border-cyan-400/60 bg-cyan-400/5"
            : "border-edge-strong hover:border-slate-500",
          state.status === "uploading" && "cursor-wait opacity-70",
        )}
      >
        <UploadCloud className="size-6 text-slate-400" aria-hidden />
        <p className="text-sm text-slate-200">
          Drop a photo or video here, or <span className="font-medium text-cyan-300">browse</span>
        </p>
        <p className="text-[11px] text-slate-500">
          {EVIDENCE_TYPE_LABEL} · up to {formatBytes(maxBytes)} · stored privately
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EVIDENCE_TYPES.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      <div className="mt-2">
        <label htmlFor={`upload-note-${sessionId}`} className="text-xs text-slate-400">
          Note with this photo <span className="text-slate-500">(optional)</span>
        </label>
        <input
          id={`upload-note-${sessionId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Close-up of the charging port"
          maxLength={8000}
          disabled={state.status === "uploading"}
          className="mt-1 w-full rounded-md border border-edge bg-panel px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 disabled:opacity-60"
        />
      </div>

      {state.status === "uploading" && (
        <div className="mt-3 flex items-center gap-2">
          <Loader2 className="size-4 shrink-0 animate-spin text-cyan-300" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-slate-300">
              Uploading {state.fileName} · {formatBytes(state.loaded)}
              {state.total != null ? ` of ${formatBytes(state.total)}` : ""}
            </p>
            <Progress
              value={
                state.total != null && state.total > 0
                  ? Math.round((state.loaded / state.total) * 100)
                  : 0
              }
              aria-label={`Upload progress for ${state.fileName}`}
              className="mt-1.5"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => abortRef.current?.abort()}
            aria-label="Cancel upload"
          >
            <X aria-hidden />
          </Button>
        </div>
      )}

      {state.status === "error" && (
        <div className="mt-3 flex items-start gap-2" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-amber-200">{state.message}</p>
            {state.file != null && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={() => startUpload(state.file as File, "")}
              >
                Retry upload
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
