"use client";

import { useEffect, useState } from "react";
import {
  Eye,
  EyeOff,
  FileImage,
  FileVideo,
  ImagePlus,
  RotateCcw,
  ScanSearch,
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
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import { IdentificationPanel, useIdentification } from "./identification-panel";
import {
  SegmentationLegend,
  SegmentationOverlay,
  useSegmentations,
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
  );
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  useEffect(() => {
    setSelectedLabel(null);
  }, [file?.id]);
  const liveAnnotationCount = live ? segmentation.annotations.length : file?.annotations.length ?? 0;

  return (
    <Card aria-labelledby="evidence-canvas-title">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle id="evidence-canvas-title">Evidence canvas</CardTitle>
          <p className="mt-0.5 text-xs text-slate-400">
            {live
              ? "Your uploaded photos and videos, stored privately."
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
                      <SegmentationOverlay
                        annotations={segmentation.annotations}
                        imageWidth={segmentation.imageWidth}
                        imageHeight={segmentation.imageHeight}
                        highlightLabel={selectedLabel}
                      />
                    )}
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
              {live && !isVideo && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={segmentation.segment}
                  disabled={
                    segmentation.status === "loading" ||
                    segmentation.status === "segmenting"
                  }
                >
                  <ScanSearch aria-hidden />
                  {segmentation.status === "segmenting"
                    ? "Locating…"
                    : "Locate components"}
                </Button>
              )}
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
                message={segmentation.message}
                onRetry={segmentation.retry}
                annotations={segmentation.annotations}
              />
            )}

            {live && !isVideo && (
              <IdentificationPanel
                state={identification}
                selectedLabel={selectedLabel}
                onSelectLabel={setSelectedLabel}
                onLocalized={segmentation.retry}
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

            <ObservationsList observations={observations} />
          </>
        )}
      </CardContent>
    </Card>
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
  message,
  onRetry,
  annotations,
}: {
  status: "loading" | "ready" | "segmenting" | "error";
  count: number;
  skipped: number;
  message: string | null;
  onRetry: () => void;
  annotations: Parameters<typeof SegmentationLegend>[0]["annotations"];
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
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <p className="text-xs text-slate-400">
        {status === "loading" || status === "segmenting"
          ? "Locating components…"
          : count === 0
            ? "No component regions yet — use “Locate components” to mark parts on this photo. Regions only, not a diagnosis."
            : `${count} component region${count === 1 ? "" : "s"} located (regions only, not a diagnosis).`}
        {skipped > 0 &&
          ` ${skipped} region${skipped === 1 ? " was" : "s were"} returned without usable geometry and hidden.`}
        {message != null && status === "ready" && count > 0 ? ` ${message}` : null}
      </p>
      {count > 0 && <SegmentationLegend annotations={annotations} />}
    </div>
  );
}

function ObservationsList({ observations }: { observations: DemoObservation[] }) {
  if (observations.length === 0) {
    return null;
  }
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
        Observations
      </h3>
      <ul className="mt-2 flex flex-col gap-2" role="list">
        {observations.map((obs) => (
          <li
            key={obs.id}
            className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm"
          >
            <span className="flex items-center gap-2">
              <Badge variant={obs.source === "model" ? "default" : "secondary"}>
                {obs.source === "model" ? "Model · demo" : "User"}
              </Badge>
              <span className="text-[11px] text-slate-500">
                {formatRelativeTime(obs.createdAt)}
              </span>
            </span>
            <p className="mt-1.5 text-slate-200">{obs.body}</p>
          </li>
        ))}
      </ul>
    </div>
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
