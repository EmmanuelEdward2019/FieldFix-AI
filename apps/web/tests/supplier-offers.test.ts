import * as React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PartRecommendation } from "@fieldfix/contracts";
import {
  PartOffersSection,
  PartRecommendationCard,
} from "../components/parts-advisor";
import { formatPrice } from "../lib/format";

function part(): PartRecommendation {
  return {
    id: "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa",
    session_id: "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb",
    hypothesis_id: null,
    test_id: "cccccccc-0000-4000-8000-cccccccccccc",
    part_name: "Replacement battery",
    part_number: "BAT-1234",
    manufacturer: "Acme",
    model_compat: "FieldBook 14",
    chunk_id: null,
    excerpt: null,
    status: "proposed",
    created_at: "2026-11-01T00:00:00.000Z",
  };
}

const noop = () => undefined;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formatPrice", () => {
  it("formats minor units with the currency", () => {
    const ngn = formatPrice(1200000, "NGN");
    expect(ngn).toContain("12,000");
    expect(formatPrice(4500000, "USD")).toContain("45,000");
  });

  it("falls back gracefully without a price or currency", () => {
    expect(formatPrice(null, "NGN")).toBe("Price on site");
    expect(formatPrice(-5, "NGN")).toBe("Price on site");
    expect(formatPrice(10000, null)).toContain("100");
  });
});

describe("PartOffersSection", () => {
  it("idles on a button and never fetches before interaction", () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("must not fetch before click");
    });
    vi.stubGlobal("fetch", fetchMock);
    const html = renderToString(
      React.createElement(PartOffersSection, {
        sessionId: "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb",
        recId: "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa",
        token: "tok",
      }),
    );
    expect(html).toContain("Find suppliers");
    expect(html).not.toContain("Loading supplier offers");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("PartRecommendationCard supplier wiring", () => {
  it("shows the finder only when a session and token are present", () => {
    const without = renderToString(
      React.createElement(PartRecommendationCard, { part: part(), working: false, onStatus: noop }),
    );
    expect(without).not.toContain("Find suppliers");
    const connected = renderToString(
      React.createElement(PartRecommendationCard, {
        part: part(),
        working: false,
        onStatus: noop,
        sessionId: "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb",
        token: "tok",
      }),
    );
    expect(connected).toContain("Find suppliers");
  });
});
