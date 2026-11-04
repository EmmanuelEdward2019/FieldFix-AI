import type { Kysely } from "kysely";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import {
  analyzeRequestSchema,
  createCitationSchema,
  recordTestResultSchema,
  verifyHypothesisSchema,
} from "@fieldfix/contracts";
import {
  requireSessionAccess,
  type SessionRequest,
} from "../auth/session-access.js";
import { requireUser, type UserRequest } from "../auth/user-access.js";
import type { Database } from "../db/database.js";
import { SessionRepository } from "../db/repositories/sessions.js";
import { EmailService } from "../email/resend.js";
import type { AppEnv } from "../env.js";
import { HypothesisRepository } from "../db/repositories/hypotheses.js";
import {
  DiagnosticTestRepository,
  TestResultRepository,
} from "../db/repositories/tests.js";
import {
  DiagnosticEngineService,
  EngineError,
  type EngineErrorCode,
} from "../diagnostics/engine.js";
import { sendError } from "../http/errors.js";
import {
  CitationError,
  CitationService,
  type CitationErrorCode,
} from "../knowledge/citations.js";
import { renderReportPdf } from "../reports/pdf.js";
import {
  toAnalyzeResponse,
  toHypothesisResponse,
  toRecordResultResponse,
  toReportResponse,
  toSessionCitationResponse,
  toTestWithResultResponse,
} from "./serializers.js";

export interface DiagnosticsRouterDeps {
  db: Kysely<Database>;
  /** Undefined when the server cannot build one (no database). */
  engine: DiagnosticEngineService | undefined;
  env: AppEnv;
}

const uuidParam = z.string().uuid();

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function engineStatus(code: EngineErrorCode): number {
  switch (code) {
    case "session_not_found":
    case "test_not_found":
    case "hypothesis_not_found":
      return 404;
    case "not_technician":
      return 403;
    case "invalid_option":
      return 400;
    case "result_exists":
      return 409;
    case "blocked_test":
    case "invalid_transition":
    case "safety_block":
      return 422;
    case "reasoning_failed":
      return 502;
  }
}

function reasoningStatus(category: string): number {
  switch (category) {
    case "rate_limited":
      return 429;
    case "timeout":
      return 504;
    default:
      return 502;
  }
}

function citationStatus(code: CitationErrorCode): number {
  switch (code) {
    case "session_not_found":
    case "chunk_not_found":
    case "link_not_found":
      return 404;
    case "invalid_input":
      return 400;
    case "document_not_citable":
    case "excerpt_not_found":
      return 422;
  }
}

