import { z } from "zod";
import { safetyStateSchema } from "./diagnostics.js";
import { deviceCategorySchema } from "./models.js";

/**
 * Repair-shop workspace contracts (Phase 4, backend).
 *
 * Multi-tenant by shop: every shop-scoped row carries `shop_id` and
 * every route is guarded by shop membership (owner/admin/technician/
 * front_desk). Customer/job references (`C-`/`J-` + 8 hex) are
 * service-generated, never client-supplied.
 *
 * Reports are actuals-only: counts, turnaround, parts consumption
 * from inventory movements, and workload. There is deliberately NO
 * revenue-from-estimates field anywhere here — estimates are quotes,
 * not income.
 */

export const shopMemberRoleSchema = z.enum([
  "owner",
  "admin",
  "technician",
  "front_desk",
]);
export type ShopMemberRole = z.infer<typeof shopMemberRoleSchema>;

export const jobStatusSchema = z.enum([
  "received",
  "awaiting_diagnosis",
  "diagnosing",
  "awaiting_approval",
  "awaiting_parts",
  "in_repair",
  "testing",
  "completed",
  "ready_for_collection",
  "collected",
  "cancelled",
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const jobPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export type JobPriority = z.infer<typeof jobPrioritySchema>;

export const jobEventKindSchema = z.enum([
  "note",
  "status_change",
  "assignment",
  "estimate",
  "inventory",
]);
export type JobEventKind = z.infer<typeof jobEventKindSchema>;

export const estimateStatusSchema = z.enum([
  "draft",
  "sent",
  "approved",
  "rejected",
  "converted",
]);
export type EstimateStatus = z.infer<typeof estimateStatusSchema>;

export const estimateItemKindSchema = z.enum(["part", "labor", "other"]);
export type EstimateItemKind = z.infer<typeof estimateItemKindSchema>;

/* Shops and membership. */

export const shopSchema = z.object({
  id: z.string().uuid(),
  owner_user_id: z.string().uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  country: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Shop = z.infer<typeof shopSchema>;

export const createShopSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000).nullable().optional(),
  phone: z.string().trim().min(1).max(60).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  address: z.string().trim().min(1).max(500).nullable().optional(),
  city: z.string().trim().min(1).max(200).nullable().optional(),
  region: z.string().trim().min(1).max(200).nullable().optional(),
  country: z.string().trim().min(1).max(200).nullable().optional(),
});
export type CreateShop = z.infer<typeof createShopSchema>;

export const updateShopSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().min(1).max(2000).nullable().optional(),
    phone: z.string().trim().min(1).max(60).nullable().optional(),
    email: z.string().trim().email().max(320).nullable().optional(),
    address: z.string().trim().min(1).max(500).nullable().optional(),
    city: z.string().trim().min(1).max(200).nullable().optional(),
    region: z.string().trim().min(1).max(200).nullable().optional(),
    country: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be set.",
  });
export type UpdateShop = z.infer<typeof updateShopSchema>;

export const shopMemberSchema = z.object({
  shop_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: shopMemberRoleSchema,
});
export type ShopMember = z.infer<typeof shopMemberSchema>;

export const addShopMemberSchema = z
  .object({
    user_id: z.string().uuid().optional(),
    email: z.string().trim().email().max(320).optional(),
    role: shopMemberRoleSchema,
  })
  .refine((v) => (v.user_id == null) !== (v.email == null), {
    message: "Exactly one of user_id or email must be set.",
  });
export type AddShopMember = z.infer<typeof addShopMemberSchema>;

export const updateShopMemberSchema = z.object({
  role: shopMemberRoleSchema,
});
export type UpdateShopMember = z.infer<typeof updateShopMemberSchema>;

export const shopResponseSchema = z.object({
  shop: shopSchema,
  /** The caller's own role in this shop (membership-gated routes). */
  my_role: shopMemberRoleSchema,
});
export type ShopResponse = z.infer<typeof shopResponseSchema>;

export const listShopsResponseSchema = z.object({
  shops: z.array(shopSchema),
});
export type ListShopsResponse = z.infer<typeof listShopsResponseSchema>;

export const shopMemberResponseSchema = z.object({
  member: shopMemberSchema,
});
export type ShopMemberResponse = z.infer<typeof shopMemberResponseSchema>;

export const listShopMembersResponseSchema = z.object({
  members: z.array(shopMemberSchema),
});
export type ListShopMembersResponse = z.infer<
  typeof listShopMembersResponseSchema
>;

/* Customers and devices. */

export const shopCustomerSchema = z.object({
  id: z.string().uuid(),
  shop_id: z.string().uuid(),
  reference: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type ShopCustomer = z.infer<typeof shopCustomerSchema>;

export const createShopCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(60).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  address: z.string().trim().min(1).max(500).nullable().optional(),
  notes: z.string().trim().min(1).max(2000).nullable().optional(),
});
export type CreateShopCustomer = z.infer<typeof createShopCustomerSchema>;

