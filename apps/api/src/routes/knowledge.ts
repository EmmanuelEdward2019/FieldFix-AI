import type { Kysely } from "kysely";
import express, { type Request, type Response } from "express";
import { knowledgeSearchSchema } from "@fieldfix/contracts";
import type { Database } from "../db/database.js";
import { searchChunks } from "../db/repositories/documents.js";
import { sendError } from "../http/errors.js";
import { toKnowledgeSearchResponse } from "./serializers.js";

export interface KnowledgeRouterDeps {
  db: Kysely<Database>;
}

/**
 * Public retrieval over approved, indexed documents only. Returns
 * real excerpts with document/page references for the reference
 * panel and the diagnostic engine.
 */
export function createKnowledgeRouter(deps: KnowledgeRouterDeps) {
  const router = express.Router();

  router.post("/search", async (req: Request, res: Response) => {
    const parsed = knowledgeSearchSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      sendError(
        res,
        400,
        "invalid_request",
        `${first?.path.join(".") || "(root)"}: ${first?.message || "invalid"}.`,
      );
      return;
    }
    const hits = await searchChunks(deps.db, parsed.data);
    res.json(toKnowledgeSearchResponse(hits));
  });

  return router;
}
