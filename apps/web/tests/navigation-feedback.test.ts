import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href }, children),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    status: "signed-in",
    user: { email: "tech@example.com" },
    signOut: vi.fn(),
  }),
}));

vi.mock("@/components/console/admin-auth", () => ({
  useAdminAuth: () => ({
    loading: false,
    me: { actor_email: "admin@example.com", role: "admin", capabilities: ["ai:view"] },
    error: null,
  }),
  useCan: () => true,
}));

import { AppShell } from "../components/app-shell";
import { AdminShell } from "../components/console/admin-shell";
import { ThemeProvider } from "../lib/theme";
import AppLoading from "../app/(app)/loading";
import AdminLoading from "../app/admin/loading";

function themed(node: React.ReactElement): string {
  return renderToString(React.createElement(ThemeProvider, null, node));
}

describe("navigation feedback", () => {
  it("renders app shell nav links with no progress bar at rest", () => {
    const html = themed(React.createElement(AppShell, null, "page"));
    expect(html).toContain('href="/diagnostics"');
    expect(html).toContain('href="/parts"');
    expect(html).not.toContain("z-[70]");
  });

  it("renders admin shell nav with no progress bar at rest", () => {
    const html = themed(React.createElement(AdminShell, null, "page"));
    expect(html).toContain('href="/admin/providers"');
    expect(html).not.toContain("z-[70]");
  });

  it("renders app loading state as an announced skeleton", () => {
    const html = renderToString(React.createElement(AppLoading));
    expect(html).toContain('aria-label="Loading page"');
    expect(html).toContain("animate-pulse");
  });

  it("renders admin loading state as an announced skeleton", () => {
    const html = renderToString(React.createElement(AdminLoading));
    expect(html).toContain('aria-label="Loading page"');
  });
});
