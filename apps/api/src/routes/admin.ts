import type { Kysely } from "kysely";
import express, { type Request, type Response } from "express";
import multer, { MulterError } from "multer";
import { z } from "zod";
import {
  adminUploadMetadataSchema,
  createIngestionJobSchema,
  registerDocumentSchema,
} from "@fieldfix/contracts";
import { requireCapability } from "../auth/admin-access.js";
import type { Database } from "../db/database.js";
import { ChunkRepository, DocumentRepository } from "../db/repositories/documents.js";
import { IngestionJobRepository } from "../db/repositories/ingestion-jobs.js";
import { NotificationRepository } from "../db/repositories/notifications.js";
import { sendError } from "../http/errors.js";
import type { StorageAdapter } from "../storage/types.js";
import { importIfixitGuide, IfixitClient } from "../ingestion/connectors/ifixit.js";
import { importMyFixitFile } from "../ingestion/connectors/myfixit.js";
import { IngestionService, type IngestOutcome } from "../ingestion/pipeline.js";
import { isKnownSourceId, type SourceId } from "../ingestion/sources.js";
import { IngestionError, type IngestionErrorCode } from "../ingestion/types.js";
import type { OcrService } from "../ingestion/ocr.js";
import {
  toAdminDocumentListResponse,
  toAdminDocumentResponse,
  toBulkImportResponse,
  toIngestionJobDetailResponse,
} from "./serializers.js";

export interface AdminRouterDeps {
  db: Kysely<Database>;
  storage: StorageAdapter;
  maxUploadBytes: number;
  ifixitBaseUrl?: string;
  fetchFn?: typeof fetch;
  ocr?: OcrService;
  env?: NodeJS.ProcessEnv;
}

const uploadSourceSchema = z.enum(["admin_upload", "manufacturer_docs"]);

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function failureStatus(code: IngestionErrorCode): number {
  switch (code) {
    case "unsupported_format":
      return 415;
    case "source_not_permitted":
    case "source_disabled":
    case "permission_rejected":
      return 403;
    case "fetch_failed":
      return 502;
    case "ref_not_found":
      return 404;
    case "file_too_large":
      return 413;
    case "storage_failed":
    case "internal":
      return 500;
    default:
      return 422;
  }
}

