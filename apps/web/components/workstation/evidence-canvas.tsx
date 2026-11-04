"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Eye,
  EyeOff,
  FileImage,
  FileVideo,
  ImagePlus,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError, fetchEvidenceBlob } from "@/lib/api";
import { formatBytes, formatRelativeTime } from "@/lib/format";
import type {
  DemoAnnotation,
  DemoEvidenceFile,
  DemoObservation,
} from "@/lib/demo-data";
import { legendLabels } from "@/lib/segmentation";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import { IdentificationPanel, useIdentification } from "./identification-panel";
import {
  SegmentationLabels,
  SegmentationLeaders,
  SegmentationLegend,
  SegmentationOverlay,
  labelCallouts,
  useSegmentations,
  type CalloutComponent,
} from "./segmentation-layer";
import { humanize, processingVariant } from "./status-badges";

export interface LiveEvidence {
  sessionId: string;
  token: string;
}

interface EvidenceCanvasProps {
  files: DemoEvidenceFile[];
  observations: DemoObservation[];
  deviceType: "laptop" | "desktop" | "smartphone";
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
  showAnnotations: boolean;
  onToggleAnnotations: () => void;
  /** Present for live sessions: private previews + upload UI. */
  live?: LiveEvidence;
  uploadSlot?: React.ReactNode;
}

const ZOOM_STEPS = [1, 1.25, 1.5, 2];

/**
 * Evidence canvas. Live sessions show real uploaded photos fetched with
 * the session token; demo sessions keep the labelled schematic drawing
 * so layout can be reviewed without implying real imagery.
 */
