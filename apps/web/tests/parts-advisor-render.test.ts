import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PartRecommendation, ToolRecommendation } from "@fieldfix/contracts";
import {
  PartRecommendationCard,
  RecommendationStatusBadge,
  ToolRecommendationCard,
} from "../components/parts-advisor";

function part(overrides: Partial<PartRecommendation> = {}): PartRecommendation {
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
    excerpt: "Remove the bottom cover with a Torx T5 screwdriver.",
    status: "proposed",
    created_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function tool(overrides: Partial<ToolRecommendation> = {}): ToolRecommendation {
  return {
    id: "dddddddd-0000-4000-8000-dddddddddddd",
    session_id: "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb",
    test_id: null,
    tool_name: "Torx T5 screwdriver",
    spec: "Precision, magnetic tip",
    chunk_id: null,
    status: "proposed",
    created_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

const noop = () => undefined;

describe("RecommendationStatusBadge", () => {
  it("labels each status distinctly", () => {
    expect(
      renderToString(React.createElement(RecommendationStatusBadge, { status: "proposed" })),
    ).toContain("Proposed");
    expect(
      renderToString(React.createElement(RecommendationStatusBadge, { status: "accepted" })),
    ).toContain("Accepted");
    expect(
      renderToString(React.createElement(RecommendationStatusBadge, { status: "dismissed" })),
    ).toContain("Dismissed");
  });
});

describe("PartRecommendationCard", () => {
  it("shows name, identifiers, excerpt, and test grounding", () => {
    const html = renderToString(
      React.createElement(PartRecommendationCard, { part: part(), working: false, onStatus: noop }),
    );
    expect(html).toContain("Replacement battery");
    expect(html).toContain("BAT-1234");
    expect(html).toContain("Acme");
    expect(html).toContain("FieldBook 14");
    expect(html).toContain("Torx T5 screwdriver");
    expect(html).toContain("Grounded in a recorded diagnostic test");
  });

  it("offers accept and dismiss while proposed", () => {
    const html = renderToString(
      React.createElement(PartRecommendationCard, { part: part(), working: false, onStatus: noop }),
    );
    expect(html).toContain("Accept");
    expect(html).toContain("Dismiss");
  });

  it("offers reversal once decided", () => {
    const accepted = renderToString(
      React.createElement(PartRecommendationCard, {
        part: part({ status: "accepted" }),
        working: false,
        onStatus: noop,
      }),
    );
    expect(accepted).toContain("Mark");
    expect(accepted).toContain("dismissed");
    expect(accepted).not.toContain(">Accept<");
    const dismissed = renderToString(
      React.createElement(PartRecommendationCard, {
        part: part({ status: "dismissed" }),
        working: false,
        onStatus: noop,
      }),
    );
    expect(dismissed).toContain("Mark");
    expect(dismissed).toContain("accepted");
  });

  it("omits missing identifiers without empty rows", () => {
    const html = renderToString(
      React.createElement(PartRecommendationCard, {
        part: part({ part_number: null, manufacturer: null, model_compat: null, excerpt: null }),
        working: false,
        onStatus: noop,
      }),
    );
    expect(html).not.toContain("Part no.");
    expect(html).not.toContain("Brand");
    expect(html).not.toContain("Fits");
  });
});

describe("ToolRecommendationCard", () => {
  it("shows name, spec, and status actions", () => {
    const html = renderToString(
      React.createElement(ToolRecommendationCard, { tool: tool(), working: false, onStatus: noop }),
    );
    expect(html).toContain("Torx T5 screwdriver");
    expect(html).toContain("magnetic tip");
    expect(html).toContain("Proposed");
    expect(html).toContain("Accept");
    expect(html).toContain("Dismiss");
  });
});
