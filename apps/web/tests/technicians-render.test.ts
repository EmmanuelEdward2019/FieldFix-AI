import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ContactRequestStatus, TechnicianListItem } from "@fieldfix/contracts";
import {
  formatDistanceKm,
  nextActionsFor,
  RequestStatusBadge,
  requestStatusLabel,
  TechnicianResultCard,
} from "../components/technicians";

function tech(overrides: Partial<TechnicianListItem> = {}): TechnicianListItem {
  return {
    user_id: "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa",
    display_name: "Riley Repairs",
    city: "Austin",
    region: "TX",
    postal_code: null,
    latitude: null,
    longitude: null,
    specialties: ["board repair", "data recovery"],
    device_types: ["laptop"],
    about: "Mail-in and walk-in service.",
    accepting_requests: true,
    verified: false,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    distance_km: null,
    ...overrides,
  };
}

const noop = () => undefined;

describe("TechnicianResultCard", () => {
  it("shows name, services, location, and accepting status", () => {
    const html = renderToString(
      React.createElement(TechnicianResultCard, { tech: tech(), onContact: noop }),
    );
    expect(html).toContain("Riley Repairs");
    expect(html).toContain("board repair");
    expect(html).toContain("Austin");
    expect(html).toContain("TX");
    expect(html).toContain("Accepting requests");
    expect(html).toContain("Contact");
  });

  it("shows the verified badge only when verified is true", () => {
    const verified = renderToString(
      React.createElement(TechnicianResultCard, {
        tech: tech({ verified: true }),
        onContact: noop,
      }),
    );
    expect(verified).toContain("Verified");
    const unverified = renderToString(
      React.createElement(TechnicianResultCard, { tech: tech(), onContact: noop }),
    );
    expect(unverified).not.toContain("Verified");
  });

  it("shows distance when calculable and omits it otherwise", () => {
    const near = renderToString(
      React.createElement(TechnicianResultCard, {
        tech: tech({ distance_km: 3.24 }),
        onContact: noop,
      }),
    );
    expect(near).toContain("3.2 km away");
    const far = renderToString(
      React.createElement(TechnicianResultCard, { tech: tech(), onContact: noop }),
    );
    expect(far).not.toContain("km away");
  });

  it("disables contact when the technician is not accepting", () => {
    const html = renderToString(
      React.createElement(TechnicianResultCard, {
        tech: tech({ accepting_requests: false }),
        onContact: noop,
      }),
    );
    expect(html).toContain("Not accepting");
    expect(html).toContain("disabled");
  });

  it("never mentions ratings, reviews, or contact PII", () => {
    const html = renderToString(
      React.createElement(TechnicianResultCard, { tech: tech(), onContact: noop }),
    ).toLowerCase();
    for (const banned of ["rating", "stars", "review", "phone", "email", "whatsapp"]) {
      expect(html).not.toContain(banned);
    }
  });
});

describe("RequestStatusBadge", () => {
  const cases: Array<[ContactRequestStatus, string]> = [
    ["submitted", "Submitted"],
    ["awaiting_response", "Awaiting response"],
    ["accepted", "Accepted"],
    ["declined", "Declined"],
    ["customer_contacted", "Contacted"],
    ["in_progress", "In progress"],
    ["completed", "Completed"],
    ["cancelled", "Cancelled"],
  ];
  for (const [status, label] of cases) {
    it(`labels ${status}`, () => {
      expect(requestStatusLabel(status)).toBe(label);
      const html = renderToString(
        React.createElement(RequestStatusBadge, { status }),
      );
      expect(html).toContain(label);
    });
  }
});

describe("nextActionsFor", () => {
  it("lets the requester side only cancel active requests", () => {
    expect(nextActionsFor("submitted", "sent")).toEqual([
      { status: "cancelled", label: "Cancel request" },
    ]);
    expect(nextActionsFor("in_progress", "sent")).toEqual([
      { status: "cancelled", label: "Cancel request" },
    ]);
  });

  it("offers the requester nothing on terminal states", () => {
    for (const status of ["declined", "completed", "cancelled"] as const) {
      expect(nextActionsFor(status, "sent")).toEqual([]);
    }
  });

  it("lets the technician side accept or decline new requests", () => {
    const actions = nextActionsFor("submitted", "received").map((a) => a.status);
    expect(actions).toContain("accepted");
    expect(actions).toContain("declined");
    expect(actions).not.toContain("cancelled");
  });

  it("narrows technician actions as work progresses", () => {
    expect(nextActionsFor("in_progress", "received")).toEqual([
      { status: "completed", label: "Complete" },
    ]);
  });

  it("offers the technician nothing on terminal states", () => {
    for (const status of ["declined", "completed", "cancelled"] as const) {
      expect(nextActionsFor(status, "received")).toEqual([]);
    }
  });
});

describe("formatDistanceKm", () => {
  it("returns null without a distance", () => {
    expect(formatDistanceKm(null)).toBeNull();
  });

  it("shows one decimal under 10 km and rounds above", () => {
    expect(formatDistanceKm(3.24)).toBe("3.2 km away");
    expect(formatDistanceKm(12.6)).toBe("13 km away");
  });
});