export function EvidenceCanvas({
  files,
  observations,
  deviceType,
  selectedFileId,
  onSelectFile,
  showAnnotations,
  onToggleAnnotations,
  live,
  uploadSlot,
}: EvidenceCanvasProps) {
  const [zoomIndex, setZoomIndex] = useState(0);
  const file = files.find((f) => f.id === selectedFileId) ?? files[0] ?? null;
  const zoom = ZOOM_STEPS[zoomIndex] ?? 1;
  const isVideo = file != null && (file.kind === "video" || file.media_type.startsWith("video/"));
  // Optional component localization for live photos only; demo sessions
  // keep their labelled schematic annotations below. Videos play back for
  // review — localization needs a still frame.
  const segmentation = useSegmentations(
    live?.sessionId ?? "",
    live?.token ?? "",
    file?.id ?? "",
    live != null && file != null && !isVideo,
  );
  const identification = useIdentification(
    live?.sessionId ?? "",
    live?.token ?? "",
    file?.id ?? "",
    live != null && file != null && !isVideo,
    // A photo without an identification starts its pass on its own —
    // there is no manual trigger. Videos and demos never auto-run.
    live != null && file != null && !isVideo,
  );
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  useEffect(() => {
    setSelectedLabel(null);
  }, [file?.id]);
  const liveAnnotationCount = live ? segmentation.annotations.length : file?.annotations.length ?? 0;
  // Instant beam: on from the first paint while vision + SAM work, off
  // once the pass settles. Videos never scan — no still frame to ground.
  const scanning =
    live != null &&
    !isVideo &&
    (identification.status === "loading" ||
      identification.status === "identifying" ||
      segmentation.status === "segmenting");
  const calloutComponents = identification.identification?.components ?? [];
  // Files that already received the vision-failure sweep. The identify
  // pass localizes names itself (plus a server-side generic sweep), so
  // the client sweep below only fires when vision itself failed.
  const sweepAttempted = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (live == null || file == null || isVideo) {
      return;
    }
    if (identification.status !== "error") {
      return;
    }
    if (segmentation.status !== "ready" || segmentation.annotations.length > 0) {
      return;
    }
    if (sweepAttempted.current.has(file.id)) {
      return;
    }
    sweepAttempted.current.add(file.id);
    segmentation.segment();
  }, [
    live,
    file,
    isVideo,
    identification.status,
    segmentation.status,
    segmentation.annotations.length,
    segmentation.segment,
  ]);

  return (
    <Card aria-labelledby="evidence-canvas-title">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold tracking-wide text-cyan-300 uppercase">
            Step 1 · Recognition — what FieldFix sees
          </p>
          <CardTitle id="evidence-canvas-title" className="mt-0.5">
            Evidence canvas
          </CardTitle>
          <p className="mt-0.5 text-xs text-slate-400">
            {live
              ? "Your uploaded photos and videos, stored privately. Components are named and outlined here; what might be wrong with them comes later, under Hypotheses."
              : "Demo illustration — a stand-in drawing, not device evidence."}
          </p>
        </div>
        {file != null && (
          <Badge variant={processingVariant(file.processing_status)}>
            {humanize(file.processing_status)}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {file == null ? (
          uploadSlot ?? (
            <EmptyState
              icon={ImagePlus}
              title="No evidence yet"
              hint="Uploaded device photos and annotated regions will appear here."
              scene={deviceType}
            />
          )
        ) : (
          <>
            <div className="overflow-hidden rounded-md border border-edge bg-canvas">
              <div className="max-h-[420px] overflow-auto">
                <div
                  className="relative transition-transform"
                  style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: `${100 / zoom}%` }}
                >
                  {live ? (
                    <LivePreview
                      sessionId={live.sessionId}
                      token={live.token}
                      file={file}
                    />
                  ) : (
                    <SchematicDrawing deviceType={deviceType} label={file.original_filename ?? file.storage_key} />
                  )}
                  {!live &&
                    showAnnotations &&
                    file.annotations.map((annotation) => (
                      <AnnotationOverlay
                        key={annotation.id}
                        annotation={annotation}
                      />
                    ))}
                  {live &&
                    showAnnotations &&
                    segmentation.imageWidth != null &&
                    segmentation.imageHeight != null && (
                      <>
                        <SegmentationOverlay
                          annotations={segmentation.annotations}
                          imageWidth={segmentation.imageWidth}
                          imageHeight={segmentation.imageHeight}
                          highlightLabel={selectedLabel}
                        />
                        <SegmentationLeaders
                          callouts={labelCallouts(
                            segmentation.annotations,
                            segmentation.imageWidth,
                            segmentation.imageHeight,
                            calloutComponents,
                          )}
                          imageWidth={segmentation.imageWidth}
                          imageHeight={segmentation.imageHeight}
                          highlightLabel={selectedLabel}
                        />
                        <SegmentationLabels
                          annotations={segmentation.annotations}
                          imageWidth={segmentation.imageWidth}
                          imageHeight={segmentation.imageHeight}
                          highlightLabel={selectedLabel}
                          components={calloutComponents}
                        />
                      </>
                    )}
                  {live && scanning && <ScanBeam />}
                </div>
              </div>
            </div>

            <div
              className="flex flex-wrap items-center gap-2"
              role="toolbar"
              aria-label="Evidence canvas controls"
            >
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
                disabled={zoomIndex === 0}
                aria-label="Zoom out"
              >
                <ZoomOut aria-hidden />
              </Button>
              <span
                className="min-w-12 text-center text-xs text-slate-400 tabular-nums"
                aria-live="polite"
              >
                {Math.round(zoom * 100)}%
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))
                }
                disabled={zoomIndex === ZOOM_STEPS.length - 1}
                aria-label="Zoom in"
              >
                <ZoomIn aria-hidden />
              </Button>
              <Button
                type="button"
                variant={showAnnotations ? "secondary" : "outline"}
                size="sm"
                onClick={onToggleAnnotations}
                aria-pressed={showAnnotations}
              >
                {showAnnotations ? (
                  <Eye aria-hidden />
                ) : (
                  <EyeOff aria-hidden />
                )}
                Annotations ({liveAnnotationCount})
              </Button>
              {live && isVideo && (
                <span className="text-xs text-slate-500">
                  Component identification and localization work on photos; videos play back for review.
                </span>
              )}
              <span className="ml-auto hidden text-xs text-slate-500 sm:inline">
                {formatBytes(file.byte_size)} ·{" "}
                {formatRelativeTime(file.createdAt)}
              </span>
            </div>

            {live && !isVideo && (
              <SegmentationStatus
                status={segmentation.status}
                count={segmentation.annotations.length}
                skipped={segmentation.skipped}
                identifying={
                  identification.status === "loading" ||
                  identification.status === "identifying"
                }
                message={segmentation.message}
                onRetry={() => {
                  // A manual retry re-arms the vision-failure sweep so a
                  // failed outline pass gets one more automatic attempt.
                  sweepAttempted.current.delete(file.id);
                  segmentation.retry();
                }}
                annotations={segmentation.annotations}
                selectedLabel={selectedLabel}
                onSelectLabel={setSelectedLabel}
                components={calloutComponents}
              />
            )}

            {live && !isVideo && (
              <IdentificationPanel
                state={identification}
                onLocalized={segmentation.retry}
                labelledCount={legendLabels(segmentation.annotations).length}
              />
            )}

            {uploadSlot}

            {files.length > 1 && (
              <ul
                aria-label="Evidence files"
                className="flex gap-2 overflow-x-auto pb-1"
                role="list"
              >
                {files.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      onClick={() => onSelectFile(candidate.id)}
                      aria-current={candidate.id === file.id}
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors",
                        candidate.id === file.id
                          ? "border-cyan-400/40 bg-cyan-400/5 text-slate-100"
                          : "border-edge text-slate-400 hover:border-edge-strong hover:text-slate-200",
                      )}
                    >
                      {candidate.kind === "video" || candidate.media_type.startsWith("video/") ? (
                        <FileVideo className="size-4 shrink-0" aria-hidden />
                      ) : (
                        <FileImage className="size-4 shrink-0" aria-hidden />
                      )}
                      {candidate.original_filename ?? candidate.storage_key}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <ObservationsList
              observations={observations}
              modelBadge={live ? "Model" : "Model · demo"}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Light beam sweeping the photo while vision + SAM 3.1 identify
 * components. Status theatre over the live image — the panel below
 * narrates the same state as text for assistive tech.
 */
function ScanBeam() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-x-0 top-0 motion-safe:animate-scan-y">
        <div className="h-24 bg-linear-to-b from-transparent via-cyan-300/45 to-transparent" />
        <div className="-mt-12 h-1 bg-cyan-100 shadow-[0_0_32px_10px_rgba(103,232,249,0.9)]" />
        <div className="mt-1 h-px bg-cyan-200/70 shadow-[0_0_16px_4px_rgba(103,232,249,0.7)]" />
      </div>
      <p className="absolute top-2 left-1/2 -translate-x-1/2 rounded-full border border-cyan-200/60 bg-slate-950/85 px-3 py-1 text-[11px] font-bold tracking-wider text-cyan-100 uppercase motion-safe:animate-pulse-soft">
        Scanning photo
      </p>
    </div>
  );
}

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string };

