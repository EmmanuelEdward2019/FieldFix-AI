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
          fillOpacity={0.18}
          stroke={color}
          strokeWidth={3}
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
          fillOpacity={0.28}
          stroke={color}
          strokeWidth={2.5}
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
          fillOpacity={0.18}
          stroke={color}
          strokeWidth={3}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  }

  return null;
}

/** Source-pixel bounding box for any renderable geometry, else null. */
function anchorBounds(annotation: AnnotationResponse): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} | null {
  const coords = annotation.coordinates;
  if (annotation.kind === "box" && "width" in coords) {
    return {
      left: coords.x,
      top: coords.y,
      right: coords.x + coords.width,
      bottom: coords.y + coords.height,
    };
  }
  if (annotation.kind === "polygon" && "points" in coords && coords.points.length > 1) {
    const xs = coords.points.map((p) => p.x);
    const ys = coords.points.map((p) => p.y);
    return {
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys),
    };
  }
  if (annotation.kind === "mask" && "rows" in coords && "data" in coords) {
    const bounds = coords.bounds;
    if (bounds) {
      return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
    }
  }
  return null;
}

/** Minimal component identity for badge confidence styling. */
export interface CalloutComponent {
  name: string;
  confidence: string;
}

export interface LeaderGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LabelCallout {
  label: string;
  rank: number;
  /** Numbered circle center, percent of image. */
  circleX: number;
  circleY: number;
  /** Name chip sits on this side of the circle. */
  chipSide: "left" | "right";
  /** Vertical chip stagger in display px; adjacent callouts alternate to avoid overlap. */
  chipDyPx: number;
  /** Leader shaft (circle toward region), percent coords, null when too short to draw. */
  leader: LeaderGeometry | null;
  /** Arrowhead chevron at the shaft tip, percent coords, null with the shaft. */
  head: Array<{ x: number; y: number }> | null;
  /** Lower-confidence callouts render ringed instead of solid. */
  uncertain: boolean;
}

/**
 * One graphical callout per distinct component, anchored to its first
 * region: a numbered circle pinned on the region corner, a name chip
 * beside it, and an arrow pointing into the part. Geometry is pure
 * percent math so the HTML badges and the SVG arrows always agree.
 */
export function labelCallouts(
  annotations: AnnotationResponse[],
  imageWidth: number,
  imageHeight: number,
  components: CalloutComponent[] = [],
): LabelCallout[] {
  const callouts: LabelCallout[] = [];
  for (const annotation of annotations) {
    const label = annotation.label ?? annotation.kind;
    if (callouts.some((c) => c.label === label)) {
      continue;
    }
    const bounds = anchorBounds(annotation);
    if (!bounds || imageWidth <= 0 || imageHeight <= 0) {
      continue;
    }
    const left = (bounds.left / imageWidth) * 100;
    const top = (bounds.top / imageHeight) * 100;
    const right = (bounds.right / imageWidth) * 100;
    const bottom = (bounds.bottom / imageHeight) * 100;
    const inside = top < 12;
    const cx = inside ? left + 2.5 : Math.max(left, 3);
    const cy = inside ? top + 7 : top;
    const chipSide = left > 62 ? "left" : "right";
    // Arrow tip partway toward the region center.
    const tx = left + (right - left) / 2;
    const ty = top + (bottom - top) / 2;
    const px = cx + (tx - cx) * 0.45;
    const py = cy + (ty - cy) * 0.45;
    const dx = px - cx;
    const dy = py - cy;
    const len = Math.hypot(dx, dy);
    let leader: LeaderGeometry | null = null;
    let head: Array<{ x: number; y: number }> | null = null;
    if (len >= 4) {
      leader = { x1: cx, y1: cy, x2: px, y2: py };
      const ux = dx / len;
      const uy = dy / len;
      const s = 2.4;
      const w = 2.0;
      head = [
        { x: px - ux * s - uy * w, y: py - uy * s + ux * w },
        { x: px, y: py },
        { x: px - ux * s + uy * w, y: py - uy * s - ux * w },
      ];
    }
    const confidence = components.find((c) => c.name === label)?.confidence;
    callouts.push({
      label,
      rank: callouts.length + 1,
      circleX: cx,
      circleY: cy,
      chipSide,
      chipDyPx: 0,
      leader,
      head,
      uncertain: confidence === "medium" || confidence === "low",
    });
  }
  // Stagger chips whose circles crowd the same zone so adjacent names
  // never sit on one row. Deterministic first-seen order.
  const clusters: LabelCallout[][] = [];
  for (const callout of callouts) {
    const cluster = clusters.find((group) =>
      group.some(
        (member) =>
          Math.abs(member.circleX - callout.circleX) < 14 &&
          Math.abs(member.circleY - callout.circleY) < 10,
      ),
    );
    if (cluster) {
      cluster.push(callout);
    } else {
      clusters.push([callout]);
    }
  }
  for (const cluster of clusters) {
    cluster.forEach((callout, index) => {
      callout.chipDyPx =
        index === 0 ? 0 : (index % 2 === 1 ? -1 : 1) * Math.ceil(index / 2) * 26;
    });
  }
  return callouts;
}

/**
 * Graphical on-photo callouts: a numbered circle pinned on each
 * component's region corner plus a name chip beside it. Decorative
 * for assistive tech — the SVG overlay exposes every label, and the
 * legend below keeps the names as real text.
 */
