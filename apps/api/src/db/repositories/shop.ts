import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import type {
  CreateCustomerDevice,
  CreateInventoryItem,
  CreateRepairEstimate,
  CreateRepairJob,
  CreateShop,
  CreateShopCustomer,
  EstimateItemInput,
  EstimateStatus,
  JobPriority,
  JobStatus,
  ShopMemberRole,
} from "@fieldfix/contracts";
import type {
  CustomerDevice,
  Db,
  InventoryItem,
  InventoryMovement,
  RepairEstimate,
  RepairEstimateItem,
  RepairJob,
  RepairJobEvent,
  Shop,
  ShopCustomer,
  ShopMember,
} from "../database.js";

/** Service-side reference: `C-`/`J-` + 8 hex chars. Retried on collision. */
export function generateReference(prefix: "C" | "J"): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

export class ShopRepository {
  constructor(private readonly db: Db) {}

  async create(ownerUserId: string, input: CreateShop): Promise<Shop> {
    return this.db
      .insertInto("shops")
      .values({
        owner_user_id: ownerUserId,
        name: input.name,
        description: input.description ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        region: input.region ?? null,
        country: input.country ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getById(id: string): Promise<Shop | undefined> {
    return this.db
      .selectFrom("shops")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /** Shops the user belongs to (membership), newest first. */
  async listByUser(userId: string): Promise<Shop[]> {
    return this.db
      .selectFrom("shops")
      .innerJoin("shop_members", "shop_members.shop_id", "shops.id")
      .selectAll("shops")
      .where("shop_members.user_id", "=", userId)
      .orderBy("shops.created_at", "desc")
      .execute();
  }

  async update(
    id: string,
    input: Partial<Pick<Shop, "name" | "description" | "phone" | "email" | "address" | "city" | "region" | "country">>,
  ): Promise<Shop | undefined> {
    return this.db
      .updateTable("shops")
      .set(input)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }
}

export class ShopMemberRepository {
  constructor(private readonly db: Db) {}

  async add(shopId: string, userId: string, role: ShopMemberRole): Promise<ShopMember> {
    return this.db
      .insertInto("shop_members")
      .values({ shop_id: shopId, user_id: userId, role })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async get(shopId: string, userId: string): Promise<ShopMember | undefined> {
    return this.db
      .selectFrom("shop_members")
      .selectAll()
      .where("shop_id", "=", shopId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
  }

  async listByShop(shopId: string): Promise<ShopMember[]> {
    return this.db
      .selectFrom("shop_members")
      .selectAll()
      .where("shop_id", "=", shopId)
      .orderBy("user_id", "asc")
      .execute();
  }

  async setRole(
    shopId: string,
    userId: string,
    role: ShopMemberRole,
  ): Promise<ShopMember | undefined> {
    return this.db
      .updateTable("shop_members")
      .set({ role })
      .where("shop_id", "=", shopId)
      .where("user_id", "=", userId)
      .returningAll()
      .executeTakeFirst();
  }

  async remove(shopId: string, userId: string): Promise<void> {
    await this.db
      .deleteFrom("shop_members")
      .where("shop_id", "=", shopId)
      .where("user_id", "=", userId)
      .execute();
  }

  async countOwners(shopId: string): Promise<number> {
    const row = await this.db
      .selectFrom("shop_members")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("shop_id", "=", shopId)
      .where("role", "=", "owner")
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }
}

export class ShopCustomerRepository {
  constructor(private readonly db: Db) {}

  async create(
    shopId: string,
    reference: string,
    input: CreateShopCustomer,
  ): Promise<ShopCustomer> {
    return this.db
      .insertInto("shop_customers")
      .values({
        shop_id: shopId,
        reference,
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** Tenant-scoped read: rows from other shops never match. */
  async getScoped(shopId: string, id: string): Promise<ShopCustomer | undefined> {
    return this.db
      .selectFrom("shop_customers")
      .selectAll()
      .where("shop_id", "=", shopId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async listByShop(shopId: string, search?: string): Promise<ShopCustomer[]> {
    let query = this.db
      .selectFrom("shop_customers")
      .selectAll()
      .where("shop_id", "=", shopId);
    if (search) {
      const like = `%${search}%`;
      query = query.where((eb) =>
        eb.or([
          eb("name", "ilike", like),
          eb("reference", "ilike", like),
          eb("phone", "ilike", like),
          eb("email", "ilike", like),
        ]),
      );
    }
    return query.orderBy("name", "asc").execute();
  }

  async update(
    shopId: string,
    id: string,
    input: Partial<Pick<ShopCustomer, "name" | "phone" | "email" | "address" | "notes">>,
  ): Promise<ShopCustomer | undefined> {
    return this.db
      .updateTable("shop_customers")
      .set(input)
      .where("shop_id", "=", shopId)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }
}

export class CustomerDeviceRepository {
  constructor(private readonly db: Db) {}

  async create(customerId: string, input: CreateCustomerDevice): Promise<CustomerDevice> {
    return this.db
      .insertInto("customer_devices")
      .values({
        customer_id: customerId,
        category: input.category,
        manufacturer: input.manufacturer ?? null,
        model: input.model ?? null,
        serial_imei: input.serial_imei ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listByCustomer(customerId: string): Promise<CustomerDevice[]> {
    return this.db
      .selectFrom("customer_devices")
      .selectAll()
      .where("customer_id", "=", customerId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async getById(id: string): Promise<CustomerDevice | undefined> {
    return this.db
      .selectFrom("customer_devices")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }
}

export interface RepairJobFilters {
  status?: JobStatus;
  priority?: JobPriority;
  assignee?: string;
  customer?: string;
  from?: string;
  to?: string;
  limit: number;
}

export class RepairJobRepository {
  constructor(private readonly db: Db) {}

  async create(
    shopId: string,
    jobReference: string,
    input: CreateRepairJob,
  ): Promise<RepairJob> {
    return this.db
      .insertInto("repair_jobs")
      .values({
        shop_id: shopId,
        customer_id: input.customer_id,
        device_id: input.device_id ?? null,
        job_reference: jobReference,
        reported_fault: input.reported_fault,
        device_condition: input.device_condition ?? null,
        accessories: input.accessories ?? null,
        assignee_user_id: input.assignee_user_id ?? null,
        priority: input.priority,
        expected_at: input.expected_at ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** Tenant-scoped read: rows from other shops never match. */
  async getScoped(shopId: string, id: string): Promise<RepairJob | undefined> {
    return this.db
      .selectFrom("repair_jobs")
      .selectAll()
      .where("shop_id", "=", shopId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async list(shopId: string, filters: RepairJobFilters): Promise<RepairJob[]> {
    let query = this.db
      .selectFrom("repair_jobs")
      .selectAll()
      .where("shop_id", "=", shopId);
    if (filters.status) {
      query = query.where("status", "=", filters.status);
    }
    if (filters.priority) {
      query = query.where("priority", "=", filters.priority);
    }
    if (filters.assignee) {
      query = query.where("assignee_user_id", "=", filters.assignee);
    }
    if (filters.customer) {
      query = query.where("customer_id", "=", filters.customer);
    }
    if (filters.from) {
      query = query.where(sql<boolean>`repair_jobs.created_at >= ${new Date(filters.from).toISOString()}`);
    }
    if (filters.to) {
      query = query.where(sql<boolean>`repair_jobs.created_at <= ${new Date(filters.to).toISOString()}`);
    }
    return query
      .orderBy("created_at", "desc")
      .limit(filters.limit)
      .execute();
  }

  async update(
    shopId: string,
    id: string,
    input: Partial<
      Pick<
        RepairJob,
        | "status"
        | "assignee_user_id"
        | "priority"
        | "reported_fault"
        | "device_condition"
        | "accessories"
        | "expected_at"
        | "completed_at"
      >
    >,
  ): Promise<RepairJob | undefined> {
    return this.db
      .updateTable("repair_jobs")
      .set(input)
      .where("shop_id", "=", shopId)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  async setSession(
    shopId: string,
    id: string,
    sessionId: string | null,
  ): Promise<RepairJob | undefined> {
    return this.db
      .updateTable("repair_jobs")
      .set({ session_id: sessionId })
      .where("shop_id", "=", shopId)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  /** Status histogram for the report (zero-filled by the caller). */
  async statusCounts(
    shopId: string,
    from?: string,
    to?: string,
  ): Promise<{ status: JobStatus; count: number }[]> {
    let query = this.db
      .selectFrom("repair_jobs")
      .select(["status", (eb) => eb.fn.countAll<number>().as("count")])
      .where("shop_id", "=", shopId);
    if (from) {
      query = query.where(sql<boolean>`repair_jobs.created_at >= ${new Date(from).toISOString()}`);
    }
    if (to) {
      query = query.where(sql<boolean>`repair_jobs.created_at <= ${new Date(to).toISOString()}`);
    }
    const rows = await query.groupBy("status").execute();
    return rows.map((row) => ({ status: row.status, count: Number(row.count) }));
  }

  /** Mean received_at → completed_at over completed jobs, in hours. */
  async avgTurnaroundHours(
    shopId: string,
    from?: string,
    to?: string,
  ): Promise<number | null> {
    let query = this.db
      .selectFrom("repair_jobs")
      .select((eb) =>
        eb.fn.avg<number | string | null>(sql`extract(epoch from (completed_at - received_at)) / 3600`).as("avg_hours"),
      )
      .where("shop_id", "=", shopId)
      .where("status", "=", "completed")
      .where("completed_at", "is not", null);
    if (from) {
      query = query.where(sql<boolean>`repair_jobs.created_at >= ${new Date(from).toISOString()}`);
    }
    if (to) {
      query = query.where(sql<boolean>`repair_jobs.created_at <= ${new Date(to).toISOString()}`);
    }
    const row = await query.executeTakeFirst();
    return row?.avg_hours == null ? null : Number(row.avg_hours);
  }

  /** Per-assignee active vs completed job counts (aggregated in JS). */
  async workload(
    shopId: string,
    from?: string,
    to?: string,
  ): Promise<{ user_id: string; active_jobs: number; completed_jobs: number }[]> {
    const active = new Set<JobStatus>([
      "received",
      "awaiting_diagnosis",
      "diagnosing",
      "awaiting_approval",
      "awaiting_parts",
      "in_repair",
      "testing",
      "ready_for_collection",
    ]);
    const done = new Set<JobStatus>(["completed", "collected"]);
    let query = this.db
      .selectFrom("repair_jobs")
      .select(["assignee_user_id", "status"])
      .where("shop_id", "=", shopId)
      .where("assignee_user_id", "is not", null);
    if (from) {
      query = query.where(sql<boolean>`repair_jobs.created_at >= ${new Date(from).toISOString()}`);
    }
    if (to) {
      query = query.where(sql<boolean>`repair_jobs.created_at <= ${new Date(to).toISOString()}`);
    }
    const rows = await query.execute();
    const byUser = new Map<string, { active_jobs: number; completed_jobs: number }>();
    for (const row of rows) {
      const userId = row.assignee_user_id as string;
      const entry = byUser.get(userId) ?? { active_jobs: 0, completed_jobs: 0 };
      if (active.has(row.status)) {
        entry.active_jobs += 1;
      } else if (done.has(row.status)) {
        entry.completed_jobs += 1;
      }
      byUser.set(userId, entry);
    }
    return [...byUser.entries()].map(([user_id, counts]) => ({ user_id, ...counts }));
  }
}

export class RepairJobEventRepository {
  constructor(private readonly db: Db) {}

  async append(input: {
    jobId: string;
    actorUserId: string | null;
    kind: RepairJobEvent["kind"];
    body?: string | null;
    fromStatus?: JobStatus | null;
    toStatus?: JobStatus | null;
  }): Promise<RepairJobEvent> {
    return this.db
      .insertInto("repair_job_events")
      .values({
        job_id: input.jobId,
        actor_user_id: input.actorUserId,
        kind: input.kind,
        body: input.body ?? null,
        from_status: input.fromStatus ?? null,
        to_status: input.toStatus ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** Timeline order: oldest first. */
  async listByJob(jobId: string): Promise<RepairJobEvent[]> {
    return this.db
      .selectFrom("repair_job_events")
      .selectAll()
      .where("job_id", "=", jobId)
      .orderBy("created_at", "asc")
      .execute();
  }
}

export class RepairEstimateRepository {
  constructor(private readonly db: Db) {}

  async create(
    jobId: string,
    createdByUserId: string,
    input: CreateRepairEstimate,
  ): Promise<RepairEstimate> {
    return this.db
      .insertInto("repair_estimates")
      .values({
        job_id: jobId,
        diagnosis_summary: input.diagnosis_summary ?? null,
        recommended_repair: input.recommended_repair ?? null,
        labor_cents: input.labor_cents,
        other_cents: input.other_cents,
        currency: input.currency,
        validity_days: input.validity_days ?? null,
        terms: input.terms ?? null,
        created_by_user_id: createdByUserId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getById(id: string): Promise<RepairEstimate | undefined> {
    return this.db
      .selectFrom("repair_estimates")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async listByJob(jobId: string): Promise<RepairEstimate[]> {
    return this.db
      .selectFrom("repair_estimates")
      .selectAll()
      .where("job_id", "=", jobId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async update(
    id: string,
    input: Partial<
      Pick<
        RepairEstimate,
        | "status"
        | "diagnosis_summary"
        | "recommended_repair"
        | "labor_cents"
        | "other_cents"
        | "currency"
        | "validity_days"
        | "terms"
        | "decided_at"
      >
    >,
  ): Promise<RepairEstimate | undefined> {
    return this.db
      .updateTable("repair_estimates")
      .set(input)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }
}

export class RepairEstimateItemRepository {
  constructor(private readonly db: Db) {}

  async createMany(
    estimateId: string,
    items: EstimateItemInput[],
  ): Promise<RepairEstimateItem[]> {
    if (items.length === 0) {
      return [];
    }
    return this.db
      .insertInto("repair_estimate_items")
      .values(
        items.map((item) => ({
          estimate_id: estimateId,
          kind: item.kind,
          description: item.description,
          part_number: item.part_number ?? null,
          quantity: item.quantity,
          unit_cents: item.unit_cents,
          source_part_rec_id: item.source_part_rec_id ?? null,
        })),
      )
      .returningAll()
      .execute();
  }

  async listByEstimate(estimateId: string): Promise<RepairEstimateItem[]> {
    return this.db
      .selectFrom("repair_estimate_items")
      .selectAll()
      .where("estimate_id", "=", estimateId)
      .orderBy("description", "asc")
      .execute();
  }

  async listByEstimates(estimateIds: string[]): Promise<RepairEstimateItem[]> {
    if (estimateIds.length === 0) {
      return [];
    }
    return this.db
      .selectFrom("repair_estimate_items")
      .selectAll()
      .where("estimate_id", "in", estimateIds)
      .orderBy("description", "asc")
      .execute();
  }

  async deleteByEstimate(estimateId: string): Promise<void> {
    await this.db
      .deleteFrom("repair_estimate_items")
      .where("estimate_id", "=", estimateId)
      .execute();
  }
}

export class InventoryItemRepository {
  constructor(private readonly db: Db) {}

  async create(shopId: string, input: CreateInventoryItem): Promise<InventoryItem> {
    return this.db
      .insertInto("inventory_items")
      .values({
        shop_id: shopId,
        name: input.name,
        part_number: input.part_number ?? null,
        supplier: input.supplier ?? null,
        cost_cents: input.cost_cents ?? null,
        price_cents: input.price_cents ?? null,
        quantity: input.quantity,
        low_threshold: input.low_threshold,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** Tenant-scoped read: rows from other shops never match. */
  async getScoped(shopId: string, id: string): Promise<InventoryItem | undefined> {
    return this.db
      .selectFrom("inventory_items")
      .selectAll()
      .where("shop_id", "=", shopId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async list(
    shopId: string,
    options: { lowStock: boolean; search?: string; limit: number },
  ): Promise<InventoryItem[]> {
    let query = this.db
      .selectFrom("inventory_items")
      .selectAll()
      .where("shop_id", "=", shopId);
    if (options.lowStock) {
      query = query.whereRef("quantity", "<=", "low_threshold");
    }
    if (options.search) {
      const like = `%${options.search}%`;
      query = query.where((eb) =>
        eb.or([eb("name", "ilike", like), eb("part_number", "ilike", like)]),
      );
    }
    return query.orderBy("name", "asc").limit(options.limit).execute();
  }

  async update(
    shopId: string,
    id: string,
    input: Partial<
      Pick<InventoryItem, "name" | "part_number" | "supplier" | "cost_cents" | "price_cents" | "low_threshold">
    >,
  ): Promise<InventoryItem | undefined> {
    return this.db
      .updateTable("inventory_items")
      .set(input)
      .where("shop_id", "=", shopId)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }
}

export class InventoryMovementRepository {
  constructor(private readonly db: Db) {}

  async listByItem(itemId: string, limit = 100): Promise<InventoryMovement[]> {
    return this.db
      .selectFrom("inventory_movements")
      .selectAll()
      .where("item_id", "=", itemId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  }

  /**
   * Absolute units consumed (negative deltas only) per item in range —
   * the report's parts-consumption leg. No prices involved.
   */
  async consumption(
    shopId: string,
    from?: string,
    to?: string,
  ): Promise<{ item_id: string; item_name: string; quantity_used: number }[]> {
    let query = this.db
      .selectFrom("inventory_movements")
      .innerJoin("inventory_items", "inventory_items.id", "inventory_movements.item_id")
      .select([
        sql<string>`inventory_items.id`.as("item_id"),
        sql<string>`inventory_items.name`.as("item_name"),
        sql<number>`abs(sum(inventory_movements.delta))`.as("quantity_used"),
      ])
      .where("inventory_items.shop_id", "=", shopId)
      .where("inventory_movements.delta", "<", 0);
    if (from) {
      query = query.where(sql<boolean>`inventory_movements.created_at >= ${new Date(from).toISOString()}`);
    }
    if (to) {
      query = query.where(sql<boolean>`inventory_movements.created_at <= ${new Date(to).toISOString()}`);
    }
    const rows = await query
      .groupBy(["inventory_items.id", "inventory_items.name"])
      .orderBy("quantity_used", "desc")
      .execute();
    return rows.map((row) => ({
      item_id: row.item_id,
      item_name: row.item_name,
      quantity_used: Number(row.quantity_used),
    }));
  }
}

/** Estimate lifecycle: converted is terminal and convert-only. */
export const ESTIMATE_TRANSITIONS: Record<EstimateStatus, EstimateStatus[]> = {
  draft: ["sent", "approved", "rejected"],
  sent: ["approved", "rejected", "draft"],
  approved: ["rejected"],
  rejected: ["draft"],
  converted: [],
};