export const updateShopCustomerSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    phone: z.string().trim().min(1).max(60).nullable().optional(),
    email: z.string().trim().email().max(320).nullable().optional(),
    address: z.string().trim().min(1).max(500).nullable().optional(),
    notes: z.string().trim().min(1).max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be set.",
  });
export type UpdateShopCustomer = z.infer<typeof updateShopCustomerSchema>;

export const shopCustomerResponseSchema = z.object({
  customer: shopCustomerSchema,
});
export type ShopCustomerResponse = z.infer<typeof shopCustomerResponseSchema>;

export const listShopCustomersResponseSchema = z.object({
  customers: z.array(shopCustomerSchema),
});
export type ListShopCustomersResponse = z.infer<
  typeof listShopCustomersResponseSchema
>;

export const customerDeviceSchema = z.object({
  id: z.string().uuid(),
  customer_id: z.string().uuid(),
  category: deviceCategorySchema,
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  serial_imei: z.string().nullable(),
  created_at: z.string().datetime(),
});
export type CustomerDevice = z.infer<typeof customerDeviceSchema>;

export const createCustomerDeviceSchema = z.object({
  category: deviceCategorySchema,
  manufacturer: z.string().trim().min(1).max(200).nullable().optional(),
  model: z.string().trim().min(1).max(200).nullable().optional(),
  serial_imei: z.string().trim().min(1).max(200).nullable().optional(),
});
export type CreateCustomerDevice = z.infer<typeof createCustomerDeviceSchema>;

export const customerDeviceResponseSchema = z.object({
  device: customerDeviceSchema,
});
export type CustomerDeviceResponse = z.infer<typeof customerDeviceResponseSchema>;

export const listCustomerDevicesResponseSchema = z.object({
  devices: z.array(customerDeviceSchema),
});
export type ListCustomerDevicesResponse = z.infer<
  typeof listCustomerDevicesResponseSchema
>;

/* Repair jobs and events. */

