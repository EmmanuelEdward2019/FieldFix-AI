import type { Kysely } from "kysely";
import type {
  AssessmentStatus,
  DiagnosticAssessment,
  DiagnosticStage,
  HypothesisStatus,
  ObservationRef,
  RecordTestResult,
  ReportData,
  TestResultOption,
} from "@fieldfix/contracts";
import type {
  Database,
  DiagnosticHypothesis,
  DiagnosticSession,
  DiagnosticTest,
  ModelRun,
  RepairReport,
  TestResult,
  Timestamp,
} from "../db/database.js";
import { SessionRepository } from "../db/repositories/sessions.js";
import { HypothesisRepository } from "../db/repositories/hypotheses.js";
import {
  EvidenceFileRepository,
  ObservationRepository,
} from "../db/repositories/evidence.js";
import {
  DiagnosticTestRepository,
  TestResultRepository,
} from "../db/repositories/tests.js";
import { EventRepository } from "../db/repositories/events.js";
import { NotificationRepository } from "../db/repositories/notifications.js";
import { ReportRepository } from "../db/repositories/reports.js";
import { SafetyEventRepository } from "../db/repositories/safety.js";
import { recordTestResult } from "../db/workflows.js";
import { CitationService } from "../knowledge/citations.js";
import { CitationRepository } from "../db/repositories/citations.js";
import { ChunkRepository, searchChunks } from "../db/repositories/documents.js";
import type { DiagnosticReasoningService } from "../models/diagnostic-reasoning.js";
import { isLoopBlocked, type SafetyController } from "../safety/controller.js";
import { screenTestSafety } from "./safety-screen.js";

/**
 * The diagnostic loop: analyze -> propose tests -> capture results ->
 * reassess -> report. All state transitions are durable and
 * append-only; user-reported results are never treated as
 * independently verified measurements (only an explicit technician
 * verification event sets "verified").
 */

export type EngineErrorCode =
  | "session_not_found"
  | "test_not_found"
  | "hypothesis_not_found"
  | "invalid_option"
  | "result_exists"
  | "blocked_test"
  | "invalid_transition"
  | "not_technician"
  | "safety_block"
  | "reasoning_failed";

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

export interface DiagnosticEngineDeps {
  db: Kysely<Database>;
  reasoning: DiagnosticReasoningService;
  safety: SafetyController;
}

export interface AnalyzeOptions {
  stage?: DiagnosticStage;
  question?: string;
  providerId?: string;
}

export type AnalyzeOutcome =
  | {
    ok: true;
    assessment: DiagnosticAssessment;
    hypotheses: DiagnosticHypothesis[];
    tests: DiagnosticTest[];
    run: ModelRun;
    warnings: string[];
  }
  | {
    ok: false;
    error: { category: string; message: string };
    run: ModelRun | null;
  };

export interface RecordResultOutcome {
  result: TestResult;
  test: DiagnosticTest;
  reassessmentApplied: boolean;
  reassessmentError: string | null;
  hypotheses: DiagnosticHypothesis[];
}

const DEFAULT_QUESTIONS: Record<DiagnosticStage, string> = {
  initial_assessment: "What is the most likely cause of the reported problem?",
  reassessment: "Given the new test result, how do the hypotheses change?",
  next_step: "What is the next safe diagnostic step?",
};

const CANNOT_PERFORM_PATTERN = /cannot\s*(perform|do)|can't|could\s*not\s*perform/i;

export class DiagnosticEngineService {
  constructor(private readonly deps: DiagnosticEngineDeps) {}

