import { z } from "zod";

/**
 * Knowledge-centre runtime schemas (PRD 4.5, 5.3). Enums mirror the DB
 * CHECK constraints in apps/api/src/db/migrations — change both together.
 */

export const documentTypeSchema = z.enum([
  "service_manual",
  "user_manual",
  "safety_notice",
  "repair_guide",
  "other",
]);
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const permissionStatusSchema = z.enum([
  "pending",
  "approved",
  "restricted",
  "rejected",
]);
export type PermissionStatus = z.infer<typeof permissionStatusSchema>;

export const ingestionStatusSchema = z.enum([
  "pending",
  "processing",
  "indexed",
  "failed",
]);
export type IngestionStatus = z.infer<typeof ingestionStatusSchema>;

export const createDocumentSchema = z.object({
  title: z.string().min(1).max(500),
  manufacturer: z.string().max(120).nullable().optional(),
  device_family: z.string().max(120).nullable().optional(),
  model_numbers: z.array(z.string().min(1).max(120)).default([]),
  document_type: documentTypeSchema,
  source_name: z.string().min(1).max(300),
  source_url: z.string().url().max(2000).nullable().optional(),
  version: z.string().max(120).nullable().optional(),
  language: z.string().min(1).max(20).default("en"),
  licence_name: z.string().max(300).nullable().optional(),
  permission_status: permissionStatusSchema.default("pending"),
  storage_key: z.string().max(1024).nullable().optional(),
  checksum_sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .nullable()
    .optional(),
});
export type CreateDocument = z.infer<typeof createDocumentSchema>;

export const updateDocumentIngestionSchema = z.object({
  ingestion_status: ingestionStatusSchema,
  ingestion_error: z.string().max(4000).nullable().optional(),
  permission_status: permissionStatusSchema.optional(),
});
export type UpdateDocumentIngestion = z.infer<
  typeof updateDocumentIngestionSchema
>;

export const createChunkSchema = z.object({
  chunk_index: z.number().int().min(0),
  page_number: z.number().int().positive().nullable().optional(),
  heading: z.string().max(500).nullable().optional(),
  content: z.string().min(1).max(20000),
  safety_tags: z.array(z.string().min(1).max(80)).default([]),
  component_tags: z.array(z.string().min(1).max(80)).default([]),
  model_applicability: z.array(z.string().min(1).max(120)).default([]),
});
export type CreateChunk = z.infer<typeof createChunkSchema>;

export const createCitationSchema = z
  .object({
    hypothesis_id: z.string().uuid().nullable().optional(),
    test_id: z.string().uuid().nullable().optional(),
    chunk_id: z.string().uuid(),
    excerpt: z.string().min(1).max(4000),
    note: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => v.hypothesis_id != null || v.test_id != null, {
    message: "A citation must link to a hypothesis or a test (or both).",
  });
export type CreateCitation = z.infer<typeof createCitationSchema>;

export const knowledgeSearchSchema = z.object({
  query: z.string().min(1).max(500),
  manufacturer: z.string().max(120).optional(),
  model: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});
export type KnowledgeSearch = z.infer<typeof knowledgeSearchSchema>;

export const knowledgeSearchHitSchema = z.object({
  chunk_id: z.string().uuid(),
  document_id: z.string().uuid(),
  document_title: z.string(),
  page_number: z.number().int().nullable(),
  heading: z.string().nullable(),
  excerpt: z.string(),
  rank: z.number(),
});
export type KnowledgeSearchHit = z.infer<typeof knowledgeSearchHitSchema>;

export const knowledgeSearchResponseSchema = z.object({
  hits: z.array(knowledgeSearchHitSchema),
});
export type KnowledgeSearchResponse = z.infer<
  typeof knowledgeSearchResponseSchema
>;

/* Ingestion jobs (PRD 5.2): one row per ingest attempt, for status and
 * failure reporting. */

export const ingestionJobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
]);
export type IngestionJobStatus = z.infer<typeof ingestionJobStatusSchema>;

