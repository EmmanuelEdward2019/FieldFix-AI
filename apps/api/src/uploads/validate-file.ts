/**
 * Server-side upload validation: presence, size, allowlisted media
 * types, and magic-byte sniffing so a renamed script can't pose as
 * evidence. Videos are stored and playable; reasoning and component
 * localization stay image-only and skip video with recorded reasons.
 */

export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

/**
 * WAV only: the verified Meta file endpoint requires WAV mono 16-bit
 * PCM, and no server-side transcode is scoped — browsers must encode
 * WAV before upload (webm/mpeg are rejected, never auto-converted).
 */
export const ALLOWED_AUDIO_TYPES = ["audio/wav", "audio/x-wav"] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];
export type AllowedVideoType = (typeof ALLOWED_VIDEO_TYPES)[number];
export type AllowedMediaType = AllowedImageType | AllowedVideoType;
export type AllowedAudioType = (typeof ALLOWED_AUDIO_TYPES)[number];

export interface FileValidationFailure {
  ok: false;
  code:
    | "file_missing"
    | "file_empty"
    | "file_too_large"
    | "unsupported_media_type"
    | "file_content_mismatch";
  message: string;
}

export interface FileValidationSuccess {
  ok: true;
  kind: "image" | "video";
}

export type FileValidation = FileValidationSuccess | FileValidationFailure;

export function validateUpload(input: {
  buffer: Buffer | undefined;
  mediaType: string | undefined;
  maxBytes: number;
}): FileValidation {
  const { buffer, mediaType, maxBytes } = input;
  if (!buffer) {
    return {
      ok: false,
      code: "file_missing",
      message: "Attach a file in the 'file' field.",
    };
  }
  if (buffer.length === 0) {
    return { ok: false, code: "file_empty", message: "File is empty." };
  }
  if (buffer.length > maxBytes) {
    return {
      ok: false,
      code: "file_too_large",
      message: `File exceeds the ${maxBytes} byte limit.`,
    };
  }
  const isImage = (ALLOWED_IMAGE_TYPES as readonly string[]).includes(mediaType ?? "");
  const isVideo = (ALLOWED_VIDEO_TYPES as readonly string[]).includes(mediaType ?? "");
  if (!mediaType || (!isImage && !isVideo)) {
    return {
      ok: false,
      code: "unsupported_media_type",
      message: `Unsupported media type. Allowed: ${[...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES].join(", ")}.`,
    };
  }
  if (!magicMatches(buffer, mediaType as AllowedMediaType)) {
    return {
      ok: false,
      code: "file_content_mismatch",
      message: "File contents do not match the declared media type.",
    };
  }
  return { ok: true, kind: isVideo ? "video" : "image" };
}

export interface AudioValidationSuccess {
  ok: true;
  kind: "audio";
}

export type AudioValidation = AudioValidationSuccess | FileValidationFailure;

/** WAV-only upload validation for voice transcription. */
export function validateAudioUpload(input: {
  buffer: Buffer | undefined;
  mediaType: string | undefined;
  maxBytes: number;
}): AudioValidation {
  const { buffer, mediaType, maxBytes } = input;
  if (!buffer) {
    return {
      ok: false,
      code: "file_missing",
      message: "Attach audio in the 'audio' field.",
    };
  }
  if (buffer.length === 0) {
    return { ok: false, code: "file_empty", message: "Audio is empty." };
  }
  if (buffer.length > maxBytes) {
    return {
      ok: false,
      code: "file_too_large",
      message: `Audio exceeds the ${maxBytes} byte limit.`,
    };
  }
  if (!mediaType || !(ALLOWED_AUDIO_TYPES as readonly string[]).includes(mediaType)) {
    return {
      ok: false,
      code: "unsupported_media_type",
      message: `Unsupported media type. Voice transcription requires WAV audio (${ALLOWED_AUDIO_TYPES.join(", ")}).`,
    };
  }
  if (!audioMagicMatches(buffer)) {
    return {
      ok: false,
      code: "file_content_mismatch",
      message: "Audio contents do not match the declared WAV media type.",
    };
  }
  return { ok: true, kind: "audio" };
}

/** WAV container magic: RIFF....WAVE. */
function audioMagicMatches(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE"
  );
}

function magicMatches(buffer: Buffer, mediaType: AllowedMediaType): boolean {
  switch (mediaType) {
    case "image/png":
      return (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      );
    case "image/jpeg":
      return (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
      );
    case "image/gif":
      return (
        buffer.length >= 6 &&
        buffer.toString("ascii", 0, 3) === "GIF" &&
        (buffer.toString("ascii", 3, 6) === "87a" ||
          buffer.toString("ascii", 3, 6) === "89a")
      );
    case "image/webp":
      return (
        buffer.length >= 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP"
      );
    case "video/mp4":
    case "video/quicktime":
      // ISO BMFF: 4-byte box size, then "ftyp".
      return buffer.length >= 8 && buffer.toString("ascii", 4, 8) === "ftyp";
    case "video/webm":
      // EBML header.
      return (
        buffer.length >= 4 &&
        buffer[0] === 0x1a &&
        buffer[1] === 0x45 &&
        buffer[2] === 0xdf &&
        buffer[3] === 0xa3
      );
  }
}
