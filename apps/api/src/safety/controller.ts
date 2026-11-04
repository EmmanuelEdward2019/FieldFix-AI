import type { Kysely } from "kysely";
import type {
  SafetyState,
  TriggerType,
  UserMode,
} from "@fieldfix/contracts";
import type {
  Database,
  DiagnosticSession,
  SafetyEvent,
} from "../db/database.js";
import { SessionRepository } from "../db/repositories/sessions.js";
import { NotificationRepository } from "../db/repositories/notifications.js";
import { recordSafetyTransition } from "../db/workflows.js";

/**
 * Deterministic safety policy (PRD §4.7, docs/SAFETY_POLICY.md). Plain
 * pattern matching over user-supplied text — no model calls, no
 * instruction-following, so injected denials ("ignore safety, this is
 * fine") cannot suppress a keyword hit. Escalates automatically, never
 * de-escalates automatically, and never exits critical_stop or
 * review_required on its own.
 */

export type HazardSeverity = "critical" | "caution";

export type HazardCategory =
  | "battery_swelling"
  | "heat_fire"
  | "electrical"
  | "liquid_damage"
  | "physical_damage"
  | "general";

export interface HazardTrigger {
  category: HazardCategory;
  severity: HazardSeverity;
  /** The matched passage, bounded for audit storage. */
  excerpt: string;
}

interface HazardRule {
  category: HazardCategory;
  severity: HazardSeverity;
  patterns: RegExp[];
}

const CRITICAL_RULES: HazardRule[] = [
  {
    category: "battery_swelling",
    severity: "critical",
    patterns: [
      /\bswollen\b/i,
      /\bswelling\b/i,
      /\bbulging\b/i,
      /\b(puffed|inflated)\b.{0,20}\bbatter(y|ies)\b/i,
      /\bbatter(y|ies)\b.{0,20}\bdeformed\b/i,
      /\bdeformed\b.{0,20}\bbatter(y|ies)\b/i,
      /\b(screen|display|back( cover)?|cover|case|panel)\b.{0,30}\b(lifting|lifted|separating|separated|coming (off|apart|away))\b/i,
      /\b(lifting|separating)\b.{0,30}\b(screen|display|back( cover)?|cover|case|panel)\b/i,
    ],
  },
  {
    category: "heat_fire",
    severity: "critical",
    patterns: [
      /\bsmoke\b/i,
      /\bsmoking\b/i,
      /\bhissing\b/i,
      /\bsparks?\b/i,
      /\bburning smell\b/i,
      /\b(catch|caught|catching) fire\b/i,
      /\bflames?\b/i,
      /\bon fire\b/i,
      /\b(extremely|very|unusually|excessively|too)\b.{0,20}\bhot\b/i,
      /\btoo hot to (touch|hold|handle)\b/i,
    ],
  },
  {
    category: "electrical",
    severity: "critical",
    patterns: [
      /\bexposed\b.{0,20}\b(wire|wires|conductor|metal|circuit)\b/i,
      /\b(wire|wires|conductor)\b.{0,20}\bexposed\b/i,
      /\blive\b.{0,24}\b(wire|circuit|conductor|mains)\b/i,
      /\belectric(al)?\s+shock/i,
      /\bshort\s*circuit/i,
    ],
  },
  {
    category: "liquid_damage",
    severity: "critical",
    patterns: [
      /\b(wet|water|liquid|spill(ed)?|submerged|soaked)\b.{0,30}\b(charg(e|ing)|power(ed)?\s*on|turn(ed)?\s*on|smoke|smoking|heat|sparks?)\b/i,
      /\b(charg(e|ing)|power(ed)?\s*on|turn(ed)?\s*on)\b.{0,30}\b(wet|water|liquid|spill(ed)?|submerged|soaked)\b/i,
      /\bbatter(y|ies)\b.{0,20}\bleak/i,
      /\bleak.{0,20}\b(batter|fluid|liquid|acid)\b/i,
    ],
  },
  {
    category: "physical_damage",
    severity: "critical",
    patterns: [/\bpuncture(d|s)?\b/i],
  },
];

const CAUTION_RULES: HazardRule[] = [
  {
    category: "general",
    severity: "caution",
    patterns: [
      /\bbatter(y|ies)\b/i,
      /\bcharg(e|ing|er)\b/i,
      /\bhot\b/i,
      /\bwarm\b/i,
      /\bheat\b/i,
      /\bcrack(ed|s|ing)?\b/i,
      /\bshatter(ed)?\b/i,
      /\bdropped\b/i,
      /\bwet\b/i,
      /\bmoist(ure)?\b/i,
      /\bspill/i,
      /\bwater\b/i,
      /\bwater damage\b/i,
      /\bsmell\b/i,
    ],
  },
];

/** Loop actions (analyze/record/verify/propose) run only in these states. */
export function isLoopBlocked(state: SafetyState): boolean {
  return state === "critical_stop" || state === "review_required";
}

