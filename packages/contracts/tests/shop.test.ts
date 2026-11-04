import { describe, expect, it } from "vitest";
import {
  addShopMemberSchema,
  attachJobSessionSchema,
  createCustomerDeviceSchema,
  createInventoryItemSchema,
  createInventoryMovementSchema,
  createRepairEstimateSchema,
  createRepairJobSchema,
  createRepairJobEventSchema,
  createShopCustomerSchema,
  createShopSchema,
  deviceCategorySchema,
  estimateItemKindSchema,
  estimateStatusSchema,
  jobEventKindSchema,
  jobPrioritySchema,
  jobStatusSchema,
  listInventoryQuerySchema,
  listRepairJobsQuerySchema,
  repairEstimateResponseSchema,
  repairJobDetailResponseSchema,
  shopMemberRoleSchema,
  shopReportSummaryResponseSchema,
  updateRepairEstimateSchema,
  updateRepairJobSchema,
  updateShopMemberSchema,
  updateShopSchema,
} from "../src/index.js";

const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID = "44444444-4444-4444-8444-444444444444";
const ESTIMATE_ID = "55555555-5555-4555-8555-555555555555";
const ITEM_ID = "66666666-6666-4666-8666-666666666666";
const NOW = new Date().toISOString();

describe("shop enums", () => {
  it("accepts every member role, device category, and job status", () => {
    for (const role of ["owner", "admin", "technician", "front_desk"]) {
      expect(shopMemberRoleSchema.safeParse(role).success).toBe(true);
    }
    for (const category of ["laptop", "desktop", "smartphone"]) {
      expect(deviceCategorySchema.safeParse(category).success).toBe(true);
    }
    for (const status of [
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
    ]) {
      expect(jobStatusSchema.safeParse(status).success).toBe(true);
    }
    for (const priority of ["low", "normal", "high", "urgent"]) {
      expect(jobPrioritySchema.safeParse(priority).success).toBe(true);
    }
    for (const kind of ["note", "status_change", "assignment", "estimate", "inventory"]) {
      expect(jobEventKindSchema.safeParse(kind).success).toBe(true);
    }
    for (const status of ["draft", "sent", "approved", "rejected", "converted"]) {
      expect(estimateStatusSchema.safeParse(status).success).toBe(true);
    }
    for (const kind of ["part", "labor", "other"]) {
      expect(estimateItemKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it("rejects unknown enum values", () => {
    expect(shopMemberRoleSchema.safeParse("member").success).toBe(false);
    expect(deviceCategorySchema.safeParse("tablet").success).toBe(false);
    expect(jobStatusSchema.safeParse("in_progress").success).toBe(false);
    expect(jobPrioritySchema.safeParse("critical").success).toBe(false);
    expect(estimateStatusSchema.safeParse("pending").success).toBe(false);
  });
});

describe("createShopSchema / updateShopSchema", () => {
  it("accepts a bare name and trims contact fields", () => {
    const parsed = createShopSchema.safeParse({ name: "  Main St Repair  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe("Main St Repair");
    }
  });

  it("rejects blank names and bad emails", () => {
    expect(createShopSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(createShopSchema.safeParse({}).success).toBe(false);
    expect(
      createShopSchema.safeParse({ name: "Shop", email: "not-an-email" }).success,
    ).toBe(false);
  });

  it("update requires at least one field", () => {
    expect(updateShopSchema.safeParse({}).success).toBe(false);
    expect(updateShopSchema.safeParse({ city: "Austin" }).success).toBe(true);
  });
});

describe("addShopMemberSchema / updateShopMemberSchema", () => {
  it("requires exactly one of user_id or email", () => {
    expect(
      addShopMemberSchema.safeParse({ user_id: USER_ID, role: "technician" }).success,
    ).toBe(true);
    expect(
      addShopMemberSchema.safeParse({ email: "tech@example.com", role: "admin" })
        .success,
    ).toBe(true);
    expect(addShopMemberSchema.safeParse({ role: "admin" }).success).toBe(false);
    expect(
      addShopMemberSchema.safeParse({
        user_id: USER_ID,
        email: "tech@example.com",
        role: "admin",
      }).success,
    ).toBe(false);
    expect(
      addShopMemberSchema.safeParse({ email: "bad", role: "admin" }).success,
    ).toBe(false);
  });

  it("role updates accept the four roles only", () => {
    expect(updateShopMemberSchema.safeParse({ role: "owner" }).success).toBe(true);
    expect(updateShopMemberSchema.safeParse({ role: "member" }).success).toBe(false);
    expect(updateShopMemberSchema.safeParse({}).success).toBe(false);
  });
});

describe("customer and device schemas", () => {
  it("accepts a customer with optional contact fields", () => {
    const parsed = createShopCustomerSchema.safeParse({
      name: "Jane Doe",
      phone: "+1-555-0100",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects blank customer names", () => {
    expect(createShopCustomerSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("accepts a device in each category", () => {
    for (const category of ["laptop", "desktop", "smartphone"]) {
      expect(
        createCustomerDeviceSchema.safeParse({ category, model: "X1" }).success,
      ).toBe(true);
    }
    expect(createCustomerDeviceSchema.safeParse({}).success).toBe(false);
  });
});

describe("createRepairJobSchema / updateRepairJobSchema", () => {
  it("defaults priority to normal", () => {
    const parsed = createRepairJobSchema.safeParse({
      customer_id: CUSTOMER_ID,
      reported_fault: "Will not power on.",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.priority).toBe("normal");
    }
  });

  it("rejects blank faults and bad links", () => {
    expect(
      createRepairJobSchema.safeParse({
        customer_id: CUSTOMER_ID,
        reported_fault: "  ",
      }).success,
    ).toBe(false);
    expect(
      createRepairJobSchema.safeParse({
        customer_id: "not-a-uuid",
        reported_fault: "Broken.",
      }).success,
    ).toBe(false);
  });

  it("update requires at least one field", () => {
    expect(updateRepairJobSchema.safeParse({}).success).toBe(false);
    expect(updateRepairJobSchema.safeParse({ status: "diagnosing" }).success).toBe(
      true,
    );
  });

  it("list query coerces limit and validates filters", () => {
    const parsed = listRepairJobsQuerySchema.safeParse({
      status: "in_repair",
      limit: "10",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.limit).toBe(10);
    }
    expect(
      listRepairJobsQuerySchema.safeParse({ status: "nope" }).success,
    ).toBe(false);
    expect(listRepairJobsQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
  });
});

describe("repairJobDetailResponseSchema", () => {
  const job = {
    id: JOB_ID,
    shop_id: SHOP_ID,
    customer_id: CUSTOMER_ID,
    device_id: null,
    session_id: null,
    job_reference: "J-abcdef01",
    reported_fault: "Will not power on.",
    device_condition: null,
    accessories: null,
    assignee_user_id: null,
    priority: "normal",
    status: "received",
    received_at: NOW,
    expected_at: null,
    completed_at: null,
    created_at: NOW,
    updated_at: NOW,
  };

  it("carries a read-only nullable session safety state", () => {
    expect(
      repairJobDetailResponseSchema.safeParse({
        job,
        session_safety_state: "critical_stop",
      }).success,
    ).toBe(true);
    expect(
      repairJobDetailResponseSchema.safeParse({ job, session_safety_state: null })
        .success,
    ).toBe(true);
    expect(
      repairJobDetailResponseSchema.safeParse({ job }).success,
    ).toBe(false);
  });
});

describe("createRepairJobEventSchema / attachJobSessionSchema", () => {
  it("accepts a note with a body", () => {
    expect(
      createRepairJobEventSchema.safeParse({ kind: "note", body: "Called customer." })
        .success,
    ).toBe(true);
  });

  it("accepts a status_change with from/to", () => {
    expect(
      createRepairJobEventSchema.safeParse({
        kind: "status_change",
        from_status: "received",
        to_status: "diagnosing",
      }).success,
    ).toBe(true);
  });

  it("attach requires a session uuid", () => {
    expect(attachJobSessionSchema.safeParse({ session_id: JOB_ID }).success).toBe(
      true,
    );
    expect(attachJobSessionSchema.safeParse({}).success).toBe(false);
  });
});

describe("estimate schemas", () => {
  it("create defaults cents to zero and currency to USD", () => {
    const parsed = createRepairEstimateSchema.safeParse({
      diagnosis_summary: "Board failure.",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.labor_cents).toBe(0);
      expect(parsed.data.other_cents).toBe(0);
      expect(parsed.data.currency).toBe("USD");
      expect(parsed.data.items).toEqual([]);
    }
  });

  it("rejects negative cents and bad currency", () => {
    expect(
      createRepairEstimateSchema.safeParse({ labor_cents: -1 }).success,
    ).toBe(false);
    expect(createRepairEstimateSchema.safeParse({ currency: "US" }).success).toBe(
      false,
    );
  });

  it("update requires at least one field", () => {
    expect(updateRepairEstimateSchema.safeParse({}).success).toBe(false);
    expect(updateRepairEstimateSchema.safeParse({ status: "sent" }).success).toBe(
      true,
    );
  });

  it("estimate + items envelope validates", () => {
    expect(
      repairEstimateResponseSchema.safeParse({
        estimate: {
          id: ESTIMATE_ID,
          job_id: JOB_ID,
          status: "draft",
          diagnosis_summary: null,
          recommended_repair: null,
          labor_cents: 5000,
          other_cents: 0,
          currency: "USD",
          validity_days: 14,
          terms: null,
          created_by_user_id: USER_ID,
          decided_at: null,
          created_at: NOW,
          updated_at: NOW,
        },
        items: [
          {
            id: ITEM_ID,
            estimate_id: ESTIMATE_ID,
            kind: "part",
            description: "DC jack",
            part_number: "DJ-1",
            quantity: 1,
            unit_cents: 1200,
            source_part_rec_id: null,
          },
        ],
      }).success,
    ).toBe(true);
  });
});

describe("inventory schemas", () => {
  it("create defaults quantity and threshold to zero", () => {
    const parsed = createInventoryItemSchema.safeParse({ name: "DC jack" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.quantity).toBe(0);
      expect(parsed.data.low_threshold).toBe(0);
    }
  });

  it("rejects negative opening quantity", () => {
    expect(
      createInventoryItemSchema.safeParse({ name: "DC jack", quantity: -1 }).success,
    ).toBe(false);
  });

  it("movement delta must be nonzero", () => {
    expect(
      createInventoryMovementSchema.safeParse({ delta: 0, reason: "x" }).success,
    ).toBe(false);
    expect(
      createInventoryMovementSchema.safeParse({ delta: -2, reason: "Used on J-1" })
        .success,
    ).toBe(true);
  });

  it("low_stock query coerces booleans", () => {
    const parsed = listInventoryQuerySchema.safeParse({ low_stock: "true" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.low_stock).toBe(true);
    }
  });
});

describe("shopReportSummaryResponseSchema", () => {
  it("validates a full summary with no revenue fields", () => {
    const parsed = shopReportSummaryResponseSchema.safeParse({
      summary: {
        from: null,
        to: null,
        jobs_total: 3,
        jobs_by_status: {
          received: 1,
          awaiting_diagnosis: 0,
          diagnosing: 1,
          awaiting_approval: 0,
          awaiting_parts: 1,
          in_repair: 0,
          testing: 0,
          completed: 0,
          ready_for_collection: 0,
          collected: 0,
          cancelled: 0,
        },
        in_progress: 1,
        avg_turnaround_hours: null,
        parts_consumption: [
          { item_id: ITEM_ID, item_name: "DC jack", quantity_used: 2 },
        ],
        workload: [{ user_id: USER_ID, active_jobs: 1, completed_jobs: 0 }],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("carries no revenue-from-estimates fields", () => {
    const keys = Object.keys(shopReportSummaryResponseSchema.shape.summary.shape);
    expect(keys).not.toContain("revenue");
    expect(keys).not.toContain("revenue_cents");
    expect(keys).not.toContain("estimated_revenue");
    expect(keys).not.toContain("estimate_total");
  });
});