export function SegmentationLabels({
  annotations,
  imageWidth,
  imageHeight,
  highlightLabel = null,
  components = [],
}: {
  annotations: AnnotationResponse[];
  imageWidth: number;
  imageHeight: number;
  /** When set, callouts with other labels render dimmed. */
  highlightLabel?: string | null;
  /** Component confidences for badge styling. */
  components?: CalloutComponent[];
}) {
  const callouts = labelCallouts(annotations, imageWidth, imageHeight, components);
  if (callouts.length === 0) {
    return null;
  }
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {callouts.flatMap((callout) => {
        const dimmed = highlightLabel != null && callout.label !== highlightLabel;
        const color = colorFor(callout.label);
        return [
          <span
            key={`${callout.label}-circle`}
            className={`absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm font-black tabular-nums ${
              dimmed ? "opacity-20" : ""
            }`}
            style={{
              left: `${callout.circleX}%`,
              top: `${callout.circleY}%`,
              backgroundColor: callout.uncertain ? "rgba(2,6,23,0.88)" : color,
              color: callout.uncertain ? color : "#020617",
              boxShadow: callout.uncertain
                ? `0 0 0 3px ${color}, 0 2px 8px rgba(0,0,0,0.55)`
                : "0 0 0 2px rgba(255,255,255,0.92), 0 2px 8px rgba(0,0,0,0.55)",
            }}
          >
            {callout.rank}
          </span>,
          <span
            key={`${callout.label}-chip`}
            className={`absolute max-w-[55%] -translate-y-1/2 truncate rounded-md px-2 py-1 text-xs font-bold whitespace-nowrap text-slate-950 ring-1 ring-black/40 ${
              dimmed ? "opacity-20" : ""
            }`}
            style={{
              backgroundColor: color,
              top:
                callout.chipDyPx === 0
                  ? `${callout.circleY}%`
                  : `calc(${callout.circleY}% + ${callout.chipDyPx}px)`,
              ...(callout.chipSide === "right"
                ? { left: `calc(${callout.circleX}% + 20px)` }
                : { right: `calc(${100 - callout.circleX}% + 20px)` }),
            }}
          >
            {callout.label}
          </span>,
        ];
      })}
    </div>
  );
}

/**
 * Leader arrows from each callout circle into its part, drawn on the
 * same coordinate mapping as the overlay boxes. Arrowheads are
 * computed polylines (not markers) so they stay aligned with their
 * shaft under the overlay's non-uniform scaling.
 */
export function SegmentationLeaders({
  callouts,
  imageWidth,
  imageHeight,
  highlightLabel = null,
}: {
  callouts: LabelCallout[];
  imageWidth: number;
  imageHeight: number;
  /** When set, arrows with other labels render dimmed. */
  highlightLabel?: string | null;
}) {
  const drawn = callouts.filter(
    (c): c is LabelCallout & { leader: LeaderGeometry; head: Array<{ x: number; y: number }> } =>
      c.leader != null && c.head != null,
  );
  if (drawn.length === 0 || imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }
  const toX = (p: number) => (p / 100) * imageWidth;
  const toY = (p: number) => (p / 100) * imageHeight;
  return (
    <svg
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="none"
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {drawn.map((callout) => {
        const color = colorFor(callout.label);
        const dimmed = highlightLabel != null && callout.label !== highlightLabel;
        return (
          <g key={callout.label} opacity={dimmed ? 0.15 : 1}>
            <line
              x1={toX(callout.leader.x1)}
              y1={toY(callout.leader.y1)}
              x2={toX(callout.leader.x2)}
              y2={toY(callout.leader.y2)}
              stroke={color}
              strokeWidth={2}
              strokeOpacity={0.7}
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={callout.head.map((p) => `${toX(p.x)},${toY(p.y)}`).join(" ")}
              fill="none"
              stroke={color}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </svg>
  );
}

/** Tappable legend decoding the on-photo numbers; tap isolates a component. */
export function SegmentationLegend({
  annotations,
  selectedLabel = null,
  onSelectLabel,
  components = [],
}: {
  annotations: AnnotationResponse[];
  selectedLabel?: string | null;
  /** When omitted the legend renders as static text. */
  onSelectLabel?: (label: string | null) => void;
  /** Component confidences for the caption key. */
  components?: CalloutComponent[];
}) {
  const labels = legendLabels(annotations);
  if (labels.length === 0) {
    return null;
  }
  const anyUncertain = labels.some((label) => {
    const confidence = components.find((c) => c.name === label)?.confidence;
    return confidence === "medium" || confidence === "low";
  });
  return (
    <div className="flex flex-col gap-1.5">
      <ul aria-label="Located components" className="flex flex-wrap gap-1.5" role="list">
        {labels.map((label, index) => {
          const selected = selectedLabel === label;
          const badge = (
            <span
              aria-hidden
              className="rounded px-1 text-[10px] font-bold text-slate-950 tabular-nums"
              style={{ backgroundColor: colorFor(label) }}
            >
              {index + 1}
            </span>
          );
          return (
            <li key={label}>
              {onSelectLabel ? (
                <button
                  type="button"
                  onClick={() => onSelectLabel(selected ? null : label)}
                  aria-pressed={selected}
                  title="Isolate on the photo"
                  className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-medium transition-colors ${
                    selected
                      ? "border-cyan-400/40 bg-cyan-400/5 text-slate-100"
                      : "border-edge bg-canvas text-slate-200 hover:border-edge-strong"
                  }`}
                >
                  {badge}
                  {label}
                </button>
              ) : (
                <span className="flex items-center gap-1.5 rounded border border-edge bg-canvas px-2 py-1 text-xs font-medium text-slate-200">
                  {badge}
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {onSelectLabel && (
        <p className="text-[11px] text-slate-500">
          Tap a component to isolate it on the photo.
          {anyUncertain ? " Ringed badges are less certain — look closer." : ""}
        </p>
      )}
    </div>
  );
}
