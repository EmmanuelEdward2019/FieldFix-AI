import {
  createDiagnosticTestSchema,
  createEvidenceFileSchema,
  createHypothesisSchema,
  createSafetyEventSchema,
  createSessionSchema,
  diagnosticEventSchema,
  recordTestResultSchema,
  type SafetyState,
} from "@fieldfix/contracts";
import {
  assertDemoIntegrity,
  type DemoSession,
  type DemoTest,
} from "./demo-data";

/**
 * Synthetic diagnostics engine for guests. Builds integrity-checked demo
 * sessions from wizard input, screens hazard keywords, and applies
 * deterministic sample analyses. Nothing here touches the API or claims
 * live AI: every product is labelled simulated/demo in the UI.
 */

export interface DemoWizardInput {
  device: "laptop" | "desktop" | "smartphone";
  category: string;
  manufacturer: string;
  model: string;
  operatingSystem: string;
  symptoms: string;
  userMode: "everyday" | "technician";
  photos: { name: string; type: string; size: number }[];
}

export interface DemoHazardScreen {
  state: SafetyState;
  category: string | null;
  detail: string | null;
  safeSteps: string | null;
}

/**
 * Guest-side hazard screen. Mirrors the server's deterministic critical
 * rules (apps/api/src/safety/controller.ts CRITICAL_RULES) so the demo
 * fails safe on the same phrases; live sessions always enforce this on
 * the server. Caution-level nuance stays server-side.
 */
const CRITICAL_PATTERNS: { category: string; patterns: RegExp[] }[] = [
  {
    category: "battery_swelling",
    patterns: [/\bswollen\b/i, /\bswelling\b/i, /\bbulging\b/i, /\bpuffed\b/i],
  },
  {
    category: "heat_fire",
    patterns: [
      /\bsmoke\b/i,
      /\bsmoking\b/i,
      /\bhissing\b/i,
      /\bsparks?\b/i,
      /\bburning smell\b/i,
      /\bcatch(ing)? fire\b/i,
      /\bflames?\b/i,
      /\bon fire\b/i,
      /\btoo hot to (touch|hold|handle)\b/i,
    ],
  },
  {
    category: "electrical",
    patterns: [/\belectric(al)?\s+shock/i, /\bshort\s*circuit/i, /\bexposed\b.{0,20}\bwires?\b/i],
  },
  {
    category: "liquid_damage",
    patterns: [/\bbatter(y|ies)\b.{0,20}\bleak/i, /\bleak.{0,20}\b(batter|fluid|liquid|acid)\b/i],
  },
  { category: "physical_damage", patterns: [/\bpuncture(d|s)?\b/i] },
];

const SAFE_STEPS_BY_CATEGORY: Record<string, string> = {
  battery_swelling:
    "Power off if safe, do not charge or puncture it, and keep it away from heat.",
  heat_fire: "Ventilate the area, do not inhale smoke, and keep the device away from flammables.",
  electrical: "Disconnect power where safe to do so; do not touch exposed conductors.",
  liquid_damage: "Do not charge or power on; keep the device dry and ventilated.",
  physical_damage: "Do not press on the damaged area; keep the device powered off.",
};

export function screenDemoHazards(text: string): DemoHazardScreen {
  for (const rule of CRITICAL_PATTERNS) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        const match = text.match(pattern)?.[0] ?? rule.category;
        return {
          state: "critical_stop",
          category: rule.category,
          detail: `Demo screen matched "${match}" — live sessions enforce this on the server.`,
          safeSteps:
            SAFE_STEPS_BY_CATEGORY[rule.category] ??
            "Stop and keep the device powered off.",
        };
      }
    }
  }
  return { state: "normal", category: null, detail: null, safeSteps: null };
}

export const SAMPLE_ANALYSIS_STEPS = [
  "Reading your symptom notes",
  "Scanning evidence photos",
  "Matching known failure patterns",
  "Drafting possible causes",
  "Planning safe first tests",
] as const;