  /**
   * Run one reasoning pass and persist its outcome: new/updated
   * hypotheses with linked evidence, proposed tests with screened
   * safety classifications, and a workflow event. On model failure
   * nothing is persisted — absent evidence is never invented.
   */
  async analyze(sessionId: string, options: AnalyzeOptions = {}): Promise<AnalyzeOutcome> {
    const { db } = this.deps;
    const session = await new SessionRepository(db).getById(sessionId);
    if (!session) {
      throw new EngineError("session_not_found", "Unknown session.");
    }
    if (isLoopBlocked(session.safety_state)) {
      throw new EngineError(
        "safety_block",
        `Session is in ${session.safety_state}; resolve the safety state before further analysis.`,
      );
    }
    const existing = await new HypothesisRepository(db).listBySession(sessionId);
    const stage = options.stage ?? (existing.length > 0 ? "reassessment" : "initial_assessment");
    const question = options.question ?? DEFAULT_QUESTIONS[stage];

    const outcome = await this.deps.reasoning.assess(sessionId, {
      stage,
      question,
      providerId: options.providerId,
    });
    if (!outcome.ok) {
      return { ok: false, error: outcome.error, run: outcome.run };
    }
    const applied = await db.transaction().execute(async (trx) => {
      const hypotheses = new HypothesisRepository(trx);
      const observations = new ObservationRepository(trx);
      const tests = new DiagnosticTestRepository(trx);
      const events = new EventRepository(trx);
      const current = await hypotheses.listBySession(sessionId);

      const appliedHypotheses: DiagnosticHypothesis[] = [];
      const changes: Array<Record<string, unknown>> = [];
      for (const assessed of outcome.assessment.hypotheses) {
        const match = current.find((row) => sameTitle(row.title, assessed.title));
        const supporting = await this.attachEvidence(
          sessionId,
          observations,
          assessed.supporting_evidence,
        );
        const contradicting = await this.attachEvidence(
          sessionId,
          observations,
          assessed.contradicting_evidence,
        );
        if (match) {
          const nextStatus = nextHypothesisStatus(match.status, assessed.assessment_status);
          const updated = await hypotheses.update(match.id, {
            description: assessed.description ?? match.description,
            supporting_observations: [...match.supporting_observations, ...supporting].slice(-50),
            contradicting_observations: [...match.contradicting_observations, ...contradicting].slice(-50),
            confidence_label: assessed.confidence,
            confidence_rationale: assessed.confidence_rationale ?? match.confidence_rationale,
            ...(nextStatus !== match.status ? { status: nextStatus } : {}),
          });
          if (updated) {
            appliedHypotheses.push(updated);
            changes.push({ title: updated.title, from: match.status, to: updated.status });
          }
          for (const ref of [...supporting, ...contradicting]) {
            if (ref.kind === "observation" && ref.id) {
              await hypotheses.linkEvidence(match.id, { observation_id: ref.id });
            }
          }
        } else {
          const created = await hypotheses.create(sessionId, {
            title: assessed.title,
            description: assessed.description ?? null,
            supporting_observations: supporting,
            contradicting_observations: contradicting,
            confidence_label: assessed.confidence,
            confidence_rationale: assessed.confidence_rationale ?? null,
            status: assessed.assessment_status,
          });
          appliedHypotheses.push(created);
          changes.push({ title: created.title, from: null, to: created.status });
          for (const ref of [...supporting, ...contradicting]) {
            if (ref.kind === "observation" && ref.id) {
              await hypotheses.linkEvidence(created.id, { observation_id: ref.id });
            }
          }
        }
      }

      const appliedTests: DiagnosticTest[] = [];
      const priorTests = await tests.listBySession(sessionId);
      const priorResults = await new TestResultRepository(trx).listBySession(sessionId);
      const recordedIds = new Set(priorResults.map((r) => r.test_id));
      // Skip proposals that duplicate an open test (same name, same
      // screening): reassessment re-proposes freely, and without this
      // the checklist grows a same-named twin on every run. A
      // re-screened variant (blocked -> safe) is new information, so
      // the classification is part of the key.
      const openKeys = new Set(
        priorTests
          .filter((t) => !recordedIds.has(t.id) && t.status !== "skipped")
          .map((t) => testDedupeKey(t.name, t.safety_classification)),
      );
      let nextPosition = priorTests.reduce((max, t) => Math.max(max, t.position), -1) + 1;
      const hasAwaiting = priorTests.some((t) => t.status === "awaiting_result");
      const proposed = outcome.assessment.recommended_tests.map((rec, index) => {
        const screening = screenTestSafety({
          name: rec.name,
          objective: rec.objective,
          instructions: rec.instructions,
          safety_notes: rec.safety_notes ?? null,
        });
        return { rec, index, screening };
      });
      let awaitedThisRun = false;
      const skippedDuplicates: string[] = [];
      for (const { rec, screening } of proposed) {
        const key = testDedupeKey(rec.name, screening.classification);
        if (openKeys.has(key)) {
          skippedDuplicates.push(rec.name);
          continue;
        }
        openKeys.add(key);
        const created = await tests.create(sessionId, {
          name: rec.name,
          objective: rec.objective,
          rationale: rec.safety_notes ?? null,
          required_tools: rec.required_tools,
          skill_level: "intermediate",
          safety_classification: screening.classification,
          instructions: rec.instructions.map((text, step) => ({ step: step + 1, text })),
          expected_outcomes: null,
          result_options: withFallbackOptions(
            rec.result_options.map((label, i) => ({ value: `option_${i + 1}`, label })),
          ),
          position: nextPosition++,
        });
        // The first actionable proposal becomes the current test;
        // blocked proposals never do.
        if (!hasAwaiting && !awaitedThisRun && screening.classification !== "blocked") {
          const awaiting = await tests.updateStatus(created.id, "awaiting_result");
          appliedTests.push(awaiting ?? created);
          awaitedThisRun = true;
        } else {
          appliedTests.push(created);
        }
      }

      const appliedByName = new Map(appliedTests.map((t) => [testDedupeKey(t.name, t.safety_classification), t.id]));
      await events.append(sessionId, {
        event_type: "analysis_completed",
        payload: {
          run_id: outcome.run.id,
          stage,
          hypothesis_changes: changes,
          tests_proposed: proposed.map((p) => ({
            test_id: appliedByName.get(testDedupeKey(p.rec.name, p.screening.classification)) ?? null,
            name: p.rec.name,
            safety_classification: p.screening.classification,
            safety_matched: p.screening.matched,
          })),
          tests_skipped_duplicates: skippedDuplicates,
          suggested_next_action: outcome.assessment.suggested_next_action,
        },
      });
      if (session.user_id) {
        const deviceLabel = session.model ?? session.device_type;
        await new NotificationRepository(trx).record({
          kind: "analysis_completed",
          title: `Analysis complete for your ${deviceLabel}`,
          body: `${appliedHypotheses.length} possible causes and ${appliedTests.length} proposed tests are ready to review.`,
          link: `/diagnostics/${sessionId}`,
          userId: session.user_id,
        });
      }
      return { hypotheses: appliedHypotheses, tests: appliedTests, skippedDuplicates };
    });

    const hypotheses = await new HypothesisRepository(db).listBySession(sessionId);
    const warnings = [...outcome.warnings];
    if (applied.skippedDuplicates.length > 0) {
      warnings.push(
        `Skipped ${applied.skippedDuplicates.length} duplicate test proposal${applied.skippedDuplicates.length === 1 ? "" : "s"} already awaiting results.`,
      );
    }
    const consulted = await this.consultManuals(session, applied.hypotheses);
    warnings.push(...consulted.warnings);
    return {
      ok: true,
      assessment: outcome.assessment,
      hypotheses,
      tests: applied.tests,
      run: outcome.run,
      warnings,
    };
  }

