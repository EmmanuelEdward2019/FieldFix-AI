"use client";

import { useCallback, useEffect, useState } from "react";
import { describeApiError, listSegmentationsApi, segmentEvidenceApi } from "@/lib/api";
import {
  legendLabels,
  maskOverlayTransform,
  overlayAriaLabel,
  summarizeAnnotations,
  type AnnotationResponse,
} from "@/lib/segmentation";

export interface SegmentationState {
  status: "loading" | "ready" | "segmenting" | "error";
  annotations: AnnotationResponse[];
  imageWidth: number | null;
  imageHeight: number | null;
  skipped: number;
  message: string | null;
  segment: () => void;
  retry: () => void;
}

/**
 * Segmentation data for one live evidence image. Reads persisted
 * annotations on mount; `segment` runs the optional localization pass.
 * The original image bytes are never modified — annotations render as a
 * separate overlay layer.
 */
export function useSegmentations(
  sessionId: string,
  token: string,
  fileId: string,
  enabled = true,
): SegmentationState {
  const [status, setStatus] = useState<SegmentationState["status"]>("loading");
  const [annotations, setAnnotations] = useState<AnnotationResponse[]>([]);
  const [dims, setDims] = useState<{ w: number | null; h: number | null }>({
    w: null,
    h: null,
  });
  const [skipped, setSkipped] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setStatus("ready");
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    setMessage(null);
    void listSegmentationsApi(sessionId, fileId, token, controller.signal).then(
      (res) => {
        const summary = summarizeAnnotations(res.annotations);
        setAnnotations(summary.renderable);
        setSkipped(summary.skipped);
        setDims({
          w: res.image_width ?? summary.renderable[0]?.image_width ?? null,
          h: res.image_height ?? summary.renderable[0]?.image_height ?? null,
        });
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
    return () => controller.abort();
  }, [sessionId, fileId, token, reload, enabled]);

  const segment = useCallback(() => {
    if (!enabled) {
      return;
    }
    const controller = new AbortController();
    setStatus("segmenting");
    setMessage(null);
    void segmentEvidenceApi(sessionId, fileId, token, undefined, controller.signal).then(
      (res) => {
        const summary = summarizeAnnotations(res.annotations);
        setAnnotations(summary.renderable);
        setSkipped(summary.skipped);
        const first = summary.renderable[0];
        setDims({ w: first?.image_width ?? null, h: first?.image_height ?? null });
        if (res.warnings.length > 0) {
          setMessage(res.warnings.join(" "));
        }
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

  return {
    status,
    annotations,
    imageWidth: dims.w,
    imageHeight: dims.h,
    skipped,
    message,
    segment,
    retry,
  };
}

const PALETTE = ["#22d3ee", "#a3e635", "#fbbf24", "#f472b6", "#c084fc", "#34d399"];

function colorFor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length] ?? PALETTE[0] ?? "#22d3ee";
}

/** Shared overlay color so panels and legend chips match the shapes. */
export function colorForLabel(label: string): string {
  return colorFor(label);
}

/**
 * Annotation overlay drawn over the original image with an SVG viewBox in
 * source pixels, so boxes and mask paths scale exactly with the photo at
 * any display size. Rendered as a sibling of the <img>; the photo itself
 * is untouched.
 */
export function SegmentationOverlay({
  annotations,
  imageWidth,
  imageHeight,
  highlightLabel = null,
}: {
  annotations: AnnotationResponse[];
  imageWidth: number;
  imageHeight: number;
  /** When set, shapes with other labels render dimmed. */
  highlightLabel?: string | null;
}) {
  if (annotations.length === 0) {
    return null;
  }
  return (
    <svg
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
      role="img"
      aria-label={overlayAriaLabel(annotations)}
    >
      {annotations.map((annotation) => (
        <OverlayShape
          key={annotation.id}
          annotation={annotation}
          dimmed={highlightLabel != null && (annotation.label ?? annotation.kind) !== highlightLabel}
        />
      ))}
    </svg>
  );
}

function OverlayShape({ annotation, dimmed }: { annotation: AnnotationResponse; dimmed: boolean }) {
  const label = annotation.label ?? annotation.kind;
  const color = colorFor(label);
  const coords = annotation.coordinates;

  if (annotation.kind === "box" && "width" in coords) {
    return (
      <g opacity={dimmed ? 0.15 : 1}>
        <title>{label}</title>
        <rect
          x={coords.x}
          y={coords.y}
          width={coords.width}
          height={coords.height}
          fill={color}
          fillOpacity={0.12}
          stroke={color}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  }

  if (annotation.kind === "mask" && annotation.svg_path) {
    const transform = maskOverlayTransform(annotation);
    if (!transform) {
      return null;
    }
    return (
      <g transform={transform} opacity={dimmed ? 0.15 : 1}>
        <title>{label}</title>
        <path
          d={annotation.svg_path}
          fill={color}
          fillOpacity={0.25}
          stroke={color}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  }

  if (annotation.kind === "polygon" && "points" in coords && coords.points.length > 1) {
    return (
      <g opacity={dimmed ? 0.15 : 1}>
        <title>{label}</title>
        <polygon
          points={coords.points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill={color}
          fillOpacity={0.12}
          stroke={color}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  }

  return null;
}

/** Visible legend mapping overlay colors to component labels. */
export function SegmentationLegend({ annotations }: { annotations: AnnotationResponse[] }) {
  const labels = legendLabels(annotations);
  if (labels.length === 0) {
    return null;
  }
  return (
    <ul aria-label="Located components" className="flex flex-wrap gap-1.5" role="list">
      {labels.map((label) => (
        <li
          key={label}
          className="flex items-center gap-1.5 rounded border border-edge bg-canvas px-1.5 py-0.5 text-[11px] text-slate-300"
        >
          <span
            aria-hidden
            className="size-2.5 rounded-[2px]"
            style={{ backgroundColor: colorFor(label) }}
          />
          {label}
        </li>
      ))}
    </ul>
  );
}