interface SampleHypothesis {
  title: string;
  description: string;
  confidence: "low" | "medium" | "high";
  rationale: string;
}

interface SampleTest {
  name: string;
  objective: string;
  tools: string[];
  skill: "beginner" | "intermediate" | "advanced";
  instructions: string[];
  options: { value: string; label: string }[];
}

interface SamplePack {
  hypotheses: SampleHypothesis[];
  tests: SampleTest[];
}

const POWER_PACK: SamplePack = {
  hypotheses: [
    {
      title: "Failing or loose charger connection",
      description: "No power reaching the board often traces to the adapter, cable, or jack.",
      confidence: "medium",
      rationale: "Matches the reported no-power symptoms; a charger swap distinguishes it fast.",
    },
    {
      title: "Stuck embedded-controller state",
      description: "Drained flea power can leave the controller refusing to boot.",
      confidence: "low",
      rationale: "Possible when the charger looks fine; a hard reset rules it in or out.",
    },
  ],
  tests: [
    {
      name: "Charger and outlet swap",
      objective: "Confirm wall power actually reaches the device.",
      tools: ["Known-good outlet"],
      skill: "beginner",
      instructions: [
        "Plug the charger into a different outlet you trust.",
        "Check every adapter LED and the charging indicator.",
        "Wiggle the plug gently and watch for flicker.",
      ],
      options: [
        { value: "charges", label: "Charges normally" },
        { value: "intermittent", label: "Intermittent / flickers" },
        { value: "dead", label: "Still completely dead" },
      ],
    },
    {
      name: "Hard reset (flea-power drain)",
      objective: "Clear a stuck controller state.",
      tools: [],
      skill: "beginner",
      instructions: [
        "Unplug the charger and all peripherals.",
        "Hold the power button for 20 seconds.",
        "Reconnect the charger and try powering on.",
      ],
      options: [
        { value: "boots", label: "Boots up" },
        { value: "lights", label: "Lights only, no boot" },
        { value: "nothing", label: "No change" },
      ],
    },
  ],
};

const BATTERY_PACK: SamplePack = {
  hypotheses: [
    {
      title: "Worn battery with reduced capacity",
      description: "Fast drain after years of cycles points at chemical wear.",
      confidence: "medium",
      rationale: "Typical wear pattern; a capacity reading confirms it.",
    },
    {
      title: "Background process draining power",
      description: "A stuck updater or sync loop can empty a healthy battery.",
      confidence: "low",
      rationale: "Plausible when drain started suddenly; usage stats distinguish it.",
    },
  ],
  tests: [
    {
      name: "Battery health reading",
      objective: "Measure actual capacity against design capacity.",
      tools: [],
      skill: "beginner",
      instructions: [
        "Open the OS battery health screen.",
        "Note full-charge capacity vs design capacity.",
        "Record the cycle count if shown.",
      ],
      options: [
        { value: "healthy", label: "Above 80% health" },
        { value: "worn", label: "Below 80% health" },
        { value: "unavailable", label: "No reading available" },
      ],
    },
    {
      name: "Overnight drain check",
      objective: "Separate idle drain from active-use drain.",
      tools: [],
      skill: "beginner",
      instructions: [
        "Charge to 100%, then unplug overnight with the lid closed.",
        "Do not wake the device until morning.",
        "Record the morning percentage.",
      ],
      options: [
        { value: "small", label: "Lost under 10%" },
        { value: "large", label: "Lost over 10%" },
      ],
    },
  ],
};

