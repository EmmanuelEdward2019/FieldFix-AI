import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatDateTime,
  formatRelativeTime,
} from "./format";

describe("formatBytes", () => {
  it("formats bytes, KB, and MB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(184320)).toBe("180 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
  });

  it("falls back for invalid input", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-10-30T09:00:00.000Z");

  it("describes recent and older timestamps", () => {
    expect(formatRelativeTime("2026-10-30T08:59:30.000Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-10-30T08:55:00.000Z", now)).toBe("5m ago");
    expect(formatRelativeTime("2026-10-30T07:00:00.000Z", now)).toBe("2h ago");
    expect(formatRelativeTime("2026-10-28T09:00:00.000Z", now)).toBe("2d ago");
  });

  it("falls back for invalid input", () => {
    expect(formatRelativeTime("not-a-date", now)).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("renders a local date-time or a fallback", () => {
    expect(formatDateTime("not-a-date")).toBe("—");
    expect(formatDateTime("2026-10-30T07:12:00.000Z")).not.toBe("—");
  });
});
