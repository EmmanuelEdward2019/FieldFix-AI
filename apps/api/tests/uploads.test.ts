import { describe, expect, it } from "vitest";
import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  validateUpload,
} from "../src/uploads/validate-file.js";

const MAX = 1024;

function png(extra = 0): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(extra, 0),
  ]);
}

/** Minimal ISO BMFF header: size + "ftyp" + brand. */
function mp4(): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypisom", "ascii"),
    Buffer.alloc(16, 0),
  ]);
}

/** Minimal EBML header. */
function webm(): Buffer {
  return Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16, 0)]);
}

describe("validateUpload", () => {
  it("accepts images whose magic bytes match the claim", () => {
    expect(
      validateUpload({ buffer: png(), mediaType: "image/png", maxBytes: MAX }),
    ).toEqual({ ok: true, kind: "image" });
    expect(
      validateUpload({
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        mediaType: "image/jpeg",
        maxBytes: MAX,
      }),
    ).toEqual({ ok: true, kind: "image" });
    expect(
      validateUpload({
        buffer: Buffer.concat([
          Buffer.from("RIFFxxxxWEBP", "ascii"),
          Buffer.alloc(4),
        ]),
        mediaType: "image/webp",
        maxBytes: MAX,
      }),
    ).toEqual({ ok: true, kind: "image" });
    expect(
      validateUpload({
        buffer: Buffer.from("GIF89a1234", "ascii"),
        mediaType: "image/gif",
        maxBytes: MAX,
      }),
    ).toEqual({ ok: true, kind: "image" });
  });

  it("rejects missing, empty, and oversized files", () => {
    expect(
      validateUpload({ buffer: undefined, mediaType: "image/png", maxBytes: MAX }),
    ).toMatchObject({ ok: false, code: "file_missing" });
    expect(
      validateUpload({ buffer: Buffer.alloc(0), mediaType: "image/png", maxBytes: MAX }),
    ).toMatchObject({ ok: false, code: "file_empty" });
    expect(
      validateUpload({ buffer: png(MAX + 1), mediaType: "image/png", maxBytes: MAX }),
    ).toMatchObject({ ok: false, code: "file_too_large" });
  });

  it("rejects disallowed types", () => {
    expect(
      validateUpload({
        buffer: Buffer.from("hello"),
        mediaType: "text/plain",
        maxBytes: MAX,
      }),
    ).toMatchObject({ ok: false, code: "unsupported_media_type" });
    expect(
      validateUpload({
        buffer: Buffer.alloc(16),
        mediaType: "video/avi",
        maxBytes: MAX,
      }),
    ).toMatchObject({ ok: false, code: "unsupported_media_type" });
    expect(ALLOWED_IMAGE_TYPES).toContain("image/png");
    expect(ALLOWED_VIDEO_TYPES).toContain("video/mp4");
  });

  it("accepts videos whose container bytes match the claim", () => {
    expect(
      validateUpload({ buffer: mp4(), mediaType: "video/mp4", maxBytes: MAX }),
    ).toEqual({ ok: true, kind: "video" });
    expect(
      validateUpload({ buffer: webm(), mediaType: "video/webm", maxBytes: MAX }),
    ).toEqual({ ok: true, kind: "video" });
    expect(
      validateUpload({ buffer: mp4(), mediaType: "video/quicktime", maxBytes: MAX }),
    ).toEqual({ ok: true, kind: "video" });
  });

  it("rejects bytes that contradict the declared type", () => {
    expect(
      validateUpload({
        buffer: Buffer.from("#!/bin/sh\nevil"),
        mediaType: "image/png",
        maxBytes: MAX,
      }),
    ).toMatchObject({ ok: false, code: "file_content_mismatch" });
    expect(
      validateUpload({
        buffer: png(),
        mediaType: "image/jpeg",
        maxBytes: MAX,
      }),
    ).toMatchObject({ ok: false, code: "file_content_mismatch" });
    expect(
      validateUpload({
        buffer: png(),
        mediaType: "video/mp4",
        maxBytes: MAX,
      }),
    ).toMatchObject({ ok: false, code: "file_content_mismatch" });
    expect(
      validateUpload({
        buffer: Buffer.from("definitely not a video container"),
        mediaType: "video/webm",
        maxBytes: MAX,
      }),
    ).toMatchObject({ ok: false, code: "file_content_mismatch" });
  });
});
