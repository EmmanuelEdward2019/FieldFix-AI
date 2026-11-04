import type { AnnotationResponse } from "@fieldfix/contracts";

export type { AnnotationResponse };

/**
 * SVG transform placing a server-rendered mask path (drawn in mask-raster
 * pixels, cols x rows) onto original-image pixels. The raster covers the
 * mask `bounds` box; when bounds are absent the raster spans the whole
 * image. Returns null when the annotation is not a mask or has no
 * usable geometry.
 */
export function maskOverlayTransform(
  annotation: AnnotationResponse,
): string | null {
  if (annotation.kind !== "mask") {
    return null;
  }
  const coords = annotation.coordinates;
  if (!("rows" in coords) || !("data" in coords)) {
    return null;
  }
  if (coords.cols <= 0 || coords.rows <= 0) {
    return null;
  }
  const bounds = coords.bounds;
  if (!bounds) {
    const sx = annotation.image_width / coords.cols;
    const sy = annotation.image_height / coords.rows;
    return `scale(${formatScale(sx)} ${formatScale(sy)})`;
  }
  const spanX = bounds.right - bounds.left;
  const spanY = bounds.bottom - bounds.top;
  if (spanX <= 0 || spanY <= 0) {
    return null;
  }
  const sx = spanX / coords.cols;
  const sy = spanY / coords.rows;
  return `translate(${bounds.left} ${bounds.top}) scale(${formatScale(sx)} ${formatScale(sy)})`;
}

function formatScale(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

/** True when the overlay can draw this annotation over the image. */
export function isRenderableAnnotation(annotation: AnnotationResponse): boolean {
  if (annotation.kind === "box") {
    return "width" in annotation.coordinates;
  }
  if (annotation.kind === "mask") {
    return annotation.svg_path != null && maskOverlayTransform(annotation) != null;
  }
  if (annotation.kind === "polygon") {
    return "points" in annotation.coordinates && annotation.coordinates.points.length > 1;
  }
  return false;
}

export interface SegmentationSummary {
  renderable: AnnotationResponse[];
  skipped: number;
}

export function summarizeAnnotations(annotations: AnnotationResponse[]): SegmentationSummary {
  const renderable = annotations.filter(isRenderableAnnotation);
  return { renderable, skipped: annotations.length - renderable.length };
}

/** Accessible label for the overlay: labels only, never a diagnosis. */
export function overlayAriaLabel(annotations: AnnotationResponse[]): string {
  if (annotations.length === 0) {
    return "No component regions located";
  }
  const labels = annotations.map((a) => a.label ?? a.kind);
  const unique = [...new Set(labels)];
  return `Located component regions: ${unique.join(", ")}`;
}

/** Distinct labels for the visible legend, in first-seen order. */
export function legendLabels(annotations: AnnotationResponse[]): string[] {
  const labels = annotations.map((a) => a.label ?? a.kind);
  return [...new Set(labels)];
}
