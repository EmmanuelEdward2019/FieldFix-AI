import type { DiagnosticSession } from "../db/database.js";
import {
  type HazardTrigger,
  type SafetyController,
} from "./controller.js";
import type { SafetyScreeningService } from "./screening.js";

export interface ScreenUserTextOptions {
  deviceType?: string;
  evidenceFileId?: string | null;
}

export interface ScreenUserTextOutcome {
  session: DiagnosticSession;
  triggers: HazardTrigger[];
  escalated: boolean;
}

/**
 * Shared user-text screening: deterministic policy first, advisory
 * model screen only when the deterministic rules are silent. Used by
 * session intake, evidence notes, test observations, and now voice
 * transcripts — one sequence, no per-router duplication.
 */
export async function screenUserText(
  safety: SafetyController,
  screening: SafetyScreeningService | undefined,
  sessionId: string,
  text: string,
  options: ScreenUserTextOptions = {},
): Promise<ScreenUserTextOutcome> {
  const evaluated = await safety.applyEvaluation(sessionId, text, {
    evidenceFileId: options.evidenceFileId ?? null,
  });
  if (evaluated.escalated || !screening) {
    return {
      session: evaluated.session,
      triggers: evaluated.triggers,
      escalated: evaluated.escalated,
    };
  }
  const flagged = await screening.screenText(text, {
    deviceType: options.deviceType,
  });
  if (flagged?.hazard_suspected === true) {
    const detail = [
      `model categories: ${flagged.categories.join(", ") || "(none)"}`,
      flagged.rationale,
    ]
      .filter((part) => part.trim().length > 0)
      .join(" — ")
      .slice(0, 4000);
    const applied = await safety.applyModelFlag(
      sessionId,
      detail,
      options.evidenceFileId,
    );
    return {
      session: applied.session,
      triggers: applied.triggers,
      escalated: applied.escalated,
    };
  }
  return {
    session: evaluated.session,
    triggers: evaluated.triggers,
    escalated: false,
  };
}
