"use client";

import { Mic, Volume2 } from "lucide-react";
import type { VoiceCapabilities } from "@fieldfix/contracts";
import { Badge } from "@/components/ui/badge";

function StatusRow({ label, ok, text }: { label: string; ok: boolean; text: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <p className="text-sm text-slate-300">{label}</p>
      <Badge variant={ok ? "success" : "muted"}>{text}</Badge>
    </div>
  );
}

export function VoiceInputStatus({
  stt,
  browserRecording,
}: {
  stt: VoiceCapabilities["stt"];
  browserRecording: boolean;
}) {
  return (
    <section aria-label="Voice input status" className="rounded-lg border border-edge bg-panel p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
        <Mic className="size-4 text-cyan-300" aria-hidden />
        Voice input
      </h2>
      <div className="mt-2 divide-y divide-edge">
        <StatusRow
          label="Server transcription"
          ok={stt.available}
          text={
            stt.available ? "Ready" : stt.configured ? "Configured" : "Not configured"
          }
        />
        <StatusRow
          label="Recording in this browser"
          ok={browserRecording}
          text={browserRecording ? "Supported" : "Not supported"}
        />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Model {stt.model_id} · clips up to {stt.max_audio_mb} MB
      </p>
    </section>
  );
}

export function SpokenResponseStatus({
  browserSynthesis,
}: {
  browserSynthesis: boolean;
}) {
  return (
    <section
      aria-label="Spoken responses status"
      className="rounded-lg border border-edge bg-panel p-4"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
        <Volume2 className="size-4 text-cyan-300" aria-hidden />
        Spoken responses
      </h2>
      <div className="mt-2 divide-y divide-edge">
        <StatusRow
          label="Voice output in this browser"
          ok={browserSynthesis}
          text={browserSynthesis ? "Supported" : "Not supported"}
        />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        On-device browser voices — spoken instructions never leave your device as audio.
      </p>
    </section>
  );
}
