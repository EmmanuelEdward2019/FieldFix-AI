import type { Kysely } from "kysely";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import {
  createPartRecommendationSchema,
  createToolRecommendationSchema,
  updateRecommendationStatusSchema,
} from "@fieldfix/contracts";
import {
  requireSessionAccess,
  type SessionRequest,
} from "../auth/session-access.js";
import type { Database } from "../db/database.js";
import { sendError } from "../http/errors.js";
import {
  PartsAdvisorError,
  PartsAdvisorService,
  type PartsAdvisorErrorCode,
} from "../parts/service.js";
import { SuppliersRepository } from "../db/repositories/suppliers.js";
import {
  MAX_OFFERS,
  normalizeTerm,
  outboundSearchUrl,
  scoreProduct,
} from "../suppliers/match.js";
import {
  toPartRecommendationResponse,
  toSupplierProductResponse,
  toToolRecommendationResponse,
} from "./serializers.js";

export interface PartsRouterDeps {
  db: Kysely<Database>;
}

const uuidParam = z.string().uuid();

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function advisorStatus(code: PartsAdvisorErrorCode): number {
  switch (code) {
    case "session_not_found":
    case "link_not_found":
    case "chunk_not_found":
    case "recommendation_not_found":
      return 404;
    case "invalid_input":
      return 400;
    case "document_not_citable":
    case "excerpt_not_found":
      return 422;
  }
}

export function createPartsRouter(deps: PartsRouterDeps) {
  const { db } = deps;
  const router = express.Router();
  const advisor = new PartsAdvisorService(db);

  function handleAdvisorError(res: Response, err: unknown): void {
    if (err instanceof PartsAdvisorError) {
      sendError(res, advisorStatus(err.code), err.code, err.message);
      return;
    }
    // Unexpected failures (e.g. database errors) must fail the request,
    // never escape as unhandled rejections that crash the API process.
    sendError(res, 500, "internal_error", "Unexpected parts advisor failure.");
  }

  router.post(
    "/:id/parts/recommendations",
    requireSessionAccess(db),
    async (req: Request, res: Response) => {
      const parsed = createPartRecommendationSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { session } = req as SessionRequest;
      try {
        const created = await advisor.createPart(session.id, parsed.data);
        res.status(201).json({
          recommendation: toPartRecommendationResponse(created),
        });
      } catch (err) {
        handleAdvisorError(res, err);
      }
    },
  );

  router.get(
    "/:id/parts/recommendations",
    requireSessionAccess(db),
    async (req: Request, res: Response) => {
      const { session } = req as SessionRequest;
      try {
        res.json({
          recommendations: (await advisor.listParts(session.id)).map(
            toPartRecommendationResponse,
          ),
        });
      } catch (err) {
        handleAdvisorError(res, err);
      }
    },
  );

  router.patch(
    "/:id/parts/recommendations/:recId",
    requireSessionAccess(db),
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.recId);
      if (!parsedId.success) {
        sendError(res, 404, "recommendation_not_found", "No such part recommendation.");
        return;
      }
      const parsed = updateRecommendationStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { session } = req as SessionRequest;
      try {
        const updated = await advisor.setPartStatus(
          session.id,
          parsedId.data,
          parsed.data.status,
        );
        res.json({ recommendation: toPartRecommendationResponse(updated) });
      } catch (err) {
        handleAdvisorError(res, err);
      }
    },
  );

  router.get(
    "/:id/parts/recommendations/:recId/offers",
    requireSessionAccess(db),
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.recId);
      if (!parsedId.success) {
        sendError(res, 404, "recommendation_not_found", "No such part recommendation.");
        return;
      }
      const { session } = req as SessionRequest;
      try {
        const rec = (await advisor.listParts(session.id)).find(
          (item) => item.id === parsedId.data,
        );
        if (!rec) {
          sendError(res, 404, "recommendation_not_found", "No such part recommendation.");
          return;
        }
        const store = new SuppliersRepository(db);
        const terms = normalizeTerm(rec.part_name);
        const candidates = await store.findMatchCandidates(terms, rec.part_number);
        const offers = candidates
          .map((row) => ({ row, score: scoreProduct(rec.part_name, rec.part_number, row) }))
          .filter((entry): entry is { row: (typeof candidates)[number]; score: NonNullable<ReturnType<typeof scoreProduct>> } =>
            entry.score !== null,
          )
          .sort((a, b) => b.score.score - a.score.score)
          .slice(0, MAX_OFFERS)
          .map((entry) => ({
            product: toSupplierProductResponse(entry.row),
            supplier_name: entry.row.supplier_name,
            supplier_website_url: entry.row.supplier_website_url,
            match_kind: entry.score.kind,
            matched_terms: entry.score.matchedTerms,
            score: Math.round(entry.score.score * 100) / 100,
          }));
        const suppliers = await store.list();
        const query = rec.part_number?.trim() || rec.part_name;
        res.json({
          recommendation_id: rec.id,
          part_name: rec.part_name,
          offers,
          outbound_links: suppliers.map((supplier) => ({
            supplier_id: supplier.id,
            supplier_name: supplier.name,
            search_url: outboundSearchUrl(
              supplier.search_url_template,
              supplier.website_url,
              query,
            ),
            has_live_prices: supplier.feed_type === "woocommerce_store" ||
              supplier.feed_type === "manual",
          })),
        });
      } catch (err) {
        handleAdvisorError(res, err);
      }
    },
  );

  router.post(
    "/:id/tools/recommendations",
    requireSessionAccess(db),
    async (req: Request, res: Response) => {
      const parsed = createToolRecommendationSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { session } = req as SessionRequest;
      try {
        const created = await advisor.createTool(session.id, parsed.data);
        res.status(201).json({
          recommendation: toToolRecommendationResponse(created),
        });
      } catch (err) {
        handleAdvisorError(res, err);
      }
    },
  );

  router.get(
    "/:id/tools/recommendations",
    requireSessionAccess(db),
    async (req: Request, res: Response) => {
      const { session } = req as SessionRequest;
      try {
        res.json({
          recommendations: (await advisor.listTools(session.id)).map(
            toToolRecommendationResponse,
          ),
        });
      } catch (err) {
        handleAdvisorError(res, err);
      }
    },
  );

  router.patch(
    "/:id/tools/recommendations/:recId",
    requireSessionAccess(db),
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.recId);
      if (!parsedId.success) {
        sendError(res, 404, "recommendation_not_found", "No such tool recommendation.");
        return;
      }
      const parsed = updateRecommendationStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { session } = req as SessionRequest;
      try {
        const updated = await advisor.setToolStatus(
          session.id,
          parsedId.data,
          parsed.data.status,
        );
        res.json({ recommendation: toToolRecommendationResponse(updated) });
      } catch (err) {
        handleAdvisorError(res, err);
      }
    },
  );

  return router;
}