  /**
   * Consult the knowledge base once hypotheses land: full-text search
   * over approved, indexed manuals and cite the top passages on the
   * leading hypothesis, so the workspace and report show which manuals
   * informed the diagnosis. Never fails analysis — an empty library
   * or a search error simply yields no citations.
   */
  private async consultManuals(
    session: DiagnosticSession,
    hypotheses: DiagnosticHypothesis[],
  ): Promise<{ cited: number; warnings: string[] }> {
    const warnings: string[] = [];
    const lead = hypotheses[0];
    if (!lead) {
      return { cited: 0, warnings };
    }
    const query = [session.device_type, session.manufacturer, session.model, session.symptoms]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join(" ")
      .slice(0, 500);
    if (query.trim().length === 0) {
      return { cited: 0, warnings };
    }
    try {
      const hits = await searchChunks(
        this.deps.db,
        { query, limit: 5 },
        { match: "any" },
      );
      if (hits.length === 0) {
        return { cited: 0, warnings };
      }
      const citations = new CitationService(this.deps.db);
      const chunks = new ChunkRepository(this.deps.db);
      const existing = await new CitationRepository(this.deps.db).listBySession(session.id);
      const citedChunks = new Set(existing.map((c) => c.chunk_id));
      // Rank order, distinct documents first: the panel should name
      // manuals, not three passages from one guide.
      const fresh = [...hits]
        .sort((a, b) => b.rank - a.rank)
        .filter((h) => !citedChunks.has(h.chunk_id));
      const ordered: typeof fresh = [];
      for (const documentId of [...new Set(fresh.map((h) => h.document_id))]) {
        const hit = fresh.find((h) => h.document_id === documentId);
        if (hit && ordered.length < 3) {
          ordered.push(hit);
        }
      }
      for (const hit of fresh) {
        if (ordered.length >= 3) {
          break;
        }
        if (!ordered.includes(hit)) {
          ordered.push(hit);
        }
      }
      const terms = query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2);
      let cited = 0;
      for (const hit of ordered) {
        if (cited >= 3 || citedChunks.has(hit.chunk_id)) {
          continue;
        }
        const chunk = await chunks.getById(hit.chunk_id);
        if (!chunk) {
          continue;
        }
        const excerpt = matchWindow(chunk.content, terms, 600);
        if (excerpt.trim().length === 0) {
          continue;
        }
        await citations.create(session.id, {
          hypothesis_id: lead.id,
          chunk_id: hit.chunk_id,
          excerpt,
          note: "Auto-consulted during AI analysis.",
        });
        citedChunks.add(hit.chunk_id);
        cited += 1;
      }
      return { cited, warnings };
    } catch (err) {
      warnings.push(
        `Manual consultation skipped: ${err instanceof Error ? err.message : "search failed."}`,
      );
      return { cited: 0, warnings };
    }
  }

  /**
   * Capture a user-reported result, then reassess. The result is
   * stored with user-reported provenance; when reassessment fails
   * the result stands and the caller can retry analysis later.
   */
  async recordResult(
    sessionId: string,
    testId: string,
    input: RecordTestResult,
  ): Promise<RecordResultOutcome> {
    const { db } = this.deps;
    const tests = new DiagnosticTestRepository(db);
    const results = new TestResultRepository(db);
    const session = await new SessionRepository(db).getById(sessionId);
    if (!session) {
      throw new EngineError("session_not_found", "Unknown session.");
    }
    if (isLoopBlocked(session.safety_state)) {
      throw new EngineError(
        "safety_block",
        `Session is in ${session.safety_state}; results cannot be recorded until it is resolved.`,
      );
    }
    const test = await tests.getById(testId);
    if (!test || test.session_id !== sessionId) {
      throw new EngineError("test_not_found", "Unknown test for this session.");
    }
    if (await results.getByTestId(testId)) {
      throw new EngineError("result_exists", "This test already has a recorded result.");
    }
    if (test.safety_classification === "blocked") {
      throw new EngineError(
        "blocked_test",
        "This test is blocked on safety grounds; results cannot be recorded for it.",
      );
    }
    const values = new Set(test.result_options.map((o) => o.value));
    if (!values.has(input.selected_option)) {
      throw new EngineError(
        "invalid_option",
        "Selected option is not one of the test's result options.",
      );
    }

    const { result, test: completed } = await recordTestResult(db, {
      session_id: sessionId,
      test_id: testId,
      result: input,
      event: {
        event_type: "test_result_recorded",
        payload: {
          test_id: testId,
          selected_option: input.selected_option,
          source: "user_reported",
        },
      },
    });
    // "Cannot perform" is not a completed measurement: park the test
    // as skipped so the checklist moves on honestly.
    const finalTest = CANNOT_PERFORM_PATTERN.test(input.selected_option) ||
        CANNOT_PERFORM_PATTERN.test(
          test.result_options.find((o) => o.value === input.selected_option)?.label ?? "",
        )
      ? (await tests.updateStatus(testId, "skipped")) ?? completed
      : completed;

    // A hazard discovered mid-test ("it started smoking") escalates
    // immediately, before any reassessment is attempted.
    if (input.observation && input.observation.trim().length > 0) {
      await this.deps.safety.applyEvaluation(sessionId, input.observation);
    }

    let reassessmentApplied = false;
    let reassessmentError: string | null = null;
    try {
      const reassessed = await this.analyze(sessionId, { stage: "reassessment" });
      if (reassessed.ok) {
        reassessmentApplied = true;
      } else {
        reassessmentError = reassessed.error.message;
      }
    } catch (err) {
      reassessmentError = err instanceof Error ? err.message : "Reassessment failed.";
    }
    const hypotheses = await new HypothesisRepository(db).listBySession(sessionId);
    return { result, test: finalTest, reassessmentApplied, reassessmentError, hypotheses };
  }

  /**
   * The ONLY path to "verified": an explicit technician confirmation
   * with a rationale, recorded as a verification event. Model output
   * and user-reported results can never take this path.
   */
  async verifyHypothesis(
    sessionId: string,
    hypothesisId: string,
    rationale: string,
    userMode: DiagnosticSession["user_mode"],
  ): Promise<DiagnosticHypothesis> {
    const { db } = this.deps;
    const session = await new SessionRepository(db).getById(sessionId);
    if (!session) {
      throw new EngineError("session_not_found", "Unknown session.");
    }
    if (isLoopBlocked(session.safety_state)) {
      throw new EngineError(
        "safety_block",
        `Session is in ${session.safety_state}; verification is blocked until it is resolved.`,
      );
    }
    if (userMode !== "technician") {
      throw new EngineError(
        "not_technician",
        "Only a technician session can verify a hypothesis.",
      );
    }
    const hypothesis = await new HypothesisRepository(db).getById(hypothesisId);
    if (!hypothesis || hypothesis.session_id !== sessionId) {
      throw new EngineError("hypothesis_not_found", "Unknown hypothesis for this session.");
    }
    if (hypothesis.status === "verified") {
      return hypothesis;
    }
    if (hypothesis.status === "ruled_out") {
      throw new EngineError(
        "invalid_transition",
        "A ruled-out hypothesis cannot be verified; re-propose it first.",
      );
    }
    const verified = await db.transaction().execute(async (trx) => {
      const updated = await new HypothesisRepository(trx).update(hypothesisId, {
        status: "verified",
      });
      if (!updated) {
        throw new EngineError("hypothesis_not_found", "Hypothesis disappeared mid-transaction.");
      }
      await new EventRepository(trx).append(sessionId, {
        event_type: "hypothesis_verified",
        payload: { hypothesis_id: hypothesisId, rationale, verified_by: "technician" },
      });
      return updated;
    });
    return verified;
  }

  /**
   * Compile the current durable state into a report snapshot (PRD
   * §4.8) and store it. Deterministic: no model calls, no invented
   * content — every line traces to a stored row.
   */
  async getReport(sessionId: string): Promise<RepairReport> {
    const { db } = this.deps;
    const sessions = new SessionRepository(db);
    const session = await sessions.getById(sessionId);
    if (!session) {
      throw new EngineError("session_not_found", "Unknown session.");
    }
    const [files, observations, hypotheses, tests, results, citations, safetyEvents, events] =
      await Promise.all([
        new EvidenceFileRepository(db).listBySession(sessionId),
        new ObservationRepository(db).listBySession(sessionId),
        new HypothesisRepository(db).listBySession(sessionId),
        new DiagnosticTestRepository(db).listBySession(sessionId),
        new TestResultRepository(db).listBySession(sessionId),
        new CitationService(db).listSessionResolved(sessionId),
        new SafetyEventRepository(db).listBySession(sessionId),
        new EventRepository(db).listBySession(sessionId),
      ]);
    const resultsByTest = new Map(results.map((r) => [r.test_id, r]));
    const lastAnalysis = [...events]
      .reverse()
      .find((e) => e.event_type === "analysis_completed");
    const suggested = lastAnalysis?.payload as
      | { suggested_next_action?: { action?: unknown } }
      | null
      | undefined;
    const suggestedAction = typeof suggested?.suggested_next_action === "object" &&
        suggested?.suggested_next_action !== null &&
        typeof (suggested.suggested_next_action as { action?: unknown }).action === "string"
      ? (suggested.suggested_next_action as { action: string }).action
      : null;

    const data: ReportData = {
      device: {
        device_type: session.device_type,
        manufacturer: session.manufacturer,
        model: session.model,
        operating_system: session.operating_system,
      },
      symptoms: session.symptoms,
      evidence_ids: files.map((f) => f.id),
      observable_facts: observations.map((o) => `${o.source}: ${o.body}`),
      hypotheses: hypotheses.map((h) => ({
        id: h.id,
        title: h.title,
        status: h.status,
        confidence_label: h.confidence_label,
        supporting_observations: h.supporting_observations,
        contradicting_observations: h.contradicting_observations,
      })),
      tests_performed: tests
        .filter((t) => resultsByTest.has(t.id))
        .map((t) => {
          const r = resultsByTest.get(t.id);
          return {
            test_id: t.id,
            name: t.name,
            result: r?.selected_option ?? null,
            observation: r?.observation ?? null,
            source: "user_reported" as const,
          };
        }),
      sources: citations.map((c) => ({
        citation_id: c.citation.id,
        document_title: c.document.title,
        page_number: c.chunk.page_number,
        excerpt: c.citation.excerpt,
      })),
      remaining_uncertainty: hypotheses
        .filter((h) => h.status !== "ruled_out" && h.status !== "verified")
        .map((h) => `${h.title} — ${h.status}, ${h.confidence_label} confidence`),
      recommended_next_steps: [
        ...tests
          .filter((t) => t.status === "awaiting_result" || t.status === "pending")
          .map((t) => `Perform test: ${t.name} — ${t.objective}`),
        ...(suggestedAction ? [`Suggested next action: ${suggestedAction}`] : []),
      ].slice(0, 10),
      safety_summary: safetyEvents.map((e) => ({
        id: e.id,
        new_state: e.new_state,
        trigger_type: e.trigger_type,
      })),
      assessment: composeAssessment(session, hypotheses, tests, resultsByTest),
      timeline: events.map((e) => ({
        event_type: e.event_type,
        created_at: toIso(e.created_at),
      })),
    };
    // Snapshots recompile on every view; only the first one announces.
    const hadReport = await new ReportRepository(db).getLatest(sessionId);
    const report = await new ReportRepository(db).create(sessionId, {
      status: "ready",
      report_data: data,
    });
    if (!hadReport) {
      await new EventRepository(db).append(sessionId, {
        event_type: "report_ready",
        payload: { report_id: report.id },
      });
      if (session.user_id) {
        const deviceLabel = session.model ?? session.device_type;
        await new NotificationRepository(db)
          .record({
            kind: "report_ready",
            title: `Repair report ready for your ${deviceLabel}`,
            body: "Your compiled findings, evidence, and references are ready to review.",
            link: `/diagnostics/${sessionId}`,
            userId: session.user_id,
          })
          .catch(() => undefined);
      }
    }
    return report;
  }

  /**
   * Persist model evidence statements as model observations and return
   * refs for the hypothesis JSONB columns. Provenance is embedded in
   * the observation body so the report never launders an inference
   * into an observation.
   */
  private async attachEvidence(
    sessionId: string,
    observations: ObservationRepository,
    statements: DiagnosticAssessment["hypotheses"][number][
      "supporting_evidence" | "contradicting_evidence"
    ],
  ): Promise<ObservationRef[]> {
    const refs: ObservationRef[] = [];
    for (const statement of statements) {
      const body = `[${statement.provenance}] ${statement.statement}`.slice(0, 8000);
      const created = await observations.create(sessionId, {
        source: "model",
        body,
      });
      refs.push({
        kind: "observation",
        id: created.id,
        note: statement.statement.slice(0, 2000),
      });
    }
    return refs;
  }
}

