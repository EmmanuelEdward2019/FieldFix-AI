import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VoiceCapabilities } from "@fieldfix/contracts";
import { SpokenResponseStatus, VoiceInputStatus } from "../components/voice-overview";

function stt(overrides: Partial<VoiceCapabilities["stt"]> = {}): VoiceCapabilities["stt"] {
  return {
    provider: "meta",
    model_id: "muse-voice-transcribe-1.0",
    configured: true,
    enabled: true,
    available: true,
    accepts: ["audio/webm", "audio/mpeg"],
    max_audio_mb: 32,
    max_audio_bytes: 33554432,
    ...overrides,
  };
}

describe("VoiceInputStatus", () => {
  it("shows ready when transcription is available", () => {
    const html = renderToString(
      React.createElement(VoiceInputStatus, { stt: stt(), browserRecording: true }),
    );
    expect(html).toContain("Voice input");
    expect(html).toContain("Ready");
    expect(html).toContain("muse-voice-transcribe-1.0");
    expect(html).toContain("clips up to");
    expect(html).toContain("32");
    expect(html).toContain("Supported");
  });

  it("is honest when transcription is not configured", () => {
    const html = renderToString(
      React.createElement(VoiceInputStatus, {
        stt: stt({ configured: false, enabled: false, available: false }),
        browserRecording: false,
      }),
    );
    expect(html).toContain("Not configured");
    expect(html).toContain("Not supported");
    expect(html).not.toContain("Ready");
  });
});

describe("SpokenResponseStatus", () => {
  it("reflects browser synthesis support", () => {
    const supported = renderToString(
      React.createElement(SpokenResponseStatus, { browserSynthesis: true }),
    );
    expect(supported).toContain("Spoken responses");
    expect(supported).toContain("Supported");
    const unsupported = renderToString(
      React.createElement(SpokenResponseStatus, { browserSynthesis: false }),
    );
    expect(unsupported).toContain("Not supported");
  });
});
