import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => React.createElement("a", { href }, children),
}));

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) =>
    React.createElement("img", { src, alt }),
}));

import LandingPage from "../app/page";
import { ThemeProvider } from "../lib/theme";

function renderLanding(): string {
  return renderToString(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(LandingPage),
    ),
  );
}

describe("landing page", () => {
  it("keeps the headline the browser smoke test asserts", () => {
    expect(renderLanding()).toContain("Show the device.");
  });

  it("links to the demo, login, and registration", () => {
    const html = renderLanding();
    expect(html).toContain("Explore the demo");
    expect(html).toContain('href="/demo"');
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/register"');
  });

  it("labels the illustrative telemetry as a sample", () => {
    const html = renderLanding();
    expect(html).toContain("Sample telemetry");
    expect(html).toContain("Sample device");
  });

  it("shows real technician imagery with descriptive alt text", () => {
    const html = renderLanding();
    expect(html).toContain("/landing/technician-phone.jpg");
    expect(html).toContain("/landing/technician-shop.jpg");
    expect(html).toContain("technician");
  });
});