function toIso(value: Timestamp | Date): string {
  return (value as unknown as Date).toISOString();
}

/**
 * Deterministic report summary: counts and stored titles only. Never
 * introduces a fault claim — "verified" appears only when a stored
 * hypothesis row carries that status.
 */
function composeAssessment(
  session: DiagnosticSession,
  hypotheses: DiagnosticHypothesis[],
  tests: DiagnosticTest[],
  resultsByTest: Map<string, TestResult>,
): string {
  const verified = hypotheses.filter((h) => h.status === "verified");
  const ruledOut = hypotheses.filter((h) => h.status === "ruled_out");
  const open = hypotheses.filter((h) => h.status !== "verified" && h.status !== "ruled_out");
  const performed = tests.filter((t) => resultsByTest.has(t.id)).length;
  const parts = [
    `Session covers a ${session.device_type} (${hypotheses.length} hypotheses, ${performed} of ${tests.length} tests performed).`,
  ];
  if (verified.length > 0) {
    parts.push(`Technician-verified: ${verified.map((h) => h.title).join("; ")}.`);
  } else {
    parts.push("No fault has been independently verified.");
  }
  if (ruledOut.length > 0) {
    parts.push(`${ruledOut.length} hypothesis${ruledOut.length === 1 ? "" : "s"} ruled out.`);
  }
  if (open.length > 0) {
    parts.push(`Open: ${open.map((h) => h.title).join("; ")}.`);
  }
  if (session.safety_state !== "normal") {
    parts.push(`Safety state: ${session.safety_state} — restrictions apply.`);
  }
  return parts.join(" ").slice(0, 2000);
}