export const repairJobSchema = z.object({
  id: z.string().uuid(),
  shop_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  device_id: z.string().uuid().nullable(),
  session_id: z.string().uuid().nullable(),
  job_reference: z.string(),
  reported_fault: z.string(),
  device_condition: z.string().nullable(),
  accessories: z.string().nullable(),
  assignee_user_id: z.string().uuid().nullable(),
  priority: jobPrioritySchema,
  status: jobStatusSchema,
  received_at: z.string().datetime(),
  expected_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type RepairJob = z.infer<typeof repairJobSchema>;

export const createRepairJobSchema = z.object({
  customer_id: z.string().uuid(),
  device_id: z.string().uuid().nullable().optional(),
  reported_fault: z.string().trim().min(1).max(2000),
  device_condition: z.string().trim().min(1).max(2000).nullable().optional(),
  accessories: z.string().trim().min(1).max(2000).nullable().optional(),
  assignee_user_id: z.string().uuid().nullable().optional(),
  priority: jobPrioritySchema.default("normal"),
  expected_at: z.string().datetime().nullable().optional(),
});
export type CreateRepairJob = z.infer<typeof createRepairJobSchema>;

export const updateRepairJobSchema = z
  .object({
    status: jobStatusSchema.optional(),
    assignee_user_id: z.string().uuid().nullable().optional(),
    priority: jobPrioritySchema.optional(),
    reported_fault: z.string().trim().min(1).max(2000).optional(),
    device_condition: z.string().trim().min(1).max(2000).nullable().optional(),
    accessories: z.string().trim().min(1).max(2000).nullable().optional(),
    expected_at: z.string().datetime().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be set.",
  });
export type UpdateRepairJob = z.infer<typeof updateRepairJobSchema>;

export const listRepairJobsQuerySchema = z.object({
  status: jobStatusSchema.optional(),
  priority: jobPrioritySchema.optional(),
  assignee: z.string().uuid().optional(),
  customer: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListRepairJobsQuery = z.infer<typeof listRepairJobsQuerySchema>;

export const repairJobResponseSchema = z.object({
  job: repairJobSchema,
});
export type RepairJobResponse = z.infer<typeof repairJobResponseSchema>;

export const listRepairJobsResponseSchema = z.object({
  jobs: z.array(repairJobSchema),
});
export type ListRepairJobsResponse = z.infer<typeof listRepairJobsResponseSchema>;

/**
 * Job detail: the job plus the linked session's safety state
 * (read-only — for hazard display; null when no session is linked).
 */
export const repairJobDetailResponseSchema = z.object({
  job: repairJobSchema,
  session_safety_state: safetyStateSchema.nullable(),
});
export type RepairJobDetailResponse = z.infer<typeof repairJobDetailResponseSchema>;

export const repairJobEventSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  actor_user_id: z.string().uuid().nullable(),
  kind: jobEventKindSchema,
  body: z.string().nullable(),
  from_status: jobStatusSchema.nullable(),
  to_status: jobStatusSchema.nullable(),
  created_at: z.string().datetime(),
});
export type RepairJobEvent = z.infer<typeof repairJobEventSchema>;

export const createRepairJobEventSchema = z.object({
  kind: jobEventKindSchema,
  body: z.string().trim().min(1).max(4000).nullable().optional(),
  from_status: jobStatusSchema.nullable().optional(),
  to_status: jobStatusSchema.nullable().optional(),
});
export type CreateRepairJobEvent = z.infer<typeof createRepairJobEventSchema>;

export const repairJobEventResponseSchema = z.object({
  event: repairJobEventSchema,
});
export type RepairJobEventResponse = z.infer<typeof repairJobEventResponseSchema>;

export const listRepairJobEventsResponseSchema = z.object({
  events: z.array(repairJobEventSchema),
});
export type ListRepairJobEventsResponse = z.infer<
  typeof listRepairJobEventsResponseSchema
>;

export const attachJobSessionSchema = z.object({
  session_id: z.string().uuid(),
});
export type AttachJobSession = z.infer<typeof attachJobSessionSchema>;

/* Estimates. */

export const repairEstimateItemSchema = z.object({
  id: z.string().uuid(),
  estimate_id: z.string().uuid(),
  kind: estimateItemKindSchema,
  description: z.string(),
  part_number: z.string().nullable(),
  quantity: z.number().int(),
  unit_cents: z.number().int(),
  source_part_rec_id: z.string().uuid().nullable(),
});
export type RepairEstimateItem = z.infer<typeof repairEstimateItemSchema>;

export const estimateItemInputSchema = z.object({
  kind: estimateItemKindSchema,
  description: z.string().trim().min(1).max(500),
  part_number: z.string().trim().min(1).max(120).nullable().optional(),
  quantity: z.number().int().min(1).max(1000).default(1),
  unit_cents: z.number().int().min(0).max(100_000_000).default(0),
  source_part_rec_id: z.string().uuid().nullable().optional(),
});
export type EstimateItemInput = z.infer<typeof estimateItemInputSchema>;

export const repairEstimateSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  status: estimateStatusSchema,
  diagnosis_summary: z.string().nullable(),
  recommended_repair: z.string().nullable(),
  labor_cents: z.number().int(),
  other_cents: z.number().int(),
  currency: z.string(),
  validity_days: z.number().int().nullable(),
  terms: z.string().nullable(),
  created_by_user_id: z.string().uuid().nullable(),
  decided_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type RepairEstimate = z.infer<typeof repairEstimateSchema>;

export const createRepairEstimateSchema = z.object({
  diagnosis_summary: z.string().trim().min(1).max(4000).nullable().optional(),
  recommended_repair: z.string().trim().min(1).max(4000).nullable().optional(),
  labor_cents: z.number().int().min(0).max(100_000_000).default(0),
  other_cents: z.number().int().min(0).max(100_000_000).default(0),
  currency: z
    .string()
    .trim()
    .length(3)
    .default("USD"),
  validity_days: z.number().int().min(1).max(365).nullable().optional(),
  terms: z.string().trim().min(1).max(4000).nullable().optional(),
  items: z.array(estimateItemInputSchema).max(100).default([]),
});
export type CreateRepairEstimate = z.infer<typeof createRepairEstimateSchema>;

export const updateRepairEstimateSchema = z
  .object({
    status: estimateStatusSchema.optional(),
    diagnosis_summary: z.string().trim().min(1).max(4000).nullable().optional(),
    recommended_repair: z.string().trim().min(1).max(4000).nullable().optional(),
    labor_cents: z.number().int().min(0).max(100_000_000).optional(),
    other_cents: z.number().int().min(0).max(100_000_000).optional(),
    currency: z.string().trim().length(3).optional(),
    validity_days: z.number().int().min(1).max(365).nullable().optional(),
    terms: z.string().trim().min(1).max(4000).nullable().optional(),
    /** Full replacement of the line items — draft estimates only. */
    items: z.array(estimateItemInputSchema).max(100).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be set.",
  });
export type UpdateRepairEstimate = z.infer<typeof updateRepairEstimateSchema>;

export const repairEstimateResponseSchema = z.object({
  estimate: repairEstimateSchema,
  items: z.array(repairEstimateItemSchema),
});
export type RepairEstimateResponse = z.infer<typeof repairEstimateResponseSchema>;

export const listRepairEstimatesResponseSchema = z.object({
  estimates: z.array(repairEstimateResponseSchema),
});
export type ListRepairEstimatesResponse = z.infer<
  typeof listRepairEstimatesResponseSchema
>;

/* Inventory. */

export const inventoryItemSchema = z.object({
  id: z.string().uuid(),
  shop_id: z.string().uuid(),
  name: z.string(),
  part_number: z.string().nullable(),
  supplier: z.string().nullable(),
  cost_cents: z.number().int().nullable(),
  price_cents: z.number().int().nullable(),
  quantity: z.number().int(),
  low_threshold: z.number().int(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type InventoryItem = z.infer<typeof inventoryItemSchema>;

export const createInventoryItemSchema = z.object({
  name: z.string().trim().min(1).max(300),
  part_number: z.string().trim().min(1).max(120).nullable().optional(),
  supplier: z.string().trim().min(1).max(200).nullable().optional(),
  cost_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  price_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  quantity: z.number().int().min(0).max(1_000_000).default(0),
  low_threshold: z.number().int().min(0).max(1_000_000).default(0),
});
export type CreateInventoryItem = z.infer<typeof createInventoryItemSchema>;

export const updateInventoryItemSchema = z
  .object({
    name: z.string().trim().min(1).max(300).optional(),
    part_number: z.string().trim().min(1).max(120).nullable().optional(),
    supplier: z.string().trim().min(1).max(200).nullable().optional(),
    cost_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
    price_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
    low_threshold: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be set.",
  });
export type UpdateInventoryItem = z.infer<typeof updateInventoryItemSchema>;

export const listInventoryQuerySchema = z.object({
  low_stock: z.coerce.boolean().default(false),
  search: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>;

export const inventoryItemResponseSchema = z.object({
  item: inventoryItemSchema,
});
export type InventoryItemResponse = z.infer<typeof inventoryItemResponseSchema>;

export const listInventoryResponseSchema = z.object({
  items: z.array(inventoryItemSchema),
});
export type ListInventoryResponse = z.infer<typeof listInventoryResponseSchema>;

export const inventoryMovementSchema = z.object({
  id: z.string().uuid(),
  item_id: z.string().uuid(),
  job_id: z.string().uuid().nullable(),
  delta: z.number().int(),
  reason: z.string(),
  created_by_user_id: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
});
export type InventoryMovement = z.infer<typeof inventoryMovementSchema>;

export const createInventoryMovementSchema = z.object({
  delta: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((v) => v !== 0, { message: "delta must not be zero." }),
  job_id: z.string().uuid().nullable().optional(),
  reason: z.string().trim().min(1).max(500),
});
export type CreateInventoryMovement = z.infer<typeof createInventoryMovementSchema>;

export const inventoryMovementResponseSchema = z.object({
  movement: inventoryMovementSchema,
  /** Post-movement on-hand quantity (read from the same transaction). */
  quantity: z.number().int(),
});
export type InventoryMovementResponse = z.infer<
  typeof inventoryMovementResponseSchema
>;

export const listInventoryMovementsResponseSchema = z.object({
  movements: z.array(inventoryMovementSchema),
});
export type ListInventoryMovementsResponse = z.infer<
  typeof listInventoryMovementsResponseSchema
>;

/* Reports (actuals-only — no estimate-based revenue). */

export const shopReportSummarySchema = z.object({
  from: z.string().datetime().nullable(),
  to: z.string().datetime().nullable(),
  jobs_total: z.number().int(),
  jobs_by_status: z.record(jobStatusSchema, z.number().int()),
  /**
   * Hands-on-work aggregate: diagnosing + in_repair + testing.
   * Waiting states (awaiting_diagnosis/approval/parts) and terminal
   * states are counted in jobs_by_status only.
   */
  in_progress: z.number().int(),
  /** Mean received_at → completed_at over completed jobs, hours. */
  avg_turnaround_hours: z.number().nullable(),
  /** Absolute units consumed (negative movements) per item. */
  parts_consumption: z.array(
    z.object({
      item_id: z.string().uuid(),
      item_name: z.string(),
      quantity_used: z.number().int(),
    }),
  ),
  workload: z.array(
    z.object({
      user_id: z.string().uuid(),
      active_jobs: z.number().int(),
      completed_jobs: z.number().int(),
    }),
  ),
});
export type ShopReportSummary = z.infer<typeof shopReportSummarySchema>;

export const shopReportSummaryResponseSchema = z.object({
  summary: shopReportSummarySchema,
});
export type ShopReportSummaryResponse = z.infer<
  typeof shopReportSummaryResponseSchema
>;

export const shopReportQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ShopReportQuery = z.infer<typeof shopReportQuerySchema>;