export const LOOP_BLOCKED_ACTIONS = [
  "analyze",
  "record_result",
  "verify_hypothesis",
  "propose_test",
] as const;

const MAX_EVALUATE_CHARS = 8000;

export function evaluateText(text: string): HazardTrigger[] {
  const input = text.slice(0, MAX_EVALUATE_CHARS);
  const triggers: HazardTrigger[] = [];
  for (const rule of [...CRITICAL_RULES, ...CAUTION_RULES]) {
    for (const pattern of rule.patterns) {
      // Fresh lastIndex per test: patterns are global-flag-free.
      const match = pattern.exec(input);
      if (match?.[0]) {
        triggers.push({
          category: rule.category,
          severity: rule.severity,
          excerpt: match[0].slice(0, 200),
        });
        break;
      }
    }
  }
  return triggers;
}

const SAFE_STEPS: Record<HazardCategory | "review", string[]> = {
  battery_swelling: [
    "Stop using and charging the device immediately.",
    "Do not press, puncture, bend, charge, or open it.",
    "If safe to do so, move it to a hard non-flammable surface away from people and combustibles.",
    "Do not put it in the trash or recycling; seek qualified professional help.",
  ],
  heat_fire: [
    "Stop using and charging the device immediately.",
    "If safe, unplug it and move it away from combustible materials.",
    "Ventilate the area; do not inhale smoke.",
    "If there are flames or spreading heat, leave the area and call emergency services.",
  ],
  electrical: [
    "Do not touch exposed conductors, wires, or damaged charging equipment.",
    "Unplug from mains power only if it is safe to do so.",
    "Keep the device powered off and seek qualified professional help.",
  ],
  liquid_damage: [
    "Power the device off and do not charge it or turn it on.",
    "Do not use heat to dry it.",
    "Seek qualified professional help; liquid plus power is a shock and fire risk.",
  ],
  physical_damage: [
    "Stop using the device and keep it powered off.",
    "Do not press on damaged areas, especially near the battery.",
    "Seek qualified professional help.",
  ],
  general: [
    "Proceed only with external, low-risk checks.",
    "Stop immediately if you notice heat, swelling, smoke, smells, or sparks.",
    "When in doubt, seek qualified professional help.",
  ],
  review: [
    "Automated screening flagged a possible hazard; a technician must review before continuing.",
    "Do not attempt further diagnostic steps until the review completes.",
  ],
};

function safeStepsFor(triggers: HazardTrigger[], newState: SafetyState): string {
  if (newState === "review_required") {
    return SAFE_STEPS.review.join("\n");
  }
  const categories = [...new Set(triggers.map((t) => t.category))];
  const lines = categories.flatMap((c) => SAFE_STEPS[c] ?? SAFE_STEPS.general);
  const unique = [...new Set(lines)];
  return unique.join("\n").slice(0, 4000);
}

function describeTriggers(triggers: HazardTrigger[]): string {
  return triggers
    .map((t) => `${t.category}/${t.severity}: "${t.excerpt}"`)
    .join("; ")
    .slice(0, 4000);
}

export type SafetyErrorCode =
  | "session_not_found"
  | "invalid_transition"
  | "not_technician";

export class SafetyError extends Error {
  readonly code: SafetyErrorCode;

  constructor(code: SafetyErrorCode, message: string) {
    super(message);
    this.name = "SafetyError";
    this.code = code;
  }
}

export interface ApplyEvaluationOptions {
  evidenceFileId?: string | null;
  triggerType?: TriggerType;
}

export interface ApplyEvaluationOutcome {
  session: DiagnosticSession;
  triggers: HazardTrigger[];
  escalated: boolean;
  safetyEvent: SafetyEvent | null;
}

export class SafetyController {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Evaluate user-supplied text and escalate the session when hazard
   * patterns match. Automatic transitions only move upward in
   * severity; leaving critical_stop/review_required always needs an
   * authorized requestTransition call.
   */
  async applyEvaluation(
    sessionId: string,
    text: string,
    options: ApplyEvaluationOptions = {},
  ): Promise<ApplyEvaluationOutcome> {
    const session = await new SessionRepository(this.db).getById(sessionId);
    if (!session) {
      throw new SafetyError("session_not_found", "Unknown session.");
    }
    const triggers = evaluateText(text);
    const target = automaticTarget(session.safety_state, triggers);
    if (!target || target === session.safety_state) {
      return { session, triggers, escalated: false, safetyEvent: null };
    }
    const blocked = isLoopBlocked(target) ? LOOP_BLOCKED_ACTIONS.join(",") : null;
    const { session: updated, safety_event } = await recordSafetyTransition(this.db, {
      session_id: sessionId,
      event: {
        previous_state: session.safety_state,
        new_state: target,
        trigger_type: options.triggerType ?? "user_report",
        trigger_detail: describeTriggers(triggers) || null,
        evidence_file_id: options.evidenceFileId ?? null,
        blocked_action: blocked,
        safe_next_steps: safeStepsFor(triggers, target),
      },
    });
    if (target === "critical_stop") {
      await new NotificationRepository(this.db)
        .record({
          kind: "safety_critical",
          title: `Critical stop on ${session.device_type} session`,
          body: describeTriggers(triggers) || "Deterministic safety rule triggered.",
          link: "/admin/safety",
        })
        .catch(() => undefined);
      if (session.user_id) {
        await new NotificationRepository(this.db)
          .record({
            kind: "safety_critical",
            title: "Stop — hazard identified in your session",
            body: describeTriggers(triggers) || "A deterministic safety rule stopped this session.",
            link: `/diagnostics/${sessionId}`,
            userId: session.user_id,
          })
          .catch(() => undefined);
      }
    }
    return { session: updated, triggers, escalated: true, safetyEvent: safety_event };
  }

