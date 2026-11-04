"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Play, Square } from "lucide-react";
import type { UpdateVoicePreferences, VoiceCapabilities, VoicePreferences } from "@fieldfix/contracts";
import { SpokenResponseStatus, VoiceInputStatus } from "@/components/voice-overview";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  describeApiError,
  getVoiceCapabilitiesApi,
  getVoicePreferencesApi,
  isAbortError,
  updateVoicePreferencesApi,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  describeCaptureError,
  listSpeechVoices,
  loadSpeechVoices,
  speakText,
  voiceSupport,
  type VoiceSupport,
  type VoiceSynthesisVoice,
} from "@/lib/voice-capture";

const SAMPLE_SPEECH = "Press the power button and listen carefully for fan activity.";

const inputClass =
  "w-full rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100";

export default function VoiceGuidancePage() {
  const { token } = useAuth();
  const [support, setSupport] = useState<VoiceSupport | null>(null);
  const [capabilities, setCapabilities] = useState<VoiceCapabilities | null>(null);
  const [voices, setVoices] = useState<VoiceSynthesisVoice[]>([]);
  const [spoken, setSpoken] = useState(true);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [rate, setRate] = useState(1);
  const [savedTick, setSavedTick] = useState(0);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speakError, setSpeakError] = useState<string | null>(null);
  const cancelSpeech = useRef<(() => void) | null>(null);

  // Browser-only facts resolve after hydration so SSR never mismatches.
  useEffect(() => {
    setSupport(voiceSupport());
    setVoices(listSpeechVoices());
    let cancelled = false;
    void loadSpeechVoices().then(
      (loaded) => {
        if (!cancelled) {
          setVoices(loaded);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    void Promise.all([
      getVoicePreferencesApi(token, signal),
      getVoiceCapabilitiesApi(token, signal),
    ]).then(
      ([prefsRes, capsRes]: [{ preferences: VoicePreferences }, VoiceCapabilities]) => {
        setCapabilities(capsRes);
        setSpoken(prefsRes.preferences.spoken_responses);
        setVoiceId(prefsRes.preferences.voice_id);
        setRate(prefsRes.preferences.rate);
      },
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setLoadError(describeApiError(err));
        }
      },
    );
    return () => controller.abort();
  }, [token]);

  useEffect(
    () => () => {
      cancelSpeech.current?.();
      cancelSpeech.current = null;
    },
    [],
  );

  const save = () => {
    if (!token || saving) {
      return;
    }
    const patch: UpdateVoicePreferences = { spoken_responses: spoken, voice_id: voiceId, rate };
    setSaving(true);
    setPrefsError(null);
    void updateVoicePreferencesApi(token, patch).then(
      (res) => {
        setSaving(false);
        setSpoken(res.preferences.spoken_responses);
        setVoiceId(res.preferences.voice_id);
        setRate(res.preferences.rate);
        setSavedTick((n) => n + 1);
      },
      (err: unknown) => {
        setSaving(false);
        setPrefsError(describeApiError(err));
      },
    );
  };

  const speakSample = () => {
    setSpeakError(null);
    try {
      cancelSpeech.current?.();
      cancelSpeech.current = speakText(SAMPLE_SPEECH, {
        voiceURI: voiceId,
        rate,
        onend: () => setSpeaking(false),
        onerror: (message) => {
          setSpeaking(false);
          setSpeakError(message);
        },
      });
      setSpeaking(true);
    } catch (err: unknown) {
      setSpeaking(false);
      setSpeakError(describeCaptureError(err));
    }
  };

  const stopSample = () => {
    cancelSpeech.current?.();
    cancelSpeech.current = null;
    setSpeaking(false);
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-slate-50">Voice Guidance</h1>
        <p className="mt-1 text-sm text-slate-400">
          Speak symptoms, hear each test step, and answer hands-free inside any diagnosis.
        </p>
      </header>

      {loadError && (
        <p role="alert" className="text-sm text-red-300">
          {loadError}
        </p>
      )}

      {support == null || capabilities == null ? (
        <div role="status" aria-label="Loading voice status" className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <VoiceInputStatus
            stt={capabilities.stt}
            browserRecording={support.mediaRecorder && support.microphone}
          />
          <SpokenResponseStatus browserSynthesis={support.speechSynthesis} />
        </div>
      )}

      <section
        aria-label="Spoken response preferences"
        className="flex flex-col gap-4 rounded-lg border border-edge bg-panel p-4"
      >
        <h2 className="text-sm font-semibold text-slate-100">Spoken responses</h2>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={spoken}
            onChange={(e) => setSpoken(e.target.checked)}
            className="size-4 rounded border-edge-strong accent-cyan-400"
          />
          Read diagnostic instructions aloud
        </label>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="voice-choice" className="text-xs font-medium text-slate-300">
            Voice
          </label>
          <select
            id="voice-choice"
            value={voiceId ?? ""}
            onChange={(e) => setVoiceId(e.target.value || null)}
            className={inputClass}
          >
            <option value="">System default</option>
            {voices.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name} ({voice.lang})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="voice-rate" className="text-xs font-medium text-slate-300">
            Speech speed: {rate.toFixed(1)}×
          </label>
          <input
            id="voice-rate"
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            className="w-full accent-cyan-400"
          />
        </div>
        <p className="text-xs text-slate-500">Guidance language: English.</p>
        {prefsError && (
          <p role="alert" className="text-sm text-red-300">
            {prefsError}
          </p>
        )}
        {savedTick > 0 && !prefsError && (
          <p role="status" className="text-sm text-emerald-300">
            Preferences saved.
          </p>
        )}
        <div>
          <Button disabled={saving || !token} onClick={save}>
            {saving ? "Saving…" : "Save preferences"}
          </Button>
        </div>
      </section>

      <section
        aria-label="Try spoken guidance"
        className="flex flex-col gap-3 rounded-lg border border-edge bg-panel p-4"
      >
        <h2 className="text-sm font-semibold text-slate-100">Try it</h2>
        <p className="text-sm text-slate-300 italic">“{SAMPLE_SPEECH}”</p>
        {speakError && (
          <p role="alert" className="text-sm text-red-300">
            {speakError}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={speaking || support?.speechSynthesis === false}
            onClick={speakSample}
          >
            <Play aria-hidden /> Speak sample
          </Button>
          {speaking && (
            <Button variant="ghost" onClick={stopSample}>
              <Square aria-hidden /> Stop
            </Button>
          )}
        </div>
        {support?.speechSynthesis === false && (
          <p className="text-xs text-slate-500">
            This browser does not support spoken output.
          </p>
        )}
      </section>

      <section
        aria-label="Use voice in a diagnosis"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge bg-panel p-4"
      >
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Voice lives inside each diagnosis</h2>
          <p className="mt-1 text-sm text-slate-400">
            Open any session and press the microphone to talk through its tests.
          </p>
        </div>
        <Button asChild>
          <Link href="/diagnostics">
            Go to Diagnostics <ArrowRight aria-hidden />
          </Link>
        </Button>
      </section>
    </div>
  );
}
