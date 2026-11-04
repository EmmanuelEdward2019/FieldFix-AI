"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardList,
  Loader2,
  Mic,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import type {
  TestResultOption,
  VoiceCapabilities,
  VoicePreferences,
} from "@fieldfix/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  describeApiError,
  getVoiceCapabilitiesApi,
  getVoicePreferencesApi,
  isAbortError,
  logVoiceInteractionApi,
  recordTestResultApi,
  requestSpeakPolicyApi,
  transcribeVoiceApi,
  updateVoicePreferencesApi,
  type UploadProgress,
} from "@/lib/api";
import type { DemoSession } from "@/lib/demo-data";
import { cn } from "@/lib/utils";
import {
  cancelSpeech,
  describeCaptureError,
  loadSpeechVoices,
  LOW_CONFIDENCE_THRESHOLD,
  pauseSpeech,
  recognizeOnce,
  resumeSpeech,
  speakText,
  startRecording,
  transcodeToWavMono16k,
  voiceSupport,
  VoiceCaptureError,
  type AudioRecorder,
  type VoiceSupport,
  type VoiceSynthesisVoice,
} from "@/lib/voice-capture";
import {
  buildInstructionSpeech,
  DEFAULT_VOICE_LANGUAGE,
  guidanceStateFor,
  matchTranscriptToOption,
} from "@/lib/voice-guidance";
import { EmptyState } from "./empty-state";
import { humanize } from "./status-badges";

export interface VoiceLiveActions {
  sessionId: string;
  token: string;
  onChanged: () => void;
}

interface VoicePanelProps {
  session: DemoSession;
  live?: VoiceLiveActions;
}

/** Prefer the capture message for capture failures, API text otherwise. */
function describeVoiceError(err: unknown): string {
  if (err instanceof VoiceCaptureError) {
    return describeCaptureError(err);
  }
  return describeApiError(err);
}

type SettingsState =
  | { status: "loading" }
  | { status: "ready"; prefs: VoicePreferences; caps: VoiceCapabilities }
  | { status: "error"; message: string };

type CapturePhase =
  | "idle"
  | "listening"
  | "recording"
  | "transcoding"
  | "transcribing";

interface Draft {
  text: string;
  confidence: number | null;
  source: "browser" | "server" | "typed";
}

/**
 * Voice-guided diagnostics, mounted inside the diagnostic workspace.
 * Live sessions speak each instruction and accept dictated answers
 * (edited before submit, then saved through the existing test-result
 * endpoint); demo mode shows an honest placeholder and never calls
 * the API or touches the microphone.
 */
export function VoicePanel({ session, live }: VoicePanelProps) {
  if (!live) {
    return <VoiceDemoCard />;
  }
  return <VoiceLivePanel session={session} live={live} />;
}

function VoiceDemoCard() {
  return (
    <Card aria-labelledby="voice-demo-title">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle id="voice-demo-title" className="flex items-center gap-2">
          <Mic className="size-4 text-cyan-300" aria-hidden />
          Voice guidance
        </CardTitle>
        <Badge variant="warning">Demo</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-slate-300">
          Voice-guided diagnostics runs in live sessions: each test
          instruction is read aloud, and answers can be dictated, corrected,
          and recorded hands-free.
        </p>
        <p className="text-xs text-slate-500">
          The demo never touches the microphone or the voice API.
        </p>
      </CardContent>
    </Card>
  );
}

