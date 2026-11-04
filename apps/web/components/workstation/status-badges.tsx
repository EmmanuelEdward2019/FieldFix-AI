import type {
  DiagnosticTestStatus,
  HypothesisStatus,
  ProcessingStatus,
  SafetyClassification,
  SafetyState,
  SessionStatus,
  SkillLevel,
  UserMode,
} from "@fieldfix/contracts";
import type { badgeVariants } from "@/components/ui/badge";
import type { VariantProps } from "class-variance-authority";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

/** "critical_stop" -> "Critical stop". */
export function humanize(value: string): string {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function sessionStatusVariant(status: SessionStatus): BadgeVariant {
  switch (status) {
    case "in_progress":
      return "default";
    case "awaiting_test":
      return "warning";
    case "completed":
      return "success";
    case "archived":
      return "muted";
    default:
      return "secondary";
  }
}

export function safetyStateVariant(state: SafetyState): BadgeVariant {
  switch (state) {
    case "normal":
      return "success";
    case "caution":
    case "review_required":
      return "warning";
    case "critical_stop":
      return "danger";
  }
}

export function hypothesisStatusVariant(
  status: HypothesisStatus,
): BadgeVariant {
  switch (status) {
    case "supported":
    case "verified":
      return "success";
    case "weakened":
      return "warning";
    case "ruled_out":
      return "muted";
    default:
      return "secondary";
  }
}

export function confidenceVariant(
  level: "low" | "medium" | "high",
): BadgeVariant {
  switch (level) {
    case "high":
      return "success";
    case "medium":
      return "warning";
    default:
      return "muted";
  }
}

/** Meter fill for a confidence label (display aid, not a probability). */
export function confidenceValue(level: "low" | "medium" | "high"): number {
  switch (level) {
    case "high":
      return 85;
    case "medium":
      return 55;
    default:
      return 25;
  }
}

export function testStatusVariant(status: DiagnosticTestStatus): BadgeVariant {
  switch (status) {
    case "completed":
      return "success";
    case "awaiting_result":
      return "warning";
    case "blocked":
      return "danger";
    case "skipped":
      return "muted";
    default:
      return "secondary";
  }
}

export function processingVariant(status: ProcessingStatus): BadgeVariant {
  switch (status) {
    case "ready":
      return "success";
    case "processing":
    case "pending":
      return "warning";
    case "failed":
      return "danger";
  }
}

export function safetyClassificationVariant(
  value: SafetyClassification,
): BadgeVariant {
  switch (value) {
    case "safe":
      return "success";
    case "caution":
      return "warning";
    case "blocked":
      return "danger";
  }
}

export function userModeVariant(mode: UserMode): BadgeVariant {
  return mode === "technician" ? "default" : "secondary";
}

export function skillLabel(skill: SkillLevel): string {
  return humanize(skill);
}