function sameTitle(a: string, b: string): boolean {
  return normalizeTitle(a) === normalizeTitle(b);
}

function testDedupeKey(name: string, classification: string): string {
  return `${normalizeTitle(name)}|${classification}`;
}

/**
 * Verbatim window around the first query-term hit, so auto-citations
 * quote the matched passage instead of the chunk's opening lines.
 * Falls back to the leading slice when only the heading matched.
 */
function matchWindow(content: string, terms: string[], maxLength: number): string {
  const lower = content.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index >= 0 && (at < 0 || index < at)) {
      at = index;
    }
  }
  if (at < 0) {
    return content.slice(0, maxLength);
  }
  const start = Math.max(0, at - 200);
  return content.slice(start, start + maxLength);
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Status transitions from a new assessment. An incoming "proposed"
 * never demotes an established status (reassessments routinely
 * re-list known hypotheses as proposed); everything else applies.
 * "verified" is unreachable here by construction — the assessment
 * contract has no such state.
 */
function nextHypothesisStatus(
  current: HypothesisStatus,
  incoming: AssessmentStatus,
): HypothesisStatus {
  if (incoming === "proposed" && current !== "proposed") {
    return current;
  }
  if (current === "verified" || current === "ruled_out") {
    return current;
  }
  return incoming;
}

/** PRD §4.4: every test offers "not sure" and "cannot perform". */
function withFallbackOptions(options: TestResultOption[]): TestResultOption[] {
  const has = (pattern: RegExp): boolean =>
    options.some((o) => pattern.test(o.value) || pattern.test(o.label));
  const out = [...options];
  if (!has(/not.?sure|unsure|don't know|dont know/i)) {
    out.push({ value: "not_sure", label: "Not sure" });
  }
  if (!has(CANNOT_PERFORM_PATTERN)) {
    out.push({ value: "cannot_perform", label: "Cannot perform this test" });
  }
  return out.slice(0, 50);
}