const DISPLAY_PACK: SamplePack = {
  hypotheses: [
    {
      title: "Loose or pinched display cable",
      description: "Flicker that changes with lid angle implicates the hinge cable.",
      confidence: "medium",
      rationale: "Angle-dependent symptoms are the classic cable signature.",
    },
    {
      title: "Failing backlight or panel",
      description: "A very dim but present image means the backlight circuit is suspect.",
      confidence: "low",
      rationale: "Needs the flashlight check to separate panel from backlight faults.",
    },
  ],
  tests: [
    {
      name: "External monitor check",
      objective: "Decide whether the GPU signal itself is healthy.",
      tools: ["External display", "Video cable"],
      skill: "beginner",
      instructions: [
        "Connect an external monitor.",
        "Mirror the display and compare both pictures.",
        "Move the lid while watching the internal panel.",
      ],
      options: [
        { value: "external_ok", label: "External fine, internal faulty" },
        { value: "both_bad", label: "Both show the fault" },
        { value: "both_ok", label: "Both look fine now" },
      ],
    },
    {
      name: "Flashlight test",
      objective: "Check for a faint image when the screen looks black.",
      tools: ["Flashlight"],
      skill: "beginner",
      instructions: [
        "Dim the room lights.",
        "Shine a flashlight at an angle on the dark screen.",
        "Look closely for a faint desktop image.",
      ],
      options: [
        { value: "faint", label: "Faint image visible" },
        { value: "nothing", label: "Truly black" },
      ],
    },
  ],
};

const HEAT_PACK: SamplePack = {
  hypotheses: [
    {
      title: "Dust-clogged cooling and dried paste",
      description: "Heat under load with loud fans is the classic cooling-degradation picture.",
      confidence: "medium",
      rationale: "Age plus load-dependent heat fits; vent inspection is the fast check.",
    },
    {
      title: "Runaway process saturating the CPU",
      description: "One stuck task can pin thermals even at idle.",
      confidence: "low",
      rationale: "Fits sudden onset; activity monitor readings distinguish it.",
    },
  ],
  tests: [
    {
      name: "Vent and fan inspection",
      objective: "Confirm airflow is not physically blocked.",
      tools: ["Compressed air (optional)"],
      skill: "beginner",
      instructions: [
        "Power off and inspect every vent for dust mats.",
        "Listen at boot: fans should spin up smoothly.",
        "Feel for exhaust airflow under light load.",
      ],
      options: [
        { value: "clear", label: "Vents clear, airflow good" },
        { value: "blocked", label: "Dust-blocked or weak airflow" },
        { value: "noisy", label: "Grinding or rattling fan" },
      ],
    },
    {
      name: "Idle temperature reading",
      objective: "Baseline thermals before load testing.",
      tools: [],
      skill: "intermediate",
      instructions: [
        "Close heavy apps and wait five minutes.",
        "Read CPU temperature from the system monitor.",
        "Note any process above 20% sustained CPU.",
      ],
      options: [
        { value: "cool", label: "Under 55°C at idle" },
        { value: "warm", label: "Over 55°C at idle" },
      ],
    },
  ],
};

const GENERAL_PACK: SamplePack = {
  hypotheses: [
    {
      title: "Software or configuration fault",
      description: "Many fresh symptoms trace to a recent update or setting change.",
      confidence: "medium",
      rationale: "Cheapest to rule out first with a safe-mode check.",
    },
    {
      title: "Hardware component fault",
      description: "Persistent symptoms across restarts point below the OS.",
      confidence: "low",
      rationale: "Considered once software causes are excluded.",
    },
  ],
  tests: [
    {
      name: "Safe-mode reproduction",
      objective: "Separate software causes from hardware causes.",
      tools: [],
      skill: "beginner",
      instructions: [
        "Boot into the OS safe mode.",
        "Try to reproduce the exact symptom.",
        "Reboot normally afterwards.",
      ],
      options: [
        { value: "gone", label: "Symptom gone in safe mode" },
        { value: "present", label: "Symptom still present" },
      ],
    },
    {
      name: "Peripheral strip-down",
      objective: "Rule out interference from attached devices.",
      tools: [],
      skill: "beginner",
      instructions: [
        "Unplug every peripheral including docks and hubs.",
        "Reproduce the symptom on the bare device.",
        "Reconnect items one at a time.",
      ],
      options: [
        { value: "gone", label: "Symptom gone when stripped" },
        { value: "present", label: "Symptom persists" },
      ],
    },
  ],
};

