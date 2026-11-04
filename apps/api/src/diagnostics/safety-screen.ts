import type { SafetyClassification } from "@fieldfix/contracts";

/**
 * Interim deterministic screen for model-proposed tests. The model may
 * suggest anything; this gate decides the stored safety_classification
 * so a hazardous proposal is never served as "safe". Keyword-based and
 * deliberately narrow — the full deterministic safety controller (PRD
 * §4.7) replaces it, at which point this module is deleted.
 */

const BLOCKED_PATTERNS: RegExp[] = [
  /\bopen\b.{0,24}\b(chassis|case|housing|back cover|device|laptop|phone)\b/i,
  /\bpuncture\b/i,
  /\bpry\b.{0,24}\bbattery\b/i,
  /\blive\b.{0,24}\b(wire|circuit|conductor|mains)\b/i,
  /\bbypass\b.{0,24}\b(safety|fuse|protection|thermal)\b/i,
  /\bshort\b.{0,24}\bcircuit\b/i,
  /\bcharge\b.{0,24}\b(swollen|bulging|deformed|damaged)\b.{0,24}\bbattery\b/i,
  /\buse\b.{0,24}\b(swollen|bulging)\b.{0,24}\bbattery\b/i,
  /\bprobe\b.{0,24}\bmains\b/i,
];

const CAUTION_PATTERNS: RegExp[] = [
  /\bbatter(y|ies)\b/i,
  /\bheat\b/i,
  /\bhot\b/i,
  /\bsharp\b/i,
  /\belectric/i,
  /\bsolder/i,
  /\bheat gun\b/i,
  /\badhesive\b/i,
  /\bbroken glass\b/i,
  /\bcracked screen\b/i,
  /\bcharged\b.{0,24}\bcapacitor\b/i,
];

export interface SafetyScreening {
  classification: SafetyClassification;
  /** Human-readable matched rules, for the workflow event log. */
  matched: string[];
}

export function screenTestSafety(input: {
  name: string;
  objective: string;
  instructions: string[];
  safety_notes?: string | null;
}): SafetyScreening {
  const haystack = [input.name, input.objective, ...input.instructions, input.safety_notes ?? ""]
    .join("\n");
  const blocked = BLOCKED_PATTERNS.filter((pattern) => pattern.test(haystack));
  if (blocked.length > 0) {
    return {
      classification: "blocked",
      matched: blocked.map((pattern) => `blocked:${pattern.source}`),
    };
  }
  const caution = CAUTION_PATTERNS.filter((pattern) => pattern.test(haystack));
  if (caution.length > 0) {
    return {
      classification: "caution",
      matched: caution.map((pattern) => `caution:${pattern.source}`),
    };
  }
  return { classification: "safe", matched: [] };
}
