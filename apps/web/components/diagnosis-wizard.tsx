"use client";

import { useState } from "react";
import {
  AppWindow,
  ArrowLeft,
  ArrowRight,
  BatteryCharging,
  Camera,
  Check,
  FlaskConical,
  Gauge,
  HardDrive,
  ImagePlus,
  Keyboard,
  Laptop,
  Mic,
  Monitor,
  Plug,
  ShieldAlert,
  Smartphone,
  Speaker,
  ThermometerSun,
  Wifi,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MANUFACTURERS,
  OTHER_VALUE,
  modelsFor,
  type DeviceTypeOption,
} from "@/lib/device-options";
import { PROBLEM_CATEGORIES } from "@/lib/problem-categories";
import { SAMPLE_ANALYSIS_STEPS } from "@/lib/demo-runner";
import {
  ACCEPTED_EVIDENCE_TYPES,
  EVIDENCE_TYPE_LABEL,
  isVideoMimeType,
  validateEvidenceFile,
} from "@/lib/evidence-files";
import { cn } from "@/lib/utils";
import { AnalysisLoader } from "./fx/analysis-loader";
import { DeviceScene } from "./fx/device-scene";

const CATEGORY_ICONS: Record<string, typeof Plug> = {
  power: Plug,
  battery: BatteryCharging,
  display: Monitor,
  keyboard: Keyboard,
  overheating: ThermometerSun,
  performance: Gauge,
  storage: HardDrive,
  network: Wifi,
  audio: Speaker,
  screen: Smartphone,
  camera: Camera,
  speaker: Mic,
  software: AppWindow,
  physical: ShieldAlert,
};

const DEVICE_CARDS = [
  { value: "laptop", icon: Laptop, title: "Laptop", hint: "Portables & notebooks" },
  { value: "desktop", icon: Monitor, title: "Desktop", hint: "Towers & all-in-ones" },
  { value: "smartphone", icon: Smartphone, title: "Smartphone", hint: "Mobile phones" },
] as const;

const STEPS = ["Device", "Problem", "Details", "Review"] as const;
const WIZARD_MAX_FILE_MB = 10;
const WIZARD_MAX_FILES = 8;

const inputClass =
  "w-full rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500";

export interface WizardStartInput {
  device: DeviceTypeOption;
  category: string;
  manufacturer: string;
  model: string;
  os: string;
  symptoms: string;
  userMode: "everyday" | "technician";
  files: File[];
}

interface WizardState {
  device: DeviceTypeOption;
  category: string;
  customProblem: string;
  manufacturer: string;
  manufacturerCustom: string;
  model: string;
  modelCustom: string;
  os: string;
  symptoms: string;
  userMode: "everyday" | "technician";
  files: File[];
}

interface DiagnosisWizardProps {
  initialDevice: DeviceTypeOption;
  /** Demo runs mirror every step but start a local simulation, never the API. */
  demo?: boolean;
  starting: boolean;
  startStep: number;
  startError: string | null;
  startDisabled?: boolean;
  onStart: (input: WizardStartInput) => void;
}

/**
 * Guided New Diagnosis flow shared by signed-in users and guests. Step
 * state and validation live here; the parent owns the start side-effect
 * (live API session vs local sample run) and drives the loader overlay.
 */
