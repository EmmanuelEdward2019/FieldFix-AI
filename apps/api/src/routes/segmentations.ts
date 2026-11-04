import type { Kysely } from "kysely";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { segmentRequestSchema } from "@fieldfix/contracts";
import {
  requireSessionAccess,
  type SessionRequest,
} from "../auth/session-access.js";
import type { Database } from "../db/database.js";
import { sendError } from "../http/errors.js";
import {
  SegmentationError,
  SegmentationService,
  type SegmentationErrorCode,
} from "../vision/service.js";
import {
  IdentificationError,
  IdentificationService,
  type IdentificationErrorCode,
} from "../vision/identification.js";
import {
  toAnnotationResponse,
  toIdentificationResponse,
  toIdentifyResponse,
  toListSegmentationsResponse,
  toSegmentResponse,
} from "./serializers.js";

export interface SegmentationsRouterDeps {
  db: Kysely<Database>;
  service: SegmentationService | undefined;
  identification?: IdentificationService | undefined;
}

const uuidParam = z.string().uuid();

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function segmentationStatus(code: SegmentationErrorCode): number {
  switch (code) {
    case "session_not_found":
    case "file_not_found":
      return 404;
    case "not_an_image":
    case "unreadable_image":
    case "invalid_concepts":
      return 422;
    case "provider_failed":
      return 502;
  }
}

function identificationStatus(code: IdentificationErrorCode): number {
  switch (code) {
    case "session_not_found":
    case "file_not_found":
      return 404;
    case "not_supported":
      return 422;
    case "provider_failed":
      return 502;
  }
}

export function createSegmentationsRouter(deps: SegmentationsRouterDeps) {
  const router = express.Router();

  function serviceOr503(res: Response): SegmentationService | null {
    if (!deps.service) {
      sendError(res, 503, "segmentation_unavailable", "Segmentation is not configured.");
      return null;
    }
    return deps.service;
  }

  function identificationOr503(res: Response): IdentificationService | null {
    if (!deps.identification) {
      sendError(
        res,
        503,
        "identification_unavailable",
        "Component identification is not configured.",
      );
      return null;
    }
    return deps.identification;
  }

  router.post(
    "/:id/evidence/:fileId/segmentations",
    requireSessionAccess(deps.db),
    async (req: Request, res: Response) => {
      const service = serviceOr503(res);
      if (!service) {
        return;
      }
      const parsedFile = uuidParam.safeParse(req.params.fileId);
      if (!parsedFile.success) {
        sendError(res, 404, "file_not_found", "No such evidence file.");
        return;
      }
      const parsed = segmentRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { session } = req as SessionRequest;
      try {
        const outcome = await service.segment(session.id, parsedFile.data, parsed.data.concepts);
        res.status(201).json(
          toSegmentResponse({
            annotations: outcome.annotations,
            runs: outcome.runs.map((run, index) => ({
              run,
              concept: outcome.conceptsUsed[index] ?? "",
            })),
            conceptsUsed: outcome.conceptsUsed,
            warnings: outcome.warnings,
          }),
        );
      } catch (err) {
        if (err instanceof SegmentationError) {
          sendError(res, segmentationStatus(err.code), err.code, err.message);
          return;
        }
        // Unexpected failures must fail the request, never escape as
        // unhandled rejections that crash the API process.
        sendError(res, 500, "internal_error", "Unexpected server error.");
      }
    },
  );

  router.get(
    "/:id/evidence/:fileId/segmentations",
    requireSessionAccess(deps.db),
    async (req: Request, res: Response) => {
      const service = serviceOr503(res);
      if (!service) {
        return;
      }
      const parsedFile = uuidParam.safeParse(req.params.fileId);
      if (!parsedFile.success) {
        sendError(res, 404, "file_not_found", "No such evidence file.");
        return;
      }
      const { session } = req as SessionRequest;
      // Listing verifies session ownership without segmenting.
      const owned = await service.listOwned(session.id, parsedFile.data);
      if (!owned) {
        sendError(res, 404, "file_not_found", "No such evidence file.");
        return;
      }
      const annotations = await service.list(parsedFile.data);
      res.json(
        toListSegmentationsResponse({
          annotations: annotations.map(toAnnotationResponse),
          imageWidth: annotations[0]?.image_width ?? null,
          imageHeight: annotations[0]?.image_height ?? null,
        }),
      );
    },
  );

  router.post(
    "/:id/evidence/:fileId/identification",
    requireSessionAccess(deps.db),
    async (req: Request, res: Response) => {
      const identification = identificationOr503(res);
      if (!identification) {
        return;
      }
      const parsedFile = uuidParam.safeParse(req.params.fileId);
      if (!parsedFile.success) {
        sendError(res, 404, "file_not_found", "No such evidence file.");
        return;
      }
      const { session } = req as SessionRequest;
      try {
        const outcome = await identification.identify(session.id, parsedFile.data);
        res.status(201).json(
          toIdentifyResponse({
            identification: outcome.identification,
            annotations: outcome.annotations,
            conceptsUsed: outcome.conceptsUsed,
            warnings: outcome.warnings,
          }),
        );
      } catch (err) {
        if (err instanceof IdentificationError) {
          sendError(res, identificationStatus(err.code), err.code, err.message);
          return;
        }
        sendError(res, 500, "internal_error", "Unexpected server error.");
      }
    },
  );

  router.get(
    "/:id/evidence/:fileId/identification",
    requireSessionAccess(deps.db),
    async (req: Request, res: Response) => {
      const identification = identificationOr503(res);
      if (!identification) {
        return;
      }
      const parsedFile = uuidParam.safeParse(req.params.fileId);
      if (!parsedFile.success) {
        sendError(res, 404, "file_not_found", "No such evidence file.");
        return;
      }
      const { session } = req as SessionRequest;
      try {
        const latest = await identification.getLatest(session.id, parsedFile.data);
        if (!latest) {
          sendError(res, 404, "identification_not_found", "This file has not been identified yet.");
          return;
        }
        res.json({ identification: toIdentificationResponse(latest) });
      } catch (err) {
        if (err instanceof IdentificationError) {
          sendError(res, identificationStatus(err.code), err.code, err.message);
          return;
        }
        sendError(res, 500, "internal_error", "Unexpected server error.");
      }
    },
  );

  return router;
}