function VoiceLivePanel({
  session,
  live,
}: {
  session: DemoSession;
  live: VoiceLiveActions;
}) {
  const [settings, setSettings] = useState<SettingsState>({ status: "loading" });
  const [reloadCounter, setReloadCounter] = useState(0);
  const [support] = useState<VoiceSupport>(() => voiceSupport());
  const [voices, setVoices] = useState<VoiceSynthesisVoice[]>([]);

  const [voiceOn, setVoiceOn] = useState(true);
  const [voiceURI, setVoiceURI] = useState<string | null>(null);
  const [rate, setRate] = useState(1);
  const [language, setLanguage] = useState(DEFAULT_VOICE_LANGUAGE);
  const [languageDraft, setLanguageDraft] = useState(DEFAULT_VOICE_LANGUAGE);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [playback, setPlayback] = useState<"idle" | "speaking" | "paused">("idle");
  const [playbackBusy, setPlaybackBusy] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [substitutedNote, setSubstitutedNote] = useState<string | null>(null);

  const [phase, setPhase] = useState<CapturePhase>("idle");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [interim, setInterim] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [manualPick, setManualPick] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [safetyNotice, setSafetyNotice] = useState<string | null>(null);

  const captureAbort = useRef<AbortController | null>(null);
  const recorder = useRef<AudioRecorder | null>(null);
  const userStopped = useRef(false);
  const speakAfterRefresh = useRef(false);
  const safetySpeakAttempted = useRef(false);
  const testsKey = session.tests
    .map((t) => `${t.id}:${t.result ? "1" : "0"}`)
    .join(",");

  const guidance = useMemo(
    () =>
      guidanceStateFor({
        safety_state: session.safety_state,
        tests: session.tests,
      }),
    [session.safety_state, session.tests],
  );
  const halted =
    guidance.kind === "critical_stop" ||
    guidance.kind === "review_required";
  const step = guidance.step;
  const speechText = useMemo(
    () =>
      step
        ? buildInstructionSpeech({
            test: step.test,
            stepNumber: step.stepNumber,
            total: step.total,
          })
        : null,
    [step],
  );
  const matched: TestResultOption | null = useMemo(
    () =>
      draft && step
        ? matchTranscriptToOption(draft.text, step.test.result_options)
        : null,
    [draft, step],
  );
  const lowConfidence =
    draft?.confidence != null && draft.confidence < LOW_CONFIDENCE_THRESHOLD;

  const caps = settings.status === "ready" ? settings.caps : null;
  const serverStt = caps?.stt.available === true;
  const captureMode: "browser" | "server" | "none" = support.speechRecognition
    ? "browser"
    : serverStt && support.mediaRecorder && support.microphone
      ? "server"
      : "none";

  // Load preferences + capabilities (login token; live mode only).
  useEffect(() => {
    const controller = new AbortController();
    setSettings({ status: "loading" });
    setSettingsError(null);
    void Promise.all([
      getVoicePreferencesApi(live.token, controller.signal),
      getVoiceCapabilitiesApi(live.token, controller.signal),
    ]).then(
      ([prefsRes, capsRes]) => {
        setSettings({ status: "ready", prefs: prefsRes.preferences, caps: capsRes });
        setVoiceOn(prefsRes.preferences.spoken_responses);
        setVoiceURI(prefsRes.preferences.voice_id);
        setRate(prefsRes.preferences.rate);
        setLanguage(prefsRes.preferences.language);
        setLanguageDraft(prefsRes.preferences.language);
      },
      (err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) {
          return;
        }
        setSettings({ status: "error", message: describeApiError(err) });
      },
    );
    return () => controller.abort();
  }, [live.token, reloadCounter]);

  // Browser speech voices (populated asynchronously; empty when unsupported).
  useEffect(() => {
    let cancelled = false;
    void loadSpeechVoices().then((loaded) => {
      if (!cancelled) {
        setVoices(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Release mic + speech on unmount.
  useEffect(
    () => () => {
      captureAbort.current?.abort();
      recorder.current?.cancel();
      recorder.current = null;
      cancelSpeech();
    },
    [],
  );

  // Elapsed indicator while listening/recording.
  useEffect(() => {
    if (phase !== "listening" && phase !== "recording") {
      return;
    }
    setElapsed(0);
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const playText = useCallback(
    async (text: string) => {
      setPlaybackBusy(true);
      setPlaybackError(null);
      setSubstitutedNote(null);
      try {
        const policy = await requestSpeakPolicyApi(live.token, {
          text,
          session_id: live.sessionId,
          ...(voiceURI ? { voice_id: voiceURI } : {}),
          rate,
          language,
        });
        if (policy.substituted) {
          setSubstitutedNote(
            policy.warnings[0] ??
              "Playing the safety guidance instead of the requested text.",
          );
        }
        speakText(policy.text, {
          voiceURI: policy.voice_id,
          rate: policy.rate,
          language: policy.language,
          onend: () => setPlayback("idle"),
          onerror: (message) => {
            setPlayback("idle");
            setPlaybackError(message);
          },
        });
        setPlayback("speaking");
      } catch (err: unknown) {
        setPlayback("idle");
        setPlaybackError(describeVoiceError(err));
      } finally {
        setPlaybackBusy(false);
      }
    },
    [live.token, live.sessionId, voiceURI, rate, language],
  );

  const playInstruction = useCallback(() => {
    if (speechText) {
      void playText(speechText);
    }
  }, [playText, speechText]);

  // Speak the next instruction after a recorded answer refreshes the session.
  useEffect(() => {
    if (speakAfterRefresh.current && speechText && voiceOn && !halted) {
      speakAfterRefresh.current = false;
      void playText(speechText);
    }
    if (halted) {
      speakAfterRefresh.current = false;
    }
    // testsKey drives this: runs when results change.
  }, [testsKey]);

  // Critical stop: attempt the safety warning once (user gesture
  // policies may block it; the replay button always remains).
  useEffect(() => {
    if (
      guidance.kind === "critical_stop" &&
      settings.status === "ready" &&
      voiceOn &&
      !safetySpeakAttempted.current
    ) {
      safetySpeakAttempted.current = true;
      const latest = session.safety_events[session.safety_events.length - 1];
      void playText(
        latest?.safe_next_steps ??
          "Stop. A hazard was identified and testing is blocked.",
      ).catch(() => undefined);
    }
  }, [guidance.kind, settings.status, voiceOn, session.safety_events, playText]);

  const persistPrefs = useCallback(
    async (patch: Parameters<typeof updateVoicePreferencesApi>[1]) => {
      setSettingsError(null);
      try {
        const res = await updateVoicePreferencesApi(live.token, patch);
        setSettings((prev) =>
          prev.status === "ready"
            ? { ...prev, prefs: res.preferences }
            : prev,
        );
      } catch (err: unknown) {
        setSettingsError(describeApiError(err));
      }
    },
    [live.token],
  );

  // Debounced rate persistence (range drags fire continuously).
  useEffect(() => {
    if (settings.status !== "ready" || settings.prefs.rate === rate) {
      return;
    }
    const timer = setTimeout(() => void persistPrefs({ rate }), 500);
    return () => clearTimeout(timer);
  }, [rate, settings, persistPrefs]);

  const toggleVoice = useCallback(() => {
    const next = !voiceOn;
    setVoiceOn(next);
    if (!next) {
      cancelSpeech();
      setPlayback("idle");
    }
    void persistPrefs({ spoken_responses: next });
  }, [voiceOn, persistPrefs]);

  const applyLanguage = useCallback(() => {
    const value = languageDraft.trim();
    if (value.length < 2 || value.length > 20) {
      setSettingsError("Language must be 2–20 characters (e.g. en).");
      return;
    }
    setLanguage(value);
    void persistPrefs({ language: value });
  }, [languageDraft, persistPrefs]);

  const beginDraft = useCallback(
    (next: Draft) => {
      setDraft(next);
      setManualPick(false);
      setRecordError(null);
      setSafetyNotice(null);
      if (step) {
        setSelectedOption(
          matchTranscriptToOption(next.text, step.test.result_options)?.value ??
            null,
        );
      }
    },
    [step],
  );

  const stopCapture = useCallback(() => {
    if (phase === "listening") {
      userStopped.current = true;
      captureAbort.current?.abort();
      return;
    }
    if (phase === "recording" && recorder.current) {
      const active = recorder.current;
      recorder.current = null;
      setPhase("transcoding");
      setProgress(null);
      void active
        .stop()
        .then(async (blob) => {
          const wav = await transcodeToWavMono16k(blob);
          const maxBytes = caps?.stt.max_audio_bytes;
          if (maxBytes != null && wav.size > maxBytes) {
            throw new Error(
              `Clip is too large (${Math.round(wav.size / 1024)} KB). Keep answers short.`,
            );
          }
          setPhase("transcribing");
          const controller = new AbortController();
          captureAbort.current = controller;
          return transcribeVoiceApi(live.sessionId, live.token, wav, {
            languageBias: language,
            onProgress: setProgress,
            signal: controller.signal,
          });
        })
        .then((res) => {
          setPhase("idle");
          setProgress(null);
          if (!res.transcript.trim()) {
            setCaptureError(
              "The transcription came back empty. Repeat your answer or type it instead.",
            );
            return;
          }
          beginDraft({
            text: res.transcript,
            confidence: null,
            source: "server",
          });
          if (res.blocked || res.warnings.length > 0) {
            setSafetyNotice(
              res.warnings[0] ??
                "The session safety state changed. Ordinary guidance is halted.",
            );
            live.onChanged();
          }
        })
        .catch((err: unknown) => {
          setPhase("idle");
          setProgress(null);
          if (err instanceof Error && err.name === "AbortError") {
            return;
          }
          setCaptureError(describeVoiceError(err));
        });
    }
  }, [phase, caps, live, language, beginDraft]);

  const cancelCapture = useCallback(() => {
    userStopped.current = true;
    captureAbort.current?.abort();
    captureAbort.current = null;
    recorder.current?.cancel();
    recorder.current = null;
    setPhase("idle");
    setInterim("");
    setProgress(null);
  }, []);

  const startVoiceInput = useCallback(() => {
    if (halted || phase !== "idle" || !step) {
      return;
    }
    setCaptureError(null);
    setSafetyNotice(null);
    setInterim("");
    userStopped.current = false;
    if (captureMode === "browser") {
      setPhase("listening");
      const controller = new AbortController();
      captureAbort.current = controller;
      void recognizeOnce({
        language,
        oninterim: setInterim,
        signal: controller.signal,
      }).then(
        (res) => {
          captureAbort.current = null;
          setPhase("idle");
          setInterim("");
          if (!res.transcript.trim()) {
            setCaptureError(
              "No speech was detected. Try again or type your answer instead.",
            );
            return;
          }
          beginDraft({
            text: res.transcript,
            confidence: res.confidence,
            source: "browser",
          });
        },
        (err: unknown) => {
          captureAbort.current = null;
          setPhase("idle");
          setInterim("");
          if (userStopped.current) {
            return;
          }
          setCaptureError(describeCaptureError(err));
        },
      );
      return;
    }
    if (captureMode === "server") {
      setPhase("recording");
      void startRecording()
        .then((handle) => {
          recorder.current = handle;
        })
        .catch((err: unknown) => {
          setPhase("idle");
          setCaptureError(describeCaptureError(err));
        });
      return;
    }
    setCaptureError(
      "Voice input is not available here: this browser has no speech recognition or recorder, and server transcription is off. Type your answer instead.",
    );
  }, [halted, phase, step, captureMode, language, beginDraft]);

  const submitAnswer = useCallback(() => {
    if (!step || !draft || recordBusy) {
      return;
    }
    const observation = draft.text.trim();
    if (!selectedOption) {
      setRecordError(
        "Choose the result that matches the answer before recording.",
      );
      return;
    }
    if (observation.length > 4000) {
      setRecordError("Shorten the answer to 4000 characters or fewer.");
      return;
    }
    setRecordBusy(true);
    setRecordError(null);
    const log =
      draft.source === "server" || observation.length === 0
        ? Promise.resolve(null)
        : logVoiceInteractionApi(live.sessionId, live.token, {
            role: "user",
            text: observation,
          });
    void log
      .then((logged) => {
        if (logged && (logged.blocked || logged.warnings.length > 0)) {
          setSafetyNotice(
            logged.warnings[0] ??
              "The session safety state changed. Ordinary guidance is halted.",
          );
        }
        return recordTestResultApi(live.sessionId, step.test.id, live.token, {
          selected_option: selectedOption,
          observation: observation || null,
        });
      })
      .then(() => {
        setRecordBusy(false);
        setDraft(null);
        setSelectedOption(null);
        if (voiceOn) {
          speakAfterRefresh.current = true;
        }
        live.onChanged();
      })
      .catch((err: unknown) => {
        setRecordBusy(false);
        setRecordError(describeApiError(err));
      });
  }, [step, draft, recordBusy, selectedOption, live, voiceOn]);

  const latestSafety =
    session.safety_events[session.safety_events.length - 1];

  return (
    <Card aria-labelledby="voice-title">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle id="voice-title" className="flex items-center gap-2">
          <Mic className="size-4 text-cyan-300" aria-hidden />
          Voice guidance
        </CardTitle>
        <div className="flex items-center gap-2">
          {guidance.kind === "critical_stop" ? (
            <Badge variant="danger">Stopped</Badge>
          ) : guidance.kind === "review_required" ? (
            <Badge variant="warning">Review</Badge>
          ) : (
            <Badge variant={voiceOn ? "success" : "muted"}>
              {voiceOn ? "On" : "Off"}
            </Badge>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggleVoice}
            disabled={settings.status !== "ready"}
            aria-pressed={voiceOn}
            aria-label={
              voiceOn ? "Turn spoken responses off" : "Turn spoken responses on"
            }
          >
            {voiceOn ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
            {voiceOn ? "Mute" : "Unmute"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {guidance.kind === "critical_stop" && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-lg border border-red-400/30 bg-red-400/5 p-3"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <ShieldAlert className="size-4 shrink-0 text-red-300" aria-hidden />
              Stop — hazard identified
            </p>
            <p className="text-xs text-slate-300">
              {latestSafety?.trigger_detail ??
                "The safety controller stopped this session."}{" "}
              Ordinary voice guidance is halted.
            </p>
            {latestSafety?.safe_next_steps && (
              <p className="rounded-md bg-canvas/60 px-3 py-2 text-xs text-slate-200">
                <span className="font-medium text-slate-100">
                  Safe next steps:{" "}
                </span>
                {latestSafety.safe_next_steps}
              </p>
            )}
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  void playText(
                    latestSafety?.safe_next_steps ??
                      "Stop. A hazard was identified and testing is blocked.",
                  )
                }
                disabled={playbackBusy || settings.status !== "ready"}
              >
                {playbackBusy ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Play aria-hidden />
                )}
                Play safety warning
              </Button>
            </div>
          </div>
        )}

        {guidance.kind === "review_required" && (
          <p
            role="status"
            className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-slate-300"
          >
            A technician must clear this session first. Voice guidance is
            paused until the review completes.
          </p>
        )}

        {guidance.kind === "no_tests" && !halted && (
          <EmptyState
            icon={ClipboardList}
            title="No tests to guide yet"
            hint="Voice guidance starts once the session has safe, distinguishing tests."
          />
        )}

        {guidance.kind === "all_done" && !halted && (
          <p role="status" className="text-sm text-slate-300">
            All tests are recorded. Review the compiled findings in the repair
            report below.
          </p>
        )}

        {step && !halted && (
          <section aria-label="Current voice instruction">
            <p className="text-xs font-semibold tracking-wide text-cyan-300 uppercase">
              Test {step.stepNumber} of {step.total}
            </p>
            <h3 className="mt-0.5 text-sm font-semibold text-slate-50">
              {step.test.name}
            </h3>
            <ol
              className="mt-2 flex flex-col gap-1"
              aria-label="Instruction steps"
            >
              {[...step.test.instructions]
                .sort((a, b) => a.step - b.step)
                .slice(0, 3)
                .map((instruction) => (
                  <li
                    key={instruction.step}
                    className="flex items-start gap-2 text-xs text-slate-300"
                  >
                    <span
                      className="flex size-4 shrink-0 items-center justify-center rounded-full border border-edge-strong text-[10px] font-semibold text-slate-300 tabular-nums"
                      aria-hidden
                    >
                      {instruction.step}
                    </span>
                    {instruction.text}
                  </li>
                ))}
            </ol>
            <p className="mt-2 text-xs text-slate-500">
              {step.nextTest
                ? `Up next: ${step.nextTest.name}`
                : "Last test in this session."}
            </p>
          </section>
        )}

        {settings.status === "loading" && (
          <div className="flex flex-col gap-2" aria-label="Loading voice settings">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        )}

        {settings.status === "error" && (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-sm text-red-300">
              Couldn&apos;t load voice settings: {settings.message}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setReloadCounter((n) => n + 1)}
            >
              <RotateCcw aria-hidden />
              Retry
            </Button>
          </div>
        )}

        {settings.status === "ready" && step && !halted && (
          <>
            <section
              aria-label="Spoken playback"
              className="flex flex-col gap-2 rounded-lg border border-edge bg-canvas/40 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={playInstruction}
                  disabled={playbackBusy || !voiceOn}
                  aria-label="Play instruction"
                >
                  {playbackBusy ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Play aria-hidden />
                  )}
                  Play
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (pauseSpeech()) {
                      setPlayback("paused");
                    }
                  }}
                  disabled={playback !== "speaking"}
                  aria-label="Pause playback"
                >
                  <Pause aria-hidden />
                  Pause
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (resumeSpeech()) {
                      setPlayback("speaking");
                    }
                  }}
                  disabled={playback !== "paused"}
                  aria-label="Resume playback"
                >
                  <Play aria-hidden />
                  Resume
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    cancelSpeech();
                    setPlayback("idle");
                  }}
                  disabled={playback === "idle"}
                  aria-label="Stop playback"
                >
                  <Square aria-hidden />
                  Stop
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={playInstruction}
                  disabled={playbackBusy || !voiceOn}
                  aria-label="Replay instruction"
                >
                  <RotateCcw aria-hidden />
                  Replay
                </Button>
                <span className="text-xs text-slate-500" role="status">
                  {playback === "speaking"
                    ? "Speaking…"
                    : playback === "paused"
                      ? "Paused"
                      : "Idle"}
                </span>
              </div>
              {playbackError && (
                <p role="alert" className="text-xs text-red-300">
                  {playbackError}
                </p>
              )}
              {substitutedNote && (
                <p role="status" className="text-xs text-amber-300">
                  {substitutedNote}
                </p>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  Spoken voice
                  <select
                    aria-label="Spoken voice"
                    value={voiceURI ?? ""}
                    onChange={(e) => {
                      const next = e.target.value || null;
                      setVoiceURI(next);
                      void persistPrefs({ voice_id: next });
                    }}
                    disabled={!voiceOn || voices.length === 0}
                    className="rounded-md border border-edge bg-panel px-2 py-1.5 text-xs text-slate-100 disabled:opacity-50"
                  >
                    <option value="">Browser default</option>
                    {voices.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  Speech rate ({rate.toFixed(2)}×)
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.1}
                    value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                    disabled={!voiceOn}
                    aria-label="Speech rate"
                    className="accent-cyan-400 disabled:opacity-50"
                  />
                </label>
                <div className="flex flex-col gap-1 text-xs text-slate-400">
                  <label htmlFor="voice-language">Recognition language</label>
                  <div className="flex gap-1.5">
                    <input
                      id="voice-language"
                      type="text"
                      value={languageDraft}
                      onChange={(e) => setLanguageDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          applyLanguage();
                        }
                      }}
                      maxLength={20}
                      aria-label="Recognition language"
                      className="w-full min-w-0 rounded-md border border-edge bg-panel px-2 py-1.5 text-xs text-slate-100"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={applyLanguage}
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                Spoken in English. Voice and rate use your browser&apos;s
                speech engine; no audio is generated server-side.
              </p>
              {settingsError && (
                <p role="alert" className="text-xs text-red-300">
                  Couldn&apos;t save voice setting: {settingsError}
                </p>
              )}
            </section>

            <section aria-label="Voice answer" className="flex flex-col gap-2">
              {phase === "idle" && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={startVoiceInput}
                    aria-label="Start voice input"
                  >
                    <Mic aria-hidden />
                    Start voice input
                  </Button>
                  {!draft && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        beginDraft({ text: "", confidence: null, source: "typed" })
                      }
                    >
                      Type your answer instead
                    </Button>
                  )}
                </div>
              )}

              {(phase === "listening" || phase === "recording") && (
                <div className="flex flex-col gap-2 rounded-lg border border-red-400/30 bg-red-400/5 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-100">
                    <span
                      className="size-2.5 animate-pulse rounded-full bg-red-400"
                      aria-hidden
                    />
                    {phase === "listening" ? "Listening" : "Recording"}…{" "}
                    {elapsed}s
                    <span className="sr-only">(voice input in progress)</span>
                  </p>
                  {interim && (
                    <p className="text-xs text-slate-400" role="status">
                      {interim}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={stopCapture}>
                      <Square aria-hidden />
                      {phase === "listening" ? "Stop" : "Stop & transcribe"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={cancelCapture}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {(phase === "transcoding" || phase === "transcribing") && (
                <div className="flex flex-col gap-2 rounded-lg border border-edge bg-canvas/40 p-3">
                  <p className="flex items-center gap-2 text-sm text-slate-200">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    {phase === "transcoding"
                      ? "Preparing audio…"
                      : "Transcribing…"}
                  </p>
                  {phase === "transcribing" && (
                    <Progress
                      value={
                        progress?.total
                          ? Math.round(
                              (progress.loaded / progress.total) * 100,
                            )
                          : undefined
                      }
                      aria-label="Transcription upload progress"
                    />
                  )}
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={cancelCapture}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {captureError && (
                <p role="alert" className="text-xs text-red-300">
                  {captureError}
                </p>
              )}

              {draft && (
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="voice-transcript"
                    className="text-xs font-medium text-slate-300"
                  >
                    Your answer — edit before submitting
                  </label>
                  <textarea
                    id="voice-transcript"
                    value={draft.text}
                    onChange={(e) => {
                      const text = e.target.value;
                      setDraft({ ...draft, text });
                      if (!manualPick && step) {
                        setSelectedOption(
                          matchTranscriptToOption(
                            text,
                            step.test.result_options,
                          )?.value ?? null,
                        );
                      }
                    }}
                    rows={3}
                    maxLength={8000}
                    aria-label="Answer transcript"
                    className="w-full rounded-md border border-edge bg-panel px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                    placeholder="Speak or type what you observed…"
                  />
                  {draft.confidence != null && (
                    <p className="text-[11px] text-slate-500">
                      Recognition confidence{" "}
                      {Math.round(draft.confidence * 100)}%
                    </p>
                  )}
                  {lowConfidence && (
                    <div
                      role="alert"
                      className="flex flex-wrap items-center gap-2 rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-200"
                    >
                      Low confidence — check the text, repeat, or type manually.
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setDraft(null);
                          setSelectedOption(null);
                          startVoiceInput();
                        }}
                      >
                        <RotateCcw aria-hidden />
                        Repeat
                      </Button>
                    </div>
                  )}
                  {matched != null ? (
                    <p role="status" className="text-xs text-emerald-300">
                      Matched: {matched.label}
                    </p>
                  ) : (
                    <p role="status" className="text-xs text-amber-300">
                      Couldn&apos;t match that to a result option — pick the
                      right one below.
                    </p>
                  )}
                  <fieldset>
                    <legend className="text-xs font-medium text-slate-300">
                      Result for {step.test.name}
                    </legend>
                    <div
                      className="mt-2 flex flex-wrap gap-2"
                      role="radiogroup"
                      aria-label="Result options"
                    >
                      {step.test.result_options.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={selectedOption === option.value}
                          onClick={() => {
                            setSelectedOption(option.value);
                            setManualPick(true);
                          }}
                          className={cn(
                            "rounded-lg border px-3 py-2 text-sm transition-colors",
                            selectedOption === option.value
                              ? "border-cyan-400/60 bg-cyan-400/10 text-slate-50"
                              : "border-edge bg-panel text-slate-300 hover:border-edge-strong",
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  {recordError && (
                    <p role="alert" className="text-xs text-red-300">
                      Couldn&apos;t record the result: {recordError}
                    </p>
                  )}
                  <div>
                    <Button
                      type="button"
                      onClick={submitAnswer}
                      disabled={recordBusy || !selectedOption}
                    >
                      {recordBusy ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : null}
                      {recordBusy ? "Recording…" : "Record result"}
                    </Button>
                  </div>
                </div>
              )}

              {safetyNotice && (
                <p role="alert" className="text-xs text-amber-300">
                  {safetyNotice}
                </p>
              )}

              {!support.speechRecognition && !serverStt && (
                <p className="text-[11px] text-slate-500">
                  On-device recognition and server transcription are both
                  unavailable — typed answers still work.
                </p>
              )}
            </section>
          </>
        )}

        {settings.status === "ready" && !step && !halted && (
          <p className="text-xs text-slate-500">
            Session safety: {humanize(session.safety_state)}. Voice input
            returns when a test needs a result.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