export function DiagnosisWizard({
  initialDevice,
  demo = false,
  starting,
  startStep,
  startError,
  startDisabled = false,
  onStart,
}: DiagnosisWizardProps) {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>({
    device: initialDevice,
    category: "",
    customProblem: "",
    manufacturer: "",
    manufacturerCustom: "",
    model: "",
    modelCustom: "",
    os: "",
    symptoms: "",
    userMode: "everyday",
    files: [],
  });
  const [fileError, setFileError] = useState<string | null>(null);

  const patch = (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p }));
  const categories = PROBLEM_CATEGORIES[state.device];

  const selectDevice = (device: DeviceTypeOption) =>
    setState((s) => ({
      ...s,
      device,
      category: "",
      manufacturer: "",
      manufacturerCustom: "",
      model: "",
      modelCustom: "",
    }));

  const selectCategory = (value: string) => {
    const found = categories.find((c) => c.value === value);
    setState((s) => ({
      ...s,
      category: value,
      symptoms: found ? found.defaultSymptoms : s.symptoms,
    }));
  };

  const addFiles = (list: FileList | null) => {
    if (!list) {
      return;
    }
    setFileError(null);
    const accepted: File[] = [];
    for (const file of Array.from(list)) {
      const problem = validateEvidenceFile(file, WIZARD_MAX_FILE_MB * 1024 * 1024);
      if (problem) {
        setFileError(problem);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length > 0) {
      setState((s) => ({ ...s, files: [...s.files, ...accepted].slice(0, WIZARD_MAX_FILES) }));
    }
  };

  const canNext =
    step === 0 ||
    (step === 1 && (state.category !== "" || state.customProblem.trim() !== "")) ||
    (step === 2 && state.symptoms.trim().length >= 3);
  const canStart = state.symptoms.trim().length >= 3;

  const startInput = (): WizardStartInput => ({
    device: state.device,
    category: state.category,
    manufacturer:
      state.manufacturer === OTHER_VALUE ? state.manufacturerCustom.trim() : state.manufacturer,
    model: state.model === OTHER_VALUE ? state.modelCustom.trim() : state.model,
    os: state.os.trim(),
    symptoms: state.customProblem.trim() !== "" && state.category === ""
      ? `${state.customProblem.trim()} — ${state.symptoms.trim()}`
      : state.symptoms.trim(),
    userMode: state.userMode,
    files: state.files,
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-50">
          <FlaskConical className="size-5 text-cyan-300" aria-hidden />
          {demo ? "Try a Sample Diagnosis" : "New Diagnosis"}
        </h1>
        {demo && (
          <p className="mt-1.5 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-slate-300">
            Sample run with fictional data — the same steps as a real diagnosis, but every result
            is simulated on this device. Photos never leave your browser in the demo.
          </p>
        )}
        <ol className="mt-3 flex items-center gap-1.5" role="list" aria-label="Progress">
          {STEPS.map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-1.5" aria-current={i === step ? "step" : undefined}>
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  i < step
                    ? "bg-emerald-400/15 text-emerald-300"
                    : i === step
                      ? "bg-cyan-400/15 text-cyan-200"
                      : "bg-panel text-slate-500",
                )}
              >
                {i < step ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span className={cn("hidden text-xs sm:inline", i === step ? "text-slate-200" : "text-slate-500")}>
                {label}
              </span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-edge" aria-hidden />}
            </li>
          ))}
        </ol>
      </div>

      {step === 0 && (
        <section aria-labelledby="step-device">
          <h2 id="step-device" className="text-sm font-medium text-slate-200">
            What are you fixing?
          </h2>
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3" role="list">
            {DEVICE_CARDS.map(({ value, icon: Icon, title, hint }) => (
              <li key={value}>
                <button
                  type="button"
                  onClick={() => selectDevice(value)}
                  aria-pressed={state.device === value}
                  className={cn(
                    "flex w-full flex-col items-stretch gap-2 rounded-xl border p-3 text-left transition-colors",
                    state.device === value
                      ? "border-cyan-400/50 bg-cyan-400/5"
                      : "border-edge bg-panel hover:border-edge-strong",
                  )}
                >
                  <DeviceScene device={value} scanning={state.device === value} />
                  <span className="flex items-center gap-2 px-1 pb-1">
                    <Icon className="size-5 shrink-0 text-cyan-300" aria-hidden />
                    <span>
                      <span className="block text-sm font-medium text-slate-100">{title}</span>
                      <span className="block text-xs text-slate-500">{hint}</span>
                    </span>
                    {state.device === value && (
                      <Check className="ml-auto size-4 shrink-0 text-cyan-300" aria-hidden />
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 1 && (
        <section aria-labelledby="step-problem">
          <h2 id="step-problem" className="text-sm font-medium text-slate-200">
            What kind of problem is it?
          </h2>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" role="list">
            {categories.map(({ value, label }) => {
              const Icon = CATEGORY_ICONS[value] ?? ShieldAlert;
              return (
                <li key={value}>
                  <button
                    type="button"
                    onClick={() => selectCategory(value)}
                    aria-pressed={state.category === value}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl border p-3 text-left transition-colors",
                      state.category === value
                        ? "border-cyan-400/50 bg-cyan-400/5"
                        : "border-edge bg-panel hover:border-edge-strong",
                    )}
                  >
                    <Icon className="size-5 shrink-0 text-cyan-300" aria-hidden />
                    <span className="text-[13px] font-medium text-slate-100">{label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-3">
            <label htmlFor="wizard-custom-problem" className="text-xs font-medium text-slate-300">
              Doesn&apos;t fit? Describe it instead <span className="text-slate-500">(optional)</span>
            </label>
            <input
              id="wizard-custom-problem"
              value={state.customProblem}
              onChange={(e) => patch({ customProblem: e.target.value, category: "" })}
              placeholder="e.g. Makes a clicking sound when I open the lid"
              maxLength={200}
              className={`${inputClass} mt-1`}
            />
          </div>
        </section>
      )}

      {step === 2 && (
        <section aria-labelledby="step-details" className="flex flex-col gap-4">
          <h2 id="step-details" className="text-sm font-medium text-slate-200">
            Device details & evidence
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="wizard-manufacturer" className="text-xs font-medium text-slate-300">
                Manufacturer <span className="text-slate-500">(optional)</span>
              </label>
              <select
                id="wizard-manufacturer"
                value={state.manufacturer}
                onChange={(e) => patch({ manufacturer: e.target.value, model: "", modelCustom: "" })}
                className={`${inputClass} mt-1`}
              >
                <option value="">Select…</option>
                {MANUFACTURERS[state.device].map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value={OTHER_VALUE}>Other…</option>
              </select>
              {state.manufacturer === OTHER_VALUE && (
                <input
                  value={state.manufacturerCustom}
                  onChange={(e) => patch({ manufacturerCustom: e.target.value })}
                  placeholder="Type the manufacturer"
                  maxLength={120}
                  aria-label="Custom manufacturer"
                  className={`${inputClass} mt-1.5`}
                />
              )}
            </div>
            <div>
              <label htmlFor="wizard-model" className="text-xs font-medium text-slate-300">
                Model <span className="text-slate-500">(optional)</span>
              </label>
              <select
                id="wizard-model"
                value={state.model}
                onChange={(e) => patch({ model: e.target.value })}
                className={`${inputClass} mt-1`}
              >
                <option value="">Select…</option>
                {modelsFor(state.manufacturer, state.device).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value={OTHER_VALUE}>Other…</option>
              </select>
              {state.model === OTHER_VALUE && (
                <input
                  value={state.modelCustom}
                  onChange={(e) => patch({ modelCustom: e.target.value })}
                  placeholder="Type the model"
                  maxLength={120}
                  aria-label="Custom model"
                  className={`${inputClass} mt-1.5`}
                />
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="wizard-os" className="text-xs font-medium text-slate-300">
                Operating system <span className="text-slate-500">(optional)</span>
              </label>
              <input
                id="wizard-os"
                value={state.os}
                onChange={(e) => patch({ os: e.target.value })}
                placeholder={state.device === "smartphone" ? "e.g. Android 15" : "e.g. Windows 11"}
                maxLength={120}
                className={`${inputClass} mt-1`}
              />
            </div>
            <fieldset>
              <legend className="text-xs font-medium text-slate-300">I am a…</legend>
              <div className="mt-1 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Diagnostic mode">
                {(["everyday", "technician"] as const).map((mode) => (
                  <label
                    key={mode}
                    className={cn(
                      "cursor-pointer rounded-md border px-2.5 py-2 text-center text-xs capitalize transition-colors",
                      state.userMode === mode
                        ? "border-cyan-400/50 bg-cyan-400/5 text-slate-50"
                        : "border-edge text-slate-300",
                    )}
                  >
                    <input
                      type="radio"
                      name="user_mode"
                      value={mode}
                      checked={state.userMode === mode}
                      onChange={() => patch({ userMode: mode })}
                      className="sr-only"
                    />
                    {mode === "everyday" ? "Device owner" : "Technician"}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <div>
            <label htmlFor="wizard-symptoms" className="text-xs font-medium text-slate-300">
              Symptoms
            </label>
            <textarea
              id="wizard-symptoms"
              rows={3}
              value={state.symptoms}
              onChange={(e) => patch({ symptoms: e.target.value })}
              placeholder="What is the device doing wrong?"
              className={`${inputClass} mt-1 resize-y`}
            />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-300">
              Evidence photos & videos <span className="text-slate-500">(optional, up to {WIZARD_MAX_FILES})</span>
            </p>
            <label
              htmlFor="wizard-files"
              className="mt-1 flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-edge-strong bg-panel p-6 text-center transition-colors hover:border-cyan-400/40"
            >
              <ImagePlus className="size-6 text-slate-400" aria-hidden />
              <span className="text-sm text-slate-300">Drop photos or videos here or click to browse</span>
              <span className="text-[11px] text-slate-500">
                {EVIDENCE_TYPE_LABEL} · {WIZARD_MAX_FILE_MB} MB each
                {demo ? " · stay on this device" : ""}
              </span>
            </label>
            <input
              id="wizard-files"
              type="file"
              accept={ACCEPTED_EVIDENCE_TYPES.join(",")}
              multiple
              className="sr-only"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {fileError != null && (
              <p role="alert" className="mt-1.5 text-xs text-amber-200">
                {fileError}
              </p>
            )}
            {state.files.length > 0 && (
              <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4" role="list">
                {state.files.map((file, i) => (
                  <li key={`${file.name}-${i}`} className="relative overflow-hidden rounded-lg border border-edge">
                    {isVideoMimeType(file.type) ? (
                      <video
                        src={URL.createObjectURL(file)}
                        aria-label={file.name}
                        muted
                        playsInline
                        preload="metadata"
                        className="aspect-square w-full object-cover"
                      />
                    ) : (
                      <img
                        src={URL.createObjectURL(file)}
                        alt={file.name}
                        className="aspect-square w-full object-cover"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setState((s) => ({ ...s, files: s.files.filter((_, j) => j !== i) }))
                      }
                      aria-label={`Remove ${file.name}`}
                      className="absolute top-1 right-1 rounded-full bg-canvas/90 p-1 text-slate-300 hover:text-slate-50"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {step === 3 && (
        <section aria-labelledby="step-review">
          <h2 id="step-review" className="text-sm font-medium text-slate-200">
            Ready to start?
          </h2>
          <dl className="mt-3 flex flex-col gap-2 rounded-xl border border-edge bg-panel p-4 text-sm">
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-slate-500">Device</dt>
              <dd className="text-slate-100 capitalize">{state.device}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-slate-500">Problem</dt>
              <dd className="text-slate-100">
                {state.category
                  ? (categories.find((c) => c.value === state.category)?.label ?? state.category)
                  : (state.customProblem.trim() || "—")}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-slate-500">Model</dt>
              <dd className="text-slate-100">
                {[state.manufacturer === OTHER_VALUE ? state.manufacturerCustom : state.manufacturer,
                  state.model === OTHER_VALUE ? state.modelCustom : state.model]
                  .filter(Boolean)
                  .join(" ") || "—"}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-slate-500">Evidence</dt>
              <dd className="text-slate-100">
                {state.files.length === 0 ? "None" : `${state.files.length} attached`}
              </dd>
            </div>
          </dl>
          {startError != null && (
            <p role="alert" className="mt-3 text-sm text-red-300">
              {demo ? "Couldn't start the sample run: " : "Couldn't start the diagnosis: "}
              {startError}
            </p>
          )}
        </section>
      )}

      <div className="flex items-center gap-2">
        {step > 0 && (
          <Button type="button" variant="secondary" onClick={() => setStep(step - 1)} disabled={starting}>
            <ArrowLeft aria-hidden />
            Back
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          {step < 3 ? (
            <Button type="button" onClick={() => canNext && setStep(step + 1)} disabled={!canNext}>
              Continue
              <ArrowRight aria-hidden />
            </Button>
          ) : (
            <Button type="button" onClick={() => onStart(startInput())} disabled={starting || startDisabled || !canStart}>
              {starting ? "Starting…" : demo ? "Start Sample Diagnosis" : "Start Diagnosis"}
            </Button>
          )}
        </div>
      </div>

      {starting && (
        <AnalysisLoader
          variant="overlay"
          device={state.device}
          title={demo ? "Running sample analysis" : "Starting your diagnosis"}
          steps={
            demo
              ? [...SAMPLE_ANALYSIS_STEPS]
              : ["Creating your session", "Uploading evidence", "Preparing the workspace"]
          }
          activeStep={startStep}
          simulated={demo}
        />
      )}
    </div>
  );
}
