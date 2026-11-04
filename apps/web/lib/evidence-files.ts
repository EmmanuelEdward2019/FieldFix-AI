/**
 * Shared client-side evidence validation. Mirrors the server allowlist
 * (apps/api/src/uploads/validate-file.ts) for fast feedback; the server
 * re-validates everything including magic bytes.
 */

export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export const ACCEPTED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

export const ACCEPTED_EVIDENCE_TYPES: readonly string[] = [
  ...ACCEPTED_IMAGE_TYPES,
  ...ACCEPTED_VIDEO_TYPES,
];

export const EVIDENCE_TYPE_LABEL = "JPEG, PNG, WebP, GIF, MP4, WebM, MOV";

export function isVideoMimeType(mediaType: string): boolean {
  return (ACCEPTED_VIDEO_TYPES as readonly string[]).includes(mediaType);
}

/** Returns a user-facing error, or null when the file is acceptable. */
export function validateEvidenceFile(
  file: { name: string; type: string; size: number },
  maxBytes: number,
): string | null {
  if (!(ACCEPTED_EVIDENCE_TYPES as readonly string[]).includes(file.type)) {
    return `"${file.name}" is not supported. Allowed: ${EVIDENCE_TYPE_LABEL}.`;
  }
  if (file.size > maxBytes) {
    const mb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
    return `"${file.name}" exceeds the ${mb} MB limit.`;
  }
  return null;
}
