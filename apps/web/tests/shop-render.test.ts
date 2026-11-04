import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  JobPriority,
  JobStatus,
  RepairEstimateItem,
  RepairJob,
  RepairJobEvent,
  SafetyState,
  ShopCustomer,
} from "@fieldfix/contracts";
import {
  CustomerRow,
  estimateGrandTotalCents,
  estimateItemsTotalCents,
  EstimateStatusBadge,
  formatCents,
  groupJobsByStatus,
  isHazardousSafetyState,
  isLowStock,
  JobCard,
  JobEventRow,
  jobPriorityLabel,
  JobPriorityBadge,
  jobStatusLabel,
  JobStatusBadge,
  SafetyWarningBanner,
} from "../components/shop/shop-ui";

function job(overrides: Partial<RepairJob> = {}): RepairJob {
  return {
    id: "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb",
    shop_id: "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa",
    customer_id: "cccccccc-0000-4000-8000-cccccccccccc",
    device_id: null,
    session_id: null,
    job_reference: "J-1234abcd",
    reported_fault: "Screen flickers after ten minutes of use.",
    device_condition: null,
    accessories: null,
    assignee_user_id: null,
    priority: "normal",
    status: "received",
    received_at: "2026-11-01T00:00:00.000Z",
    expected_at: null,
    completed_at: null,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function customer(overrides: Partial<ShopCustomer> = {}): ShopCustomer {
  return {
    id: "cccccccc-0000-4000-8000-cccccccccccc",
    shop_id: "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa",
    reference: "C-5678efgh",
    name: "Ada Lovelace",
    phone: "555-0100",
    email: null,
    address: null,
    notes: null,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function event(overrides: Partial<RepairJobEvent> = {}): RepairJobEvent {
  return {
    id: "dddddddd-0000-4000-8000-dddddddddddd",
    job_id: "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb",
    actor_user_id: null,
    kind: "note",
    body: "Called the customer for the charger.",
    from_status: null,
    to_status: null,
    created_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function estimateItem(overrides: Partial<RepairEstimateItem> = {}): RepairEstimateItem {
  return {
    id: "eeeeeeee-0000-4000-8000-eeeeeeeeeeee",
    estimate_id: "ffffffff-0000-4000-8000-ffffffffffff",
    kind: "part",
    description: "OLED panel",
    part_number: "PN-42",
    quantity: 1,
    unit_cents: 8900,
    source_part_rec_id: null,
    ...overrides,
  };
}

const noopJob = () => undefined;
const noopCustomer = () => undefined;

describe("JobStatusBadge", () => {
  const cases: Array<[JobStatus, string]> = [
    ["received", "Received"],
    ["awaiting_diagnosis", "Awaiting diagnosis"],
    ["diagnosing", "Diagnosing"],
    ["awaiting_approval", "Awaiting approval"],
    ["awaiting_parts", "Awaiting parts"],
    ["in_repair", "In repair"],
    ["testing", "Testing"],
    ["completed", "Completed"],
    ["ready_for_collection", "Ready for collection"],
    ["collected", "Collected"],
    ["cancelled", "Cancelled"],
  ];
  for (const [status, label] of cases) {
    it(`labels ${status}`, () => {
      expect(jobStatusLabel(status)).toBe(label);
      const html = renderToString(React.createElement(JobStatusBadge, { status }));
      expect(html).toContain(label);
    });
  }
});

describe("JobPriorityBadge", () => {
  const cases: Array<[JobPriority, string]> = [
    ["low", "Low"],
    ["normal", "Normal"],
    ["high", "High"],
    ["urgent", "Urgent"],
  ];
  for (const [priority, label] of cases) {
    it(`labels ${priority}`, () => {
      expect(jobPriorityLabel(priority)).toBe(label);
      const html = renderToString(React.createElement(JobPriorityBadge, { priority }));
      expect(html).toContain(label);
    });
  }
});

describe("JobCard", () => {
  it("shows reference, fault, customer, device, status, and activity", () => {
    const html = renderToString(
      React.createElement(JobCard, {
        job: job({ status: "in_repair", assignee_user_id: "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa" }),
        customerName: "Ada Lovelace",
        deviceLabel: "laptop · ThinkPad",
        hazardous: false,
        onOpen: noopJob,
      }),
    );
    expect(html).toContain("J-1234abcd");
    expect(html).toContain("Screen flickers");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("ThinkPad");
    expect(html).toContain("In repair");
    expect(html).toContain("Assigned");
  });

  it("flags hazardous jobs and tolerates missing customer/device", () => {
    const html = renderToString(
      React.createElement(JobCard, {
        job: job(),
        customerName: null,
        deviceLabel: null,
        hazardous: true,
        onOpen: noopJob,
      }),
    );
    expect(html).toContain("Hazard");
    expect(html).toContain("Unknown customer");
  });
});

describe("SafetyWarningBanner", () => {
  const hazardous: SafetyState[] = ["critical_stop", "caution"];
  for (const state of hazardous) {
    it(`warns prominently for ${state}`, () => {
      const html = renderToString(React.createElement(SafetyWarningBanner, { state }));
      expect(html).toContain("alert");
      expect(html).toContain(state === "critical_stop" ? "Safety stop" : "Caution");
    });
  }

  it("renders nothing for normal, review_required, or null", () => {
    for (const state of ["normal", "review_required", null] as const) {
      expect(isHazardousSafetyState(state)).toBe(false);
      const html = renderToString(React.createElement(SafetyWarningBanner, { state }));
      expect(html).toBe("");
    }
    expect(isHazardousSafetyState("critical_stop")).toBe(true);
    expect(isHazardousSafetyState("caution")).toBe(true);
  });
});

describe("JobEventRow", () => {
  it("renders notes with their body", () => {
    const html = renderToString(React.createElement(JobEventRow, { event: event() }));
    expect(html).toContain("Note");
    expect(html).toContain("Called the customer");
  });

  it("renders status transitions as from to to", () => {
    const html = renderToString(
      React.createElement(JobEventRow, {
        event: event({
          kind: "status_change",
          body: null,
          from_status: "received",
          to_status: "diagnosing",
        }),
      }),
    );
    expect(html).toContain("Status change");
    expect(html).toContain("Received");
    expect(html).toContain("Diagnosing");
  });
});

describe("CustomerRow", () => {
  it("shows reference, name, and contact line", () => {
    const html = renderToString(
      React.createElement(CustomerRow, { customer: customer(), deviceCount: 2, onOpen: noopCustomer }),
    );
    expect(html).toContain("C-5678efgh");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("555-0100");
    expect(html).toContain("2 devices");
  });

  it("tolerates missing contact details", () => {
    const html = renderToString(
      React.createElement(CustomerRow, {
        customer: customer({ phone: null }),
        deviceCount: null,
        onOpen: noopCustomer,
      }),
    );
    expect(html).toContain("No contact details");
  });
});

describe("groupJobsByStatus", () => {
  it("covers every status in stable column order", () => {
    const grouped = groupJobsByStatus([
      job({ id: "11111111-0000-4000-8000-111111111111", status: "testing" }),
      job({ id: "22222222-0000-4000-8000-222222222222", status: "received" }),
      job({ id: "33333333-0000-4000-8000-333333333333", status: "testing" }),
    ]);
    expect(grouped.map((col) => col.status)).toEqual([
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
    expect(grouped[0]?.jobs).toHaveLength(1);
    expect(grouped[6]?.jobs).toHaveLength(2);
    expect(grouped[3]?.jobs).toHaveLength(0);
  });
});

describe("EstimateStatusBadge", () => {
  it("labels every estimate status", () => {
    const cases = [
      ["draft", "Draft"],
      ["sent", "Sent"],
      ["approved", "Approved"],
      ["rejected", "Rejected"],
      ["converted", "Converted"],
    ] as const;
    for (const [status, label] of cases) {
      const html = renderToString(React.createElement(EstimateStatusBadge, { status }));
      expect(html).toContain(label);
    }
  });
});

describe("estimate totals", () => {
  it("sums quantity times unit price plus labor and other", () => {
    const items = [
      estimateItem({ quantity: 2, unit_cents: 1000 }),
      estimateItem({
        id: "99999999-0000-4000-8000-999999999999",
        kind: "labor",
        description: "Bench time",
        part_number: null,
        quantity: 1,
        unit_cents: 500,
      }),
    ];
    expect(estimateItemsTotalCents(items)).toBe(2500);
    expect(
      estimateGrandTotalCents({ items, labor_cents: 300, other_cents: 200 }),
    ).toBe(3000);
  });

  it("formats cents as currency", () => {
    expect(formatCents(3000)).toContain("30.00");
    expect(formatCents(0)).toContain("0.00");
  });
});

describe("isLowStock", () => {
  it("flags quantities at or below the threshold", () => {
    expect(isLowStock(0, 0)).toBe(true);
    expect(isLowStock(2, 5)).toBe(true);
    expect(isLowStock(5, 5)).toBe(true);
    expect(isLowStock(6, 5)).toBe(false);
  });
});