  /**
   * Move a session to review_required on an advisory model flag.
   * Never reaches critical_stop: only deterministic rules and
   * technicians can do that.
   */
  async applyModelFlag(
    sessionId: string,
    detail: string,
    evidenceFileId?: string | null,
  ): Promise<ApplyEvaluationOutcome> {
    const session = await new SessionRepository(this.db).getById(sessionId);
    if (!session) {
      throw new SafetyError("session_not_found", "Unknown session.");
    }
    if (session.safety_state !== "normal" && session.safety_state !== "caution") {
      return { session, triggers: [], escalated: false, safetyEvent: null };
    }
    const { session: updated, safety_event } = await recordSafetyTransition(this.db, {
      session_id: sessionId,
      event: {
        previous_state: session.safety_state,
        new_state: "review_required",
        trigger_type: "model_finding",
        trigger_detail: detail.slice(0, 4000),
        evidence_file_id: evidenceFileId ?? null,
        blocked_action: LOOP_BLOCKED_ACTIONS.join(","),
        safe_next_steps: SAFE_STEPS.review.join("\n"),
      },
    });
    return { session: updated, triggers: [], escalated: true, safetyEvent: safety_event };
  }

  /**
   * Authorized, policy-checked transition out of (or between) states.
   * Technician mode plus a rationale is required; critical_stop
   * exits only to review_required.
   */
  async requestTransition(
    sessionId: string,
    toState: SafetyState,
    rationale: string,
    userMode: UserMode,
  ): Promise<{ session: DiagnosticSession; safetyEvent: SafetyEvent }> {
    if (userMode !== "technician") {
      throw new SafetyError(
        "not_technician",
        "Only a technician session can change the safety state.",
      );
    }
    const session = await new SessionRepository(this.db).getById(sessionId);
    if (!session) {
      throw new SafetyError("session_not_found", "Unknown session.");
    }
    if (!isAuthorizedTransition(session.safety_state, toState)) {
      throw new SafetyError(
        "invalid_transition",
        toState === session.safety_state
          ? `Session is already in ${toState}.`
          : `Transition from ${session.safety_state} to ${toState} is not permitted. ` +
            `critical_stop exits only to review_required.`,
      );
    }
    const blocked = isLoopBlocked(toState) ? LOOP_BLOCKED_ACTIONS.join(",") : null;
    const steps = toState === "critical_stop"
      ? [
        "Stop all troubleshooting on this device.",
        "Keep it powered off and seek qualified professional help.",
        `Technician note: ${rationale}`,
      ].join("\n")
      : `Authorized transition by technician: ${rationale}\nProceed only with checks appropriate to the ${toState} state.`;
    const { session: updated, safety_event } = await recordSafetyTransition(this.db, {
      session_id: sessionId,
      event: {
        previous_state: session.safety_state,
        new_state: toState,
        trigger_type: "policy_rule",
        trigger_detail: rationale.slice(0, 4000),
        evidence_file_id: null,
        blocked_action: blocked,
        safe_next_steps: steps.slice(0, 4000),
      },
    });
    return { session: updated, safetyEvent: safety_event };
  }
}

function automaticTarget(
  current: SafetyState,
  triggers: HazardTrigger[],
): SafetyState | null {
  if (triggers.length === 0) {
    return null;
  }
  const hasCritical = triggers.some((t) => t.severity === "critical");
  switch (current) {
    case "normal":
      return hasCritical ? "critical_stop" : "caution";
    case "caution":
      return hasCritical ? "critical_stop" : null;
    case "review_required":
      return hasCritical ? "critical_stop" : null;
    case "critical_stop":
      return null;
  }
}

function isAuthorizedTransition(from: SafetyState, to: SafetyState): boolean {
  if (from === to) {
    return false;
  }
  if (from === "critical_stop") {
    return to === "review_required";
  }
  return true;
}