/** Machine-readable job outcome: counts, warnings, duplicate target. */
export const ingestionJobDetailSchema = z.object({
  format: z.string().max(40).optional(),
  chunks_created: z.number().int().optional(),
  sections_parsed: z.number().int().optional(),
  pages_needing_ocr: z.array(z.number().int()).default([]),
  ocr_pages_filled: z.array(z.number().int()).default([]),
  warnings: z.array(z.string().max(1000)).default([]),
  duplicate_of: z.string().uuid().nullable().optional(),
});
export type IngestionJobDetail = z.infer<typeof ingestionJobDetailSchema>;

/** Source connectors the API can pull bytes from. Local admin file
 * uploads use multipart instead of this enum. */
export const connectorIdSchema = z.enum(["myfixit_dataset", "ifixit_api"]);
export type ConnectorId = z.infer<typeof connectorIdSchema>;

/** Metadata accepted alongside an admin file upload. Checksum and
 * storage key are server-assigned, never client-supplied. */
export const adminUploadMetadataSchema = createDocumentSchema
  .omit({ checksum_sha256: true, storage_key: true })
  .extend({
    source_name: z.string().min(1).max(300).default("Admin upload"),
  });
export type AdminUploadMetadata = z.infer<typeof adminUploadMetadataSchema>;

export const registerDocumentSchema = z.object({
  connector: connectorIdSchema,
  /** Connector-local reference: dataset file path or iFixit guide id. */
  ref: z.string().min(1).max(1024),
  /** Max records to import from a multi-record source (default 25). */
  limit: z.number().int().min(1).max(500).default(25),
  metadata: adminUploadMetadataSchema.partial().optional(),
});
export type RegisterDocument = z.infer<typeof registerDocumentSchema>;

export const createIngestionJobSchema = z.object({
  document_id: z.string().uuid(),
});
export type CreateIngestionJob = z.infer<typeof createIngestionJobSchema>;

export const ingestionJobResponseSchema = z.object({
  id: z.string().uuid(),
  document_id: z.string().uuid().nullable(),
  source_name: z.string(),
  status: ingestionJobStatusSchema,
  error: z.string().nullable(),
  chunks_created: z.number().int(),
  detail: ingestionJobDetailSchema.nullable(),
  created_at: z.string().datetime(),
  finished_at: z.string().datetime().nullable(),
});
export type IngestionJobResponse = z.infer<typeof ingestionJobResponseSchema>;

export const documentResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  manufacturer: z.string().nullable(),
  device_family: z.string().nullable(),
  model_numbers: z.array(z.string()),
  document_type: documentTypeSchema,
  source_name: z.string(),
  source_url: z.string().nullable(),
  version: z.string().nullable(),
  language: z.string(),
  licence_name: z.string().nullable(),
  permission_status: permissionStatusSchema,
  ingestion_status: ingestionStatusSchema,
  ingestion_error: z.string().nullable(),
  chunk_count: z.number().int(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type DocumentResponse = z.infer<typeof documentResponseSchema>;

export const adminDocumentResponseSchema = z.object({
  /** Null when ingestion failed before a document row existed. */
  document: documentResponseSchema.nullable(),
  job: ingestionJobResponseSchema,
  duplicate_of: z.string().uuid().nullable(),
});

export const adminDocumentListResponseSchema = z.object({
  documents: z.array(documentResponseSchema),
});
export type AdminDocumentListResponse = z.infer<typeof adminDocumentListResponseSchema>;
export type AdminDocumentResponse = z.infer<typeof adminDocumentResponseSchema>;

export const ingestionJobDetailResponseSchema = z.object({
  job: ingestionJobResponseSchema,
  document: documentResponseSchema.nullable(),
});
export type IngestionJobDetailResponse = z.infer<
  typeof ingestionJobDetailResponseSchema
>;

export const bulkImportItemSchema = z.object({
  title: z.string(),
  document_id: z.string().uuid().nullable(),
  job_id: z.string().uuid().nullable(),
  status: z.enum(["indexed", "duplicate", "failed", "skipped"]),
  chunks: z.number().int(),
  error: z.string().nullable(),
});
export type BulkImportItem = z.infer<typeof bulkImportItemSchema>;

export const bulkImportResponseSchema = z.object({
  file: z.string(),
  records_seen: z.number().int(),
  attempted: z.number().int(),
  items: z.array(bulkImportItemSchema),
});
export type BulkImportResponse = z.infer<typeof bulkImportResponseSchema>;
