import * as React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PartsPanel } from "../components/workstation/parts-panel";

const LIVE = { sessionId: "live-session", token: "tok", onChanged: () => undefined };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PartsPanel demo mode", () => {
  it("shows a labelled placeholder and offers no live controls", () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("demo must not call the API");
    });
    vi.stubGlobal("fetch", fetchMock);
    const html = renderToString(React.createElement(PartsPanel));
    expect(html).toContain("Parts");
    expect(html).toContain("Live sessions");
    expect(html).toContain("never calls the parts API");
    expect(html).not.toContain("Accept");
    expect(html).not.toContain("Dismiss");
    expect(html).not.toContain("Retry");
    expect(html).not.toContain("Loading recommendations");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("PartsPanel live mode", () => {
  it("shows the loading state before lists mount", () => {
    const html = renderToString(React.createElement(PartsPanel, { live: LIVE }));
    expect(html).toContain("Parts");
    expect(html).toContain("Live");
    expect(html).toContain("Loading recommendations");
  });
});

describe("PartsPanel commerce-free UI", () => {
  it("never mentions prices, stock, or suppliers in demo mode", () => {
    const html = renderToString(React.createElement(PartsPanel)).toLowerCase();
    for (const banned of ["price", "pricing", "stock", "supplier", "checkout", "cart", "for sale"]) {
      expect(html).not.toContain(banned);
    }
  });

  it("never mentions prices, stock, or suppliers in live shell", () => {
    const html = renderToString(
      React.createElement(PartsPanel, { live: LIVE }),
    ).toLowerCase();
    for (const banned of ["price", "pricing", "stock", "supplier", "checkout", "cart", "for sale"]) {
      expect(html).not.toContain(banned);
    }
  });
});