const PACKS: Record<string, SamplePack> = {
  power: POWER_PACK,
  battery: BATTERY_PACK,
  display: DISPLAY_PACK,
  screen: DISPLAY_PACK,
  overheating: HEAT_PACK,
  keyboard: GENERAL_PACK,
  performance: GENERAL_PACK,
  storage: GENERAL_PACK,
  network: GENERAL_PACK,
  audio: GENERAL_PACK,
  camera: GENERAL_PACK,
  speaker: GENERAL_PACK,
  software: GENERAL_PACK,
  physical: GENERAL_PACK,
};

const GUEST_KEY = "fieldfix.demo.guest-sessions";

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Build a fresh guest session from wizard input (no analysis yet). */
export function buildGuestSession(input: DemoWizardInput): DemoSession {
  const screen = screenDemoHazards(`${input.symptoms} ${input.category}`);
  const stamp = nowIso();
  const sessionInput = createSessionSchema.parse({
    device_type: input.device,
    manufacturer: input.manufacturer || undefined,
    model: input.model || undefined,
    operating_system: input.operatingSystem || undefined,
    symptoms: input.symptoms,
    user_mode: input.userMode,
  });
  const evidence = input.photos.slice(0, 8).map((photo, i) => ({
    ...createEvidenceFileSchema.parse({
      storage_key: `demo/guest/${input.device}-${Date.now()}-${i}`,
      media_type: photo.type || "image/jpeg",
      byte_size: Math.max(1, photo.size || 0),
      original_filename: photo.name,
      kind: photo.type.startsWith("video/") ? "video" : "image",
    }),
    id: uid(),
    processing_status: "ready" as const,
    processing_error: null,
    createdAt: stamp,
    annotations: [],
  }));
  const safetyEvents =
    screen.state === "critical_stop"
      ? [
          {
            ...createSafetyEventSchema.parse({
              previous_state: "normal",
              new_state: "critical_stop",
              trigger_type: "policy_rule",
              trigger_detail: screen.detail,
              blocked_action: "demo_loop",
              safe_next_steps: screen.safeSteps ?? "Stop and keep the device powered off.",
            }),
            id: uid(),
            createdAt: stamp,
          },
        ]
      : [];
  const session: DemoSession = {
    ...sessionInput,
    id: uid(),
    status: "open",
    safety_state: screen.state,
    createdAt: stamp,
    updatedAt: stamp,
    evidence,
    observations: [],
    hypotheses: [],
    tests: [],
    events: [
      {
        ...diagnosticEventSchema.parse({
          event_type: "session_created",
          payload: { device_type: input.device, guest: true, category: input.category },
        }),
        id: uid(),
        createdAt: stamp,
      },
    ],
    citations: [],
    safety_events: safetyEvents,
    model_runs: [],
    report: null,
  };
  assertDemoIntegrity([session]);
  return session;
}

