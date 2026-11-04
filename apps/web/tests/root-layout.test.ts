import * as React from "react";
import { describe, expect, it } from "vitest";
import RootLayout from "../app/layout";

/**
 * The blocking theme script sets data-theme on <html> before React hydrates,
 * so the server HTML intentionally differs from the first client render.
 * The flag below is the documented way to bless that difference; without it
 * every light-theme visitor gets a hydration-mismatch console error.
 */
describe("root layout", () => {
  it("suppresses the expected html hydration warning for the theme script", () => {
    const el = RootLayout({ children: null }) as React.ReactElement<{
      suppressHydrationWarning?: boolean;
    }>;
    expect(el.type).toBe("html");
    expect(el.props.suppressHydrationWarning).toBe(true);
  });
});
