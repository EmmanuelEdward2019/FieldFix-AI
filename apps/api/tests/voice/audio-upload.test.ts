import { describe, expect, it } from "vitest";
import {
  ALLOWED_AUDIO_TYPES,
  validateAudioUpload,
} from "../../src/uploads/validate-file.js";

const MAX = 32 * 1024 * 1024;

/** Minimal WAV container: RIFF....WAVE + filler. */
function wav(size = 64): Buffer {
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(size - 8, 4);
  header.write("WAVE", 8, "ascii");
  return Buffer.concat([header, Buffer.alloc(Math.max(0, size - 12), 1)]);
}

describe("validateAudioUpload", () => {
  it("accepts WAV audio under the cap", () => {
    for (const mediaType of ALLOWED_AUDIO_TYPES) {
      const result = validateAudioUpload({ buffer: wav(), mediaType, maxBytes: MAX });
      expect(result).toEqual({ ok: true, kind: "audio" });
    }
  });

  it("rejects missing and empty audio", () => {
    expect(
      validateAudioUpload({ buffer: undefined, mediaType: "audio/wav", maxBytes: MAX }),
    ).toMatchObject({ ok: false, code: "file_missing" });
    expect(
      validateAudioUpload({ buffer: Buffer.alloc(0), mediaType: "audio/wav", maxBytes: MAX }),
    ).toMatchObject({ ok: false, code: "file_empty" });
  });

  it("rejects oversized audio", () => {
    const result = validateAudioUpload({
      buffer: wav(2048),
      mediaType: "audio/wav",
      maxBytes: 1024,
    });
    expect(result).toMatchObject({ ok: false, code: "file_too_large" });
  });

  it("rejects webm/mpeg: WAV-only, no server transcode", () => {
    // Real EBML bytes still rejected: the provider takes WAV only.
    const webm = Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      Buffer.alloc(64, 2),
    ]);
    expect(
      validateAudioUpload({ buffer: webm, mediaType: "audio/webm", maxBytes: MAX }),
    ).toMatchObject({ ok: false, code: "unsupported_media_type" });
    expect(
      validateAudioUpload({ buffer: wav(), mediaType: "audio/mpeg", maxBytes: MAX }),
    ).toMatchObject({ ok: false, code: "unsupported_media_type" });
  });

  it("rejects a renamed script posing as WAV", () => {
    const exe = Buffer.concat([
      Buffer.from("MZ", "ascii"),
      Buffer.alloc(64, 3),
    ]);
    expect(
      validateAudioUpload({ buffer: exe, mediaType: "audio/wav", maxBytes: MAX }),
    ).toMatchObject({ ok: false, code: "file_content_mismatch" });
  });
});