export function createDiagnosticsRouter(deps: DiagnosticsRouterDeps) {
  const { db, env } = deps;
  const router = express.Router();
  const email = new EmailService({
    resendApiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    testMode: env.NODE_ENV === "test",
  });
  const sessions = new SessionRepository(db);
  const hypotheses = new HypothesisRepository(db);
  const tests = new DiagnosticTestRepository(db);
  const results = new TestResultRepository(db);
  const citations = new CitationService(db);

  function engineOr503(res: Response): DiagnosticEngineService | null {
    if (!deps.engine) {
      sendError(res, 503, "engine_unavailable", "The diagnostic engine is not configured.");
      return null;
    }
    return deps.engine;
  }

  function handleEngineError(res: Response, err: unknown): void {
    if (err instanceof EngineError) {
      sendError(res, engineStatus(err.code), err.code, err.message);
      return;
    }
    // Unexpected failures must fail the request, never escape as
    // unhandled rejections that crash the API process.
    sendError(res, 500, "internal_error", "Unexpected server error.");
  }

  router.post("/:id/analyze", requireSessionAccess(db), async (req: Request, res: Response) => {
    const engine = engineOr503(res);
    if (!engine) {
      return;
    }
    const parsed = analyzeRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", formatIssues(parsed.error));
      return;
    }
    const { session } = req as SessionRequest;
    try {
      const outcome = await engine.analyze(session.id, parsed.data);
      if (!outcome.ok) {
        sendError(
          res,
          reasoningStatus(outcome.error.category),
          outcome.error.category,
          outcome.error.message,
        );
        return;
      }
      res.json(
        toAnalyzeResponse({
          assessment: outcome.assessment,
          hypotheses: outcome.hypotheses,
          tests: outcome.tests,
          run: outcome.run,
          warnings: outcome.warnings,
        }),
      );
    } catch (err) {
      handleEngineError(res, err);
    }
  });

  router.get("/:id/hypotheses", requireSessionAccess(db), async (req: Request, res: Response) => {
    const { session } = req as SessionRequest;
    res.json({
      hypotheses: (await hypotheses.listBySession(session.id)).map(toHypothesisResponse),
    });
  });

  router.post(
    "/:id/hypotheses/:hypothesisId/verify",
    requireSessionAccess(db),
    async (req: Request, res: Response) => {
      const engine = engineOr503(res);
      if (!engine) {
        return;
      }
      const parsedId = uuidParam.safeParse(req.params.hypothesisId);
      if (!parsedId.success) {
        sendError(res, 404, "hypothesis_not_found", "No such hypothesis.");
        return;
      }
      const parsed = verifyHypothesisSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { session } = req as SessionRequest;
      try {
        const verified = await engine.verifyHypothesis(
          session.id,
          parsedId.data,
          parsed.data.rationale,
          session.user_mode,
        );
        res.json({ hypothesis: toHypothesisResponse(verified) });
      } catch (err) {
        handleEngineError(res, err);
      }
    },
  );

  router.get("/:id/tests", requireSessionAccess(db), async (req: Request, res: Response) => {
    const { session } = req as SessionRequest;
    const [allTests, allResults] = await Promise.all([
      tests.listBySession(session.id),
      results.listBySession(session.id),
    ]);
    const byTest = new Map(allResults.map((r) => [r.test_id, r]));
    res.json({
      tests: allTests.map((t) =>
        toTestWithResultResponse(t, byTest.get(t.id) ?? null),
      ),
    });
  });

  router.post(
    "/:id/tests/:testId/results",
    requireSessionAccess(db),
    async (req: Request, res: Response) => {
      const engine = engineOr503(res);
      if (!engine) {
        return;
      }
      const parsedId = uuidParam.safeParse(req.params.testId);
      if (!parsedId.success) {
        sendError(res, 404, "test_not_found", "No such test.");
        return;
      }
      const parsed = recordTestResultSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { session } = req as SessionRequest;
      try {
        const outcome = await engine.recordResult(session.id, parsedId.data, parsed.data);
        res.status(201).json(
          toRecordResultResponse({
            result: outcome.result,
            test: outcome.test,
            reassessmentApplied: outcome.reassessmentApplied,
            reassessmentError: outcome.reassessmentError,
            hypotheses: outcome.hypotheses,
          }),
        );
      } catch (err) {
        handleEngineError(res, err);
      }
    },
  );

  router.post("/:id/citations", requireSessionAccess(db), async (req: Request, res: Response) => {
    const parsed = createCitationSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", formatIssues(parsed.error));
      return;
    }
    const { session } = req as SessionRequest;
    try {
      const created = await citations.create(session.id, parsed.data);
      const resolved = await citations.resolve(created.id);
      if (!resolved) {
        sendError(res, 500, "internal_error", "Citation vanished after creation.");
        return;
      }
      res.status(201).json({ citation: toSessionCitationResponse(resolved) });
    } catch (err) {
      if (err instanceof CitationError) {
        sendError(res, citationStatus(err.code), err.code, err.message);
        return;
      }
      // Unexpected failures must fail the request, never escape as
      // unhandled rejections that crash the API process.
      sendError(res, 500, "internal_error", "Unexpected server error.");
    }
  });

  router.get("/:id/report", requireSessionAccess(db), async (req: Request, res: Response) => {
    const engine = engineOr503(res);
    if (!engine) {
      return;
    }
    const { session } = req as SessionRequest;
    try {
      const report = await engine.getReport(session.id);
      const payload = toReportResponse(report);
      if (req.query.format === "pdf") {
        try {
          const pdf = await renderReportPdf(payload);
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="fieldfix-report-${session.id}.pdf"`,
          );
          res.send(pdf);
        } catch {
          sendError(res, 500, "report_failed", "Report PDF could not be rendered.");
        }
        return;
      }
      res.json({ report: payload });
    } catch (err) {
      handleEngineError(res, err);
    }
  });

  router.post("/:id/report/email", requireUser(db), async (req: Request, res: Response) => {
    const engine = engineOr503(res);
    if (!engine) {
      return;
    }
    const { user } = req as UserRequest;
    const parsedId = uuidParam.safeParse(req.params.id);
    if (!parsedId.success) {
      sendError(res, 404, "session_not_found", "No such session.");
      return;
    }
    const session = await sessions.getById(parsedId.data);
    if (!session || session.user_id !== user.id) {
      sendError(res, 403, "forbidden", "Report email is available for your own diagnoses.");
      return;
    }
    try {
      const report = await engine.getReport(session.id);
      const payload = toReportResponse(report);
      const device = payload.report_data.device;
      const deviceLabel =
        [device.manufacturer, device.model].filter(Boolean).join(" ") || device.device_type;
      await email.sendReportCopy(user.email, {
        name: user.name,
        deviceLabel,
        symptoms: payload.report_data.symptoms,
        hypotheses: payload.report_data.hypotheses.map((h) => ({
          title: h.title,
          status: h.status,
          confidence: h.confidence_label,
        })),
        testsPerformed: payload.report_data.tests_performed.map((t) => ({
          name: t.name,
          result: t.result,
        })),
        nextSteps: payload.report_data.recommended_next_steps,
        reportUrl: `${env.APP_BASE_URL}/diagnostics/${session.id}`,
      });
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Resend send failed")) {
        sendError(res, 502, "email_failed", "The report email could not be sent.");
        return;
      }
      handleEngineError(res, err);
    }
  });

  return router;
}
