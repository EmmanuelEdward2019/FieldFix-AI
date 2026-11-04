import { z } from "zod";

/* Parts suppliers and live product feeds. */

export const supplierFeedTypeSchema = z.enum([
  "woocommerce_store",
  "manual",
  "link_only",
]);
export type SupplierFeedType = z.infer<typeof supplierFeedTypeSchema>;

export const supplierSyncStatusSchema = z.enum(["ok", "failed"]);
export type SupplierSyncStatus = z.infer<typeof supplierSyncStatusSchema>;

export const supplierStockStatusSchema = z.enum([
  "in_stock",
  "out_of_stock",
  "unknown",
]);
export type SupplierStockStatus = z.infer<typeof supplierStockStatusSchema>;

/** Search templates interpolate an encoded query at exactly one {q}. */
export const searchTemplateSchema = z
  .string()
  .url()
  .max(2000)
  .refine((value) => value.includes("{q}"), {
    message: "Search template must contain {q}.",
  });

export const supplierSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  website_url: z.string(),
  feed_type: supplierFeedTypeSchema,
  feed_base_url: z.string().nullable(),
  search_url_template: z.string().nullable(),
  sync_enabled: z.boolean(),
  last_sync_at: z.string().nullable(),
  last_sync_status: supplierSyncStatusSchema.nullable(),
  last_sync_error: z.string().nullable(),
  product_count: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Supplier = z.infer<typeof supplierSchema>;

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1).max(200),
  website_url: z.string().url().max(2000),
  feed_type: supplierFeedTypeSchema,
  feed_base_url: z.string().url().max(2000).nullish(),
  search_url_template: searchTemplateSchema.nullish(),
  sync_enabled: z.boolean().default(true),
});
export type CreateSupplier = z.infer<typeof createSupplierSchema>;

export const updateSupplierSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  website_url: z.string().url().max(2000).optional(),
  feed_base_url: z.string().url().max(2000).nullable().optional(),
  search_url_template: searchTemplateSchema.nullable().optional(),
  sync_enabled: z.boolean().optional(),
});
export type UpdateSupplier = z.infer<typeof updateSupplierSchema>;

export const supplierProductSchema = z.object({
  id: z.string().uuid(),
  supplier_id: z.string().uuid(),
  external_id: z.string(),
  name: z.string(),
  part_number: z.string().nullable(),
  price_cents: z.number().int().nonnegative().nullable(),
  currency: z.string().nullable(),
  stock_status: supplierStockStatusSchema,
  product_url: z.string(),
  image_url: z.string().nullable(),
  last_seen_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SupplierProduct = z.infer<typeof supplierProductSchema>;

export const createManualProductSchema = z.object({
  name: z.string().trim().min(1).max(500),
  part_number: z.string().trim().min(1).max(120).nullish(),
  price_cents: z.number().int().nonnegative().nullable().optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO code.")
    .nullable()
    .optional(),
  stock_status: supplierStockStatusSchema.default("unknown"),
  product_url: z.string().url().max(2000),
  image_url: z.string().url().max(2000).nullish(),
});
export type CreateManualProduct = z.infer<typeof createManualProductSchema>;

export const updateSupplierProductSchema = createManualProductSchema.partial();
export type UpdateSupplierProduct = z.infer<typeof updateSupplierProductSchema>;

export const supplierSyncResultSchema = z.object({
  supplier_id: z.string().uuid(),
  fetched: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type SupplierSyncResult = z.infer<typeof supplierSyncResultSchema>;

export const partOfferSchema = z.object({
  product: supplierProductSchema,
  supplier_name: z.string(),
  supplier_website_url: z.string(),
  match_kind: z.enum(["part_number", "keywords"]),
  matched_terms: z.array(z.string()),
  score: z.number(),
});
export type PartOffer = z.infer<typeof partOfferSchema>;

export const supplierOutboundLinkSchema = z.object({
  supplier_id: z.string().uuid(),
  supplier_name: z.string(),
  search_url: z.string(),
  has_live_prices: z.boolean(),
});
export type SupplierOutboundLink = z.infer<typeof supplierOutboundLinkSchema>;

export const partOffersResponseSchema = z.object({
  recommendation_id: z.string().uuid(),
  part_name: z.string(),
  offers: z.array(partOfferSchema),
  outbound_links: z.array(supplierOutboundLinkSchema),
});
export type PartOffersResponse = z.infer<typeof partOffersResponseSchema>;

export const listSuppliersResponseSchema = z.object({
  suppliers: z.array(supplierSchema),
});
export type ListSuppliersResponse = z.infer<typeof listSuppliersResponseSchema>;

export const supplierResponseSchema = z.object({
  supplier: supplierSchema,
});
export type SupplierResponse = z.infer<typeof supplierResponseSchema>;

export const listSupplierProductsResponseSchema = z.object({
  products: z.array(supplierProductSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type ListSupplierProductsResponse = z.infer<
  typeof listSupplierProductsResponseSchema
>;

export const supplierProductResponseSchema = z.object({
  product: supplierProductSchema,
});
export type SupplierProductResponse = z.infer<typeof supplierProductResponseSchema>;

export const supplierSyncResponseSchema = z.object({
  sync: supplierSyncResultSchema,
});
export type SupplierSyncResponse = z.infer<typeof supplierSyncResponseSchema>;
