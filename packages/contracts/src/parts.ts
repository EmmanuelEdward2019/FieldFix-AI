import { z } from "zod";

/**
 * Parts and tools advisor contracts (Phase 2, deterministic v1).
 *
 * Advisory only: part names/numbers and tool names with optional
 * manual excerpts. There are deliberately NO price, stock,
 * availability, image, or supplier fields — supplier catalogues are
 * a later integration, and what the schema cannot express cannot be
 * fabricated.
 */

export const recommendationStatusSchema = z.enum([
  "proposed",
  "accepted",
  "dismissed",
]);
export type RecommendationStatus = z.infer<typeof recommendationStatusSchema>;

const uuidOrNull = z.string().uuid().nullable().optional();

export const createPartRecommendationSchema = z
  .object({
    hypothesis_id: uuidOrNull,
    test_id: uuidOrNull,
    part_name: z.string().trim().min(1).max(300),
    part_number: z.string().trim().min(1).max(120).nullable().optional(),
    manufacturer: z.string().trim().min(1).max(120).nullable().optional(),
    model_compat: z.string().trim().min(1).max(300).nullable().optional(),
    chunk_id: uuidOrNull,
    excerpt: z.string().min(1).max(4000).nullable().optional(),
  })
  .refine((v) => (v.hypothesis_id == null) !== (v.test_id == null), {
    message:
      "Exactly one of hypothesis_id or test_id must be set.",
  })
  .refine((v) => (v.chunk_id == null) === (v.excerpt == null), {
    message: "chunk_id and excerpt must be set together or not at all.",
  });
export type CreatePartRecommendation = z.infer<
  typeof createPartRecommendationSchema
>;

export const createToolRecommendationSchema = z.object({
  test_id: uuidOrNull,
  tool_name: z.string().trim().min(1).max(300),
  spec: z.string().trim().min(1).max(2000).nullable().optional(),
  chunk_id: uuidOrNull,
});
export type CreateToolRecommendation = z.infer<
  typeof createToolRecommendationSchema
>;

export const updateRecommendationStatusSchema = z.object({
  status: z.enum(["accepted", "dismissed"]),
});
export type UpdateRecommendationStatus = z.infer<
  typeof updateRecommendationStatusSchema
>;

export const partRecommendationSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  hypothesis_id: z.string().uuid().nullable(),
  test_id: z.string().uuid().nullable(),
  part_name: z.string(),
  part_number: z.string().nullable(),
  manufacturer: z.string().nullable(),
  model_compat: z.string().nullable(),
  chunk_id: z.string().uuid().nullable(),
  excerpt: z.string().nullable(),
  status: recommendationStatusSchema,
  created_at: z.string().datetime(),
});
export type PartRecommendation = z.infer<typeof partRecommendationSchema>;

export const partRecommendationResponseSchema = z.object({
  recommendation: partRecommendationSchema,
});
export type PartRecommendationResponse = z.infer<
  typeof partRecommendationResponseSchema
>;

export const listPartRecommendationsResponseSchema = z.object({
  recommendations: z.array(partRecommendationSchema),
});
export type ListPartRecommendationsResponse = z.infer<
  typeof listPartRecommendationsResponseSchema
>;

export const toolRecommendationSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  test_id: z.string().uuid().nullable(),
  tool_name: z.string(),
  spec: z.string().nullable(),
  chunk_id: z.string().uuid().nullable(),
  status: recommendationStatusSchema,
  created_at: z.string().datetime(),
});
export type ToolRecommendation = z.infer<typeof toolRecommendationSchema>;

export const toolRecommendationResponseSchema = z.object({
  recommendation: toolRecommendationSchema,
});
export type ToolRecommendationResponse = z.infer<
  typeof toolRecommendationResponseSchema
>;

export const listToolRecommendationsResponseSchema = z.object({
  recommendations: z.array(toolRecommendationSchema),
});
export type ListToolRecommendationsResponse = z.infer<
  typeof listToolRecommendationsResponseSchema
>;