/** Private photo/video preview, fetched with the session token. */
function LivePreview({
  sessionId,
  token,
  file,
}: {
  sessionId: string;
  token: string;
  file: DemoEvidenceFile;
}) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const label = file.original_filename ?? "Evidence photo";

  useEffect(() => {
    const controller = new AbortController();
    let url: string | null = null;
    setState({ status: "loading" });
    void fetchEvidenceBlob(sessionId, file.id, token, controller.signal).then(
      (blob) => {
        url = URL.createObjectURL(blob);
        setState({ status: "ready", url });
      },
      (err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({ status: "error", message: describeApiError(err) });
      },
    );
    return () => {
      controller.abort();
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [sessionId, file.id, token, attempt]);

  if (state.status === "loading") {
    return (
      <div role="status" aria-label={`Loading ${label}`}>
        <Skeleton className="aspect-video w-full rounded-none" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-canvas p-6 text-center">
        <p className="text-sm text-slate-300" role="alert">
          Preview failed: {state.message}
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
          <RotateCcw aria-hidden />
          Retry preview
        </Button>
      </div>
    );
  }
  if (file.kind === "video" || file.media_type.startsWith("video/")) {
    return (
      <video
        src={state.url}
        aria-label={label}
        controls
        playsInline
        preload="metadata"
        className="block max-h-[420px] w-full bg-canvas"
      />
    );
  }
  return (
    <img
      src={state.url}
      alt={label}
      className="block max-h-[420px] w-full bg-canvas object-contain"
    />
  );
}

function AnnotationOverlay({ annotation }: { annotation: DemoAnnotation }) {
  if (!("width" in annotation.coordinates)) {
    return null;
  }
  const { x, y, width, height } = annotation.coordinates;
  const left = (x / annotation.image_width) * 100;
  const top = (y / annotation.image_height) * 100;
  const w = (width / annotation.image_width) * 100;
  const h = (height / annotation.image_height) * 100;

  return (
    <div
      className="absolute rounded-[2px] border-2 border-cyan-300/90 bg-cyan-400/10"
      style={{ left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%` }}
      role="img"
      aria-label={`Demo annotation: ${annotation.label ?? annotation.kind} (model: ${annotation.producer})`}
    >
      <span className="absolute -top-6 left-0 rounded bg-cyan-300 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-slate-950">
        {annotation.label ?? annotation.kind} · demo
      </span>
    </div>
  );
}

/**
 * Localization status line: loading / segmenting / error / empty states
 * plus the overlay legend. Regions only — never a fault diagnosis.
 */
function SegmentationStatus({
  status,
  count,
  skipped,
  identifying,
  message,
  onRetry,
  annotations,
  selectedLabel,
  onSelectLabel,
  components,
}: {
  status: "loading" | "ready" | "segmenting" | "error";
  count: number;
  skipped: number;
  /** Vision pass still running: the list may be empty only for now. */
  identifying: boolean;
  message: string | null;
  onRetry: () => void;
  annotations: Parameters<typeof SegmentationLegend>[0]["annotations"];
  selectedLabel: string | null;
  onSelectLabel: (label: string | null) => void;
  components: CalloutComponent[];
}) {
  if (status === "error") {
    return (
      <div
        className="flex flex-wrap items-center gap-2 rounded-md border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs text-slate-300"
        role="alert"
      >
        <span>Component localization failed: {message ?? "unknown error"}</span>
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          <RotateCcw aria-hidden />
          Retry
        </Button>
      </div>
    );
  }
  const producers = [
    ...new Set(
      annotations
        .map((a) => a.producer)
        .filter((p): p is string => typeof p === "string" && p.length > 0),
    ),
  ];
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <p className="text-xs text-slate-400">
        {status === "loading" || status === "segmenting" || identifying ? (
          "Locating components…"
        ) : count === 0 ? (
          "SAM 3.1 found no parts it could outline on this photo — every new photo is scanned automatically. Regions only, not a diagnosis."
        ) : (
          <>
            <strong className="font-semibold text-slate-100">
              {count} component region{count === 1 ? "" : "s"} located
              {producers.length > 0 ? ` by ${producers.join(", ")}` : ""}
            </strong>{" "}
            (regions only, not a diagnosis).
          </>
        )}
        {skipped > 0 &&
          ` ${skipped} region${skipped === 1 ? " was" : "s were"} returned without usable geometry and hidden.`}
        {message != null && status === "ready" && count > 0 ? ` ${message}` : null}
      </p>
      {count > 0 && (
        <SegmentationLegend
          annotations={annotations}
          selectedLabel={selectedLabel}
          onSelectLabel={onSelectLabel}
          components={components}
        />
      )}
    </div>
  );
}

function ObservationsList({
  observations,
  modelBadge,
}: {
  observations: DemoObservation[];
  /** Label for model-sourced observations: live sessions say Model, demos stay marked. */
  modelBadge: string;
}) {
  if (observations.length === 0) {
    return null;
  }
  // Collapsed by default: the same observations appear in full in the
  // repair report below, so the canvas keeps only the photo story.
  return (
    <details className="group rounded-lg border border-edge bg-panel">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 [&::-webkit-details-marker]:hidden">
        <ChevronDown
          className="size-3.5 shrink-0 text-slate-500 transition-transform group-open:rotate-180"
          aria-hidden
        />
        Observations ({observations.length})
        <span className="font-normal text-slate-500">· also in the report below</span>
      </summary>
      <ul className="flex flex-col gap-2 border-t border-edge p-3" role="list">
        {observations.map((obs) => (
          <li
            key={obs.id}
            className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm"
          >
            <span className="flex items-center gap-2">
              <Badge variant={obs.source === "model" ? "default" : "secondary"}>
                {obs.source === "model" ? modelBadge : "User"}
              </Badge>
              <span className="text-[11px] text-slate-500">
                {formatRelativeTime(obs.createdAt)}
              </span>
            </span>
            <p className="mt-1.5 text-slate-200">{obs.body}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}

function SchematicDrawing({
  deviceType,
  label,
}: {
  deviceType: "laptop" | "desktop" | "smartphone";
  label: string;
}) {
  return (
    <svg
      viewBox="0 0 1280 720"
      role="img"
      aria-label={`Schematic demo illustration for ${label}`}
      className="block h-auto w-full"
    >
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="#232a34"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="1280" height="720" fill="#14171c" />
      <rect width="1280" height="720" fill="url(#grid)" />
      {deviceType === "laptop" ? (
        <g stroke="#3a424d" strokeWidth="3" fill="#1d222a">
          <rect x="120" y="200" width="420" height="260" rx="12" />
          <rect x="150" y="230" width="360" height="200" rx="6" fill="#171b21" />
          <rect x="90" y="460" width="480" height="18" rx="9" />
          <path d="M 560 330 C 680 330, 700 420, 780 470" fill="none" />
          <rect x="780" y="470" width="200" height="130" rx="10" />
          <circle cx="880" cy="570" r="14" fill="#232a34" stroke="#4a5462" />
          <rect x="1020" y="490" width="140" height="90" rx="8" />
          <line x1="980" y1="535" x2="1020" y2="535" />
        </g>
      ) : deviceType === "desktop" ? (
        <g stroke="#3a424d" strokeWidth="3" fill="#1d222a">
          <rect x="180" y="160" width="560" height="340" rx="10" />
          <rect x="205" y="185" width="510" height="260" rx="6" fill="#171b21" />
          <rect x="430" y="500" width="60" height="60" />
          <rect x="360" y="560" width="200" height="16" rx="8" />
          <rect x="800" y="220" width="220" height="340" rx="10" />
          <circle cx="910" cy="330" r="34" fill="#171b21" />
          <circle cx="910" cy="330" r="12" fill="#232a34" stroke="#4a5462" />
          <rect x="830" y="440" width="160" height="14" rx="7" fill="#232a34" stroke="none" />
          <rect x="830" y="466" width="110" height="14" rx="7" fill="#232a34" stroke="none" />
        </g>
      ) : (
        <g stroke="#3a424d" strokeWidth="3" fill="#1d222a">
          <rect x="500" y="90" width="280" height="540" rx="28" />
          <rect x="520" y="120" width="240" height="420" rx="12" fill="#171b21" />
          <path
            d="M 520 560 L 760 520 L 760 600 L 520 630 Z"
            fill="#232a34"
            strokeDasharray="8 6"
          />
          <circle cx="640" cy="585" r="6" fill="#4a5462" stroke="none" />
        </g>
      )}
      <text
        x="40"
        y="668"
        fill="#5b6572"
        fontSize="22"
        fontFamily="ui-monospace, monospace"
      >
        DEMO ILLUSTRATION — NOT DEVICE EVIDENCE
      </text>
    </svg>
  );
}