export function createAdminRouter(deps: AdminRouterDeps) {
  const { db, storage, maxUploadBytes } = deps;
  const router = express.Router();
  // Document capabilities come from the caller's user role.
  const canView = requireCapability(db, "documents:view");
  const canManage = requireCapability(db, "documents:manage");

  const documents = new DocumentRepository(db);
  const chunks = new ChunkRepository(db);
  const jobs = new IngestionJobRepository(db);
  const notifications = new NotificationRepository(db);
  const pipeline = new IngestionService({
    db,
    storage,
    ocr: deps.ocr,
    env: deps.env,
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadBytes, files: 1, fields: 8 },
  });

  async function chunkCount(documentId: string): Promise<number> {
    const rows = await chunks.listByDocument(documentId);
    return rows.length;
  }

  async function respondWithOutcome(
    res: Response,
    outcome: IngestOutcome,
  ): Promise<void> {
    const job = await jobs.getById(outcome.jobId);
    if (!job) {
      sendError(res, 500, "internal_error", "Ingestion job vanished.");
      return;
    }
    if (outcome.status === "indexed") {
      res.status(201).json(
        toAdminDocumentResponse({
          document: {
            row: outcome.document,
            chunkCount: outcome.chunks.length,
          },
          job,
          duplicateOf: null,
        }),
      );
      return;
    }
    if (outcome.status === "duplicate") {
      res.status(200).json(
        toAdminDocumentResponse({
          document: {
            row: outcome.document,
            chunkCount: await chunkCount(outcome.document.id),
          },
          job,
          duplicateOf: outcome.duplicateOf,
        }),
      );
      return;
    }
    await notifications
      .record({
        kind: "ingestion_failed",
        title: `Ingestion failed: ${job.source_name}`,
        body: `${outcome.code}: ${outcome.error}`,
        link: "/admin/ingestion",
      })
      .catch(() => undefined);
    res.status(failureStatus(outcome.code)).json(
      toAdminDocumentResponse({
        document: outcome.document
          ? {
            row: outcome.document,
            chunkCount: await chunkCount(outcome.document.id),
          }
          : null,
        job,
        duplicateOf: null,
      }),
    );
  }

  function handleConnectorError(res: Response, err: unknown): void {
    if (err instanceof IngestionError) {
      sendError(res, failureStatus(err.code), err.code, err.message);
      return;
    }
    // Unexpected failures must fail the request, never escape as
    // unhandled rejections that crash the API process.
    sendError(res, 500, "internal_error", "Unexpected server error.");
  }

  router.post("/documents", canManage, (req: Request, res: Response) => {
    if (req.is("multipart/*")) {
      upload.single("file")(req, res, (err: unknown) => {
        void handleFileUpload(req, res, err).catch(() => {
          if (!res.headersSent) {
            sendError(res, 500, "internal_error", "Unexpected server error.");
          }
        });
      });
      return;
    }
    void handleConnectorRegistration(req, res).catch((err: unknown) => {
      if (!res.headersSent) {
        if (err instanceof IngestionError) {
          handleConnectorError(res, err);
        } else {
          sendError(res, 500, "internal_error", "Unexpected server error.");
        }
      }
    });
  });

  async function handleFileUpload(req: Request, res: Response, err: unknown): Promise<void> {
    if (err instanceof MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        sendError(res, 413, "file_too_large", `File exceeds the ${maxUploadBytes} byte limit.`);
        return;
      }
      sendError(res, 400, "invalid_request", `Upload rejected: ${err.message}.`);
      return;
    }
    if (err) {
      throw err;
    }
    const buffer = req.file?.buffer;
    if (!buffer || buffer.length === 0) {
      sendError(res, 400, "file_missing", "Attach a file in the 'file' field.");
      return;
    }
    let metadataRaw: unknown = {};
    if (typeof req.body?.metadata === "string" && req.body.metadata.trim().length > 0) {
      try {
        metadataRaw = JSON.parse(req.body.metadata) as unknown;
      } catch {
        sendError(res, 400, "invalid_request", "Field 'metadata' is not valid JSON.");
        return;
      }
    }
    const parsedMeta = adminUploadMetadataSchema.safeParse(metadataRaw);
    if (!parsedMeta.success) {
      sendError(res, 400, "invalid_request", formatIssues(parsedMeta.error));
      return;
    }
    const sourceRaw = typeof req.body?.source === "string" ? req.body.source : "admin_upload";
    const parsedSource = uploadSourceSchema.safeParse(sourceRaw);
    if (!parsedSource.success) {
      sendError(res, 400, "invalid_request", "Field 'source' must be 'admin_upload' or 'manufacturer_docs'.");
      return;
    }
    const sourceId: SourceId = parsedSource.data;
    if (!isKnownSourceId(sourceId)) {
      sendError(res, 403, "source_not_permitted", "Unknown ingestion source.");
      return;
    }
    const outcome = await pipeline.ingestFile({
      bytes: buffer,
      mediaType: req.file?.mimetype ?? "application/octet-stream",
      filename: req.file?.originalname,
      metadata: parsedMeta.data,
      sourceId,
    });
    await respondWithOutcome(res, outcome);
  }

  async function handleConnectorRegistration(req: Request, res: Response): Promise<void> {
    const parsed = registerDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", formatIssues(parsed.error));
      return;
    }
    const { connector, ref, limit, metadata } = parsed.data;
    try {
      if (connector === "myfixit_dataset") {
        const result = await importMyFixitFile(pipeline, {
          filePath: ref,
          limit,
          metadata: metadata ?? {},
          env: deps.env,
        });
        res.status(201).json(
          toBulkImportResponse({
            file: result.filePath,
            recordsSeen: result.recordsSeen,
            attempted: result.imported.length + result.duplicates.length +
              result.failed.filter((f) => f.jobId !== null).length,
            items: [
              ...result.imported.map((item) => ({
                title: item.title,
                document_id: item.documentId,
                job_id: item.jobId,
                status: "indexed" as const,
                chunks: item.chunks,
                error: null,
              })),
              ...result.duplicates.map((item) => ({
                title: item.title,
                document_id: item.documentId,
                job_id: item.jobId,
                status: "duplicate" as const,
                chunks: 0,
                error: null,
              })),
              ...result.failed.map((item) => ({
                title: item.title,
                document_id: null,
                job_id: item.jobId,
                status: "failed" as const,
                chunks: 0,
                error: item.error,
              })),
            ],
          }),
        );
        return;
      }
      const guideId = Number.parseInt(ref, 10);
      if (!Number.isInteger(guideId) || guideId <= 0) {
        sendError(res, 400, "invalid_request", "Field 'ref' must be a positive iFixit guide id.");
        return;
      }
      const outcome = await importIfixitGuide(pipeline, {
        guideId,
        metadata: metadata ?? {},
        client: new IfixitClient({ baseUrl: deps.ifixitBaseUrl, fetchFn: deps.fetchFn }),
        env: deps.env,
      });
      await respondWithOutcome(res, outcome);
    } catch (err) {
      handleConnectorError(res, err);
    }
  }

  router.get("/documents", canView, async (req: Request, res: Response) => {
    const raw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const limit = Math.min(Math.max(Number.parseInt(String(raw ?? "50"), 10) || 50, 1), 200);
    const rows = await documents.listRecent(limit);
    const items = [];
    for (const row of rows) {
      items.push({ row, chunkCount: await chunkCount(row.id) });
    }
    res.json(toAdminDocumentListResponse(items));
  });

  router.post("/ingestion-jobs", canManage, async (req: Request, res: Response) => {
    const parsed = createIngestionJobSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", formatIssues(parsed.error));
      return;
    }
    const document = await documents.getById(parsed.data.document_id);
    if (!document) {
      sendError(res, 404, "not_found", "Unknown document.");
      return;
    }
    try {
      const outcome = await pipeline.reingestDocument(document.id);
      await respondWithOutcome(res, outcome);
    } catch (err) {
      handleConnectorError(res, err);
    }
  });

  router.get("/ingestion-jobs/:id", canView, async (req: Request, res: Response) => {
    const id = req.params.id ?? "";
    if (!z.string().uuid().safeParse(id).success) {
      sendError(res, 404, "not_found", "Unknown ingestion job.");
      return;
    }
    const job = await jobs.getById(id);
    if (!job) {
      sendError(res, 404, "not_found", "Unknown ingestion job.");
      return;
    }
    const document = job.document_id ? await documents.getById(job.document_id) : undefined;
    res.json(
      toIngestionJobDetailResponse({
        job,
        document: document
          ? { row: document, chunkCount: await chunkCount(document.id) }
          : null,
      }),
    );
  });

  return router;
}
