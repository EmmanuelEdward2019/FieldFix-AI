import { describe, expect, it } from "vitest";
import {
  contactRequestSchema,
  contactRequestStatusSchema,
  createContactRequestSchema,
  createHandoffSchema,
  diagnosticHandoffSchema,
  listContactRequestsResponseSchema,
  listTechniciansResponseSchema,
  searchTechniciansQuerySchema,
  technicianCardSchema,
  technicianListItemSchema,
  technicianResponseSchema,
  updateContactRequestStatusSchema,
  updateTechnicianVerifiedSchema,
  upsertOwnTechnicianProfileSchema,
} from "../src/index.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TECH_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const NOW = new Date().toISOString();

const profileFields = {
  user_id: TECH_ID,
  display_name: "Sam Rivera",
  city: "Austin",
  region: "TX",
  postal_code: "78701",
  latitude: 30.2672,
  longitude: -97.7431,
  specialties: ["board-repair"],
  device_types: ["laptop"],
  about: "Board-level repairs.",
  accepting_requests: true,
  verified: false,
  created_at: NOW,
  updated_at: NOW,
};

describe("contactRequestStatusSchema", () => {
  it("accepts the eight lifecycle states", () => {
    for (const status of [
      "submitted",
      "awaiting_response",
      "accepted",
      "declined",
      "customer_contacted",
      "in_progress",
      "completed",
      "cancelled",
    ]) {
      expect(contactRequestStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects unknown states", () => {
    expect(contactRequestStatusSchema.safeParse("shipped").success).toBe(false);
  });
});

describe("searchTechniciansQuerySchema", () => {
  it("accepts an empty query with radius/limit defaults", () => {
    const parsed = searchTechniciansQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.radius_km).toBe(10);
      expect(parsed.data.limit).toBe(20);
    }
  });

  it("coerces numeric query params and accepts text filters", () => {
    const parsed = searchTechniciansQuerySchema.safeParse({
      city: "Austin",
      region: "TX",
      specialty: "board-repair",
      device_type: "laptop",
      lat: "30.27",
      lng: "-97.74",
      radius_km: "25",
      limit: "5",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.lat).toBeCloseTo(30.27);
      expect(parsed.data.radius_km).toBe(25);
      expect(parsed.data.limit).toBe(5);
    }
  });

  it("requires lat/lng together and bounds radius/limit", () => {
    expect(searchTechniciansQuerySchema.safeParse({ lat: 30 }).success).toBe(false);
    expect(
      searchTechniciansQuerySchema.safeParse({ lat: 30, lng: -97, radius_km: 0 }).success,
    ).toBe(false);
    expect(
      searchTechniciansQuerySchema.safeParse({ lat: 30, lng: -97, radius_km: 201 }).success,
    ).toBe(false);
    expect(searchTechniciansQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(searchTechniciansQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(
      searchTechniciansQuerySchema.safeParse({ lat: 91, lng: 0 }).success,
    ).toBe(false);
  });
});

describe("technician list item vs card", () => {
  it("list items carry distance but no contact PII", () => {
    const parsed = technicianListItemSchema.safeParse({
      ...profileFields,
      distance_km: 3.5,
    });
    expect(parsed.success).toBe(true);
    const keys = Object.keys(technicianListItemSchema.shape);
    expect(keys).toContain("distance_km");
    expect(keys).not.toContain("phone");
    expect(keys).not.toContain("contact_email");
    expect(keys).not.toContain("whatsapp");
  });

  it("cards carry contact PII and no distance", () => {
    const parsed = technicianCardSchema.safeParse({
      ...profileFields,
      phone: "+1-555-0100",
      contact_email: "sam@example.com",
      whatsapp: null,
    });
    expect(parsed.success).toBe(true);
    const keys = Object.keys(technicianCardSchema.shape);
    expect(keys).toContain("phone");
    expect(keys).not.toContain("distance_km");
  });

  it("carries no rating/review fields", () => {
    for (const schema of [technicianListItemSchema, technicianCardSchema]) {
      const keys = Object.keys(schema.shape);
      expect(keys).not.toContain("rating");
      expect(keys).not.toContain("reviews");
      expect(keys).not.toContain("review_count");
    }
  });

  it("list/card response envelopes validate", () => {
    expect(
      listTechniciansResponseSchema.safeParse({
        technicians: [{ ...profileFields, distance_km: null }],
      }).success,
    ).toBe(true);
    expect(
      technicianResponseSchema.safeParse({
        technician: {
          ...profileFields,
          phone: null,
          contact_email: null,
          whatsapp: null,
        },
      }).success,
    ).toBe(true);
  });
});

describe("createContactRequestSchema", () => {
  it("accepts a message with optional session and contact method", () => {
    const parsed = createContactRequestSchema.safeParse({
      session_id: SESSION_ID,
      message: "My laptop will not power on.",
      contact_method: "email",
      preferred_time: "weekday mornings",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects empty and over-long messages", () => {
    expect(createContactRequestSchema.safeParse({ message: "  " }).success).toBe(false);
    expect(
      createContactRequestSchema.safeParse({ message: "x".repeat(2001) }).success,
    ).toBe(false);
  });

  it("request and list envelopes validate", () => {
    const row = {
      id: REQUEST_ID,
      session_id: SESSION_ID,
      requester_user_id: USER_ID,
      technician_user_id: TECH_ID,
      message: "Help.",
      contact_method: null,
      preferred_time: null,
      status: "submitted",
      created_at: NOW,
      updated_at: NOW,
    };
    expect(contactRequestSchema.safeParse(row).success).toBe(true);
    expect(listContactRequestsResponseSchema.safeParse({ requests: [row] }).success).toBe(
      true,
    );
  });
});

describe("updateContactRequestStatusSchema", () => {
  it("accepts lifecycle states only", () => {
    expect(updateContactRequestStatusSchema.safeParse({ status: "accepted" }).success).toBe(
      true,
    );
    expect(updateContactRequestStatusSchema.safeParse({ status: "shipped" }).success).toBe(
      false,
    );
    expect(updateContactRequestStatusSchema.safeParse({}).success).toBe(false);
  });
});

describe("createHandoffSchema", () => {
  it("defaults to no evidence and no report", () => {
    const parsed = createHandoffSchema.safeParse({ session_id: SESSION_ID });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.shared_evidence_ids).toEqual([]);
      expect(parsed.data.shared_report).toBe(false);
    }
  });

  it("accepts an explicit evidence allowlist plus report consent", () => {
    const fileId = "55555555-5555-4555-8555-555555555555";
    const parsed = createHandoffSchema.safeParse({
      session_id: SESSION_ID,
      shared_evidence_ids: [fileId],
      shared_report: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects non-uuid ids and caps the allowlist", () => {
    expect(
      createHandoffSchema.safeParse({
        session_id: SESSION_ID,
        shared_evidence_ids: ["not-a-uuid"],
      }).success,
    ).toBe(false);
    expect(
      createHandoffSchema.safeParse({
        session_id: SESSION_ID,
        shared_evidence_ids: Array.from({ length: 101 }, () => SESSION_ID),
      }).success,
    ).toBe(false);
  });

  it("handoff row schema validates", () => {
    expect(
      diagnosticHandoffSchema.safeParse({
        id: REQUEST_ID,
        request_id: REQUEST_ID,
        session_id: SESSION_ID,
        shared_evidence_ids: [],
        shared_report: false,
        created_by_user_id: USER_ID,
        created_at: NOW,
      }).success,
    ).toBe(true);
  });
});

describe("upsertOwnTechnicianProfileSchema", () => {
  const minimal = { display_name: "Sam Rivera", city: "Austin", region: "TX" };

  it("accepts a minimal profile with array/accepting defaults", () => {
    const parsed = upsertOwnTechnicianProfileSchema.safeParse(minimal);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.specialties).toEqual([]);
      expect(parsed.data.device_types).toEqual([]);
      expect(parsed.data.accepting_requests).toBe(true);
      expect(parsed.data.latitude).toBeUndefined();
    }
  });

  it("accepts a full profile with geo pair and contacts", () => {
    const parsed = upsertOwnTechnicianProfileSchema.safeParse({
      ...minimal,
      postal_code: "78701",
      latitude: 30.2672,
      longitude: -97.7431,
      specialties: ["board-repair"],
      device_types: ["laptop"],
      phone: "+1-555-0100",
      contact_email: "sam@example.com",
      whatsapp: "+1-555-0100",
      about: "Board-level repairs.",
      accepting_requests: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("requires latitude/longitude together or neither", () => {
    expect(
      upsertOwnTechnicianProfileSchema.safeParse({ ...minimal, latitude: 30 }).success,
    ).toBe(false);
    expect(
      upsertOwnTechnicianProfileSchema.safeParse({ ...minimal, longitude: -97 }).success,
    ).toBe(false);
    expect(
      upsertOwnTechnicianProfileSchema.safeParse({
        ...minimal,
        latitude: 30,
        longitude: null,
      }).success,
    ).toBe(false);
    expect(
      upsertOwnTechnicianProfileSchema.safeParse({
        ...minimal,
        latitude: null,
        longitude: null,
      }).success,
    ).toBe(true);
  });

  it("bounds coordinates and requires core text fields", () => {
    expect(
      upsertOwnTechnicianProfileSchema.safeParse({ ...minimal, latitude: 91, longitude: 0 })
        .success,
    ).toBe(false);
    expect(
      upsertOwnTechnicianProfileSchema.safeParse({ ...minimal, latitude: 0, longitude: 181 })
        .success,
    ).toBe(false);
    expect(upsertOwnTechnicianProfileSchema.safeParse({}).success).toBe(false);
    expect(
      upsertOwnTechnicianProfileSchema.safeParse({ ...minimal, display_name: "  " }).success,
    ).toBe(false);
    expect(
      upsertOwnTechnicianProfileSchema.safeParse({ ...minimal, contact_email: "nope" })
        .success,
    ).toBe(false);
  });

  it("strips verified so users can never set the admin badge", () => {
    const parsed = upsertOwnTechnicianProfileSchema.safeParse({
      ...minimal,
      verified: true,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("verified");
      expect(Object.keys(upsertOwnTechnicianProfileSchema.innerType().shape)).not.toContain(
        "verified",
      );
    }
  });
});

describe("updateTechnicianVerifiedSchema", () => {
  it("accepts a boolean toggle only", () => {
    expect(updateTechnicianVerifiedSchema.safeParse({ verified: true }).success).toBe(true);
    expect(updateTechnicianVerifiedSchema.safeParse({}).success).toBe(false);
    expect(updateTechnicianVerifiedSchema.safeParse({ verified: "yes" }).success).toBe(
      false,
    );
  });
});
