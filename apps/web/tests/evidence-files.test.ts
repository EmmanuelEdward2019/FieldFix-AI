import { describe, expect, it } from "vitest";
import {
  ACCEPTED_EVIDENCE_TYPES,
  isVideoMimeType,
  validateEvidenceFile,
} from "../lib/evidence-files";

const TEN_MB = 10 * 1024 * 1024;

describe("evidence file validation", () => {
  it("accepts images and videos within the limit", () => {
    for (const type of ACCEPTED_EVIDENCE_TYPES) {
      expect(
        validateEvidenceFile({ name: "a", type, size: 1024 }, TEN_MB),
      ).toBeNull();
    }
  });

  it("rejects disallowed types and oversized files", () => {
    expect(
      validateEvidenceFile({ name: "run.sh", type: "text/plain", size: 10 }, TEN_MB),
    ).toMatch(/not supported/);
    expect(
      validateEvidenceFile({ name: "big.mp4", type: "video/mp4", size: TEN_MB + 1 }, TEN_MB),
    ).toMatch(/exceeds the 10 MB limit/);
  });

  it("distinguishes video from image mime types", () => {
    expect(isVideoMimeType("video/mp4")).toBe(true);
    expect(isVideoMimeType("video/quicktime")).toBe(true);
    expect(isVideoMimeType("image/png")).toBe(false);
  });
});