/** Deterministic sample analysis: fills hypotheses, tests, and a demo model run. */
export function applySampleAnalysis(session: DemoSession): DemoSession {
  if (session.safety_state === "critical_stop" || session.safety_state === "review_required") {
    return session;
  }
  if (session.hypotheses.length > 0) {
    return session;
  }
  const stamp = nowIso();
  const pack = PACKS[guessCategory(session)] ?? GENERAL_PACK;
  const hypotheses = pack.hypotheses.map((h) => ({
    ...createHypothesisSchema.parse({
      title: h.title,
      description: h.description,
      supporting_observations: [{ kind: "note", id: null, note: "Sample pattern match (simulated)." }],
      contradicting_observations: [],
      confidence_label: h.confidence,
      confidence_rationale: `${h.rationale} (Sample analysis — illustrative only.)`,
      status: "proposed" as const,
    }),
    id: uid(),
    createdAt: stamp,
    updatedAt: stamp,
  }));
  const tests: DemoTest[] = pack.tests.map((t, i) => ({
    ...createDiagnosticTestSchema.parse({
      name: t.name,
      objective: t.objective,
      required_tools: t.tools,
      skill_level: t.skill,
      safety_classification: "safe" as const,
      instructions: t.instructions.map((text, s) => ({ step: s + 1, text })),
      result_options: t.options,
      position: i,
    }),
    id: uid(),
    status: "awaiting_result" as const,
    result: null,
  }));
  const updated: DemoSession = {
    ...session,
    status: "in_progress",
    updatedAt: stamp,
    hypotheses,
    tests,
    model_runs: [
      {
        id: uid(),
        provider: "demo-sampler",
        model_id: "sample-patterns-v1",
        task_type: "sample_analysis",
        status: "succeeded",
        latency_ms: null,
        origin: "demo",
        createdAt: stamp,
      },
    ],
    events: [
      ...session.events,
      {
        ...diagnosticEventSchema.parse({
          event_type: "sample_analysis_completed",
          payload: { hypotheses: hypotheses.length, tests: tests.length },
        }),
        id: uid(),
        createdAt: stamp,
      },
    ],
  };
  assertDemoIntegrity([updated]);
  return updated;
}

/** Record a guest test result locally; completes the session when all are in. */
export function recordGuestResult(
  session: DemoSession,
  testId: string,
  selectedOption: string,
  observation: string | null,
): DemoSession {
  if (session.safety_state === "critical_stop" || session.safety_state === "review_required") {
    return session;
  }
  const stamp = nowIso();
  const parsed = recordTestResultSchema.parse({
    selected_option: selectedOption,
    observation,
  });
  const tests = session.tests.map((t) =>
    t.id === testId
      ? {
          ...t,
          status: "completed" as const,
          result: { ...parsed, id: uid(), reportedAt: stamp },
        }
      : t,
  );
  const allDone = tests.length > 0 && tests.every((t) => t.result != null);
  const updated: DemoSession = {
    ...session,
    status: allDone ? "completed" : session.status === "open" ? "in_progress" : session.status,
    updatedAt: stamp,
    tests,
    events: [
      ...session.events,
      {
        ...diagnosticEventSchema.parse({
          event_type: "guest_result_recorded",
          payload: { test_id: testId, selected_option: selectedOption },
        }),
        id: uid(),
        createdAt: stamp,
      },
    ],
  };
  assertDemoIntegrity([updated]);
  return updated;
}

/** Best-effort category guess from stored guest payload for pack selection. */
function guessCategory(session: DemoSession): string {
  const created = session.events.find((e) => e.event_type === "session_created");
  const payload = (created?.payload ?? {}) as Record<string, unknown>;
  const category = payload["category"];
  return typeof category === "string" ? category : "";
}

function isGuestSession(value: unknown): value is DemoSession {
  if (typeof value !== "object" || value == null) {
    return false;
  }
  const s = value as Record<string, unknown>;
  return (
    typeof s["id"] === "string" &&
    typeof s["device_type"] === "string" &&
    typeof s["symptoms"] === "string" &&
    Array.isArray(s["tests"]) &&
    Array.isArray(s["hypotheses"]) &&
    Array.isArray(s["events"])
  );
}

export function loadGuestSessions(): DemoSession[] {
  try {
    const raw = sessionStorage.getItem(GUEST_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const guests = parsed.filter(isGuestSession);
    try {
      assertDemoIntegrity(guests);
    } catch {
      return [];
    }
    return guests;
  } catch {
    return [];
  }
}

export function saveGuestSession(session: DemoSession): DemoSession[] {
  const guests = loadGuestSessions().filter((g) => g.id !== session.id);
  guests.unshift(session);
  try {
    sessionStorage.setItem(GUEST_KEY, JSON.stringify(guests.slice(0, 10)));
  } catch {
    /* private mode: guest session lives for this page only */
  }
  return guests.slice(0, 10);
}
