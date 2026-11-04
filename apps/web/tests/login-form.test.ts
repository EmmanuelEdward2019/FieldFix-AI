import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ signIn: vi.fn(), completeMfaSignIn: vi.fn(), rememberedEmail: "" }),
  MfaRequiredError: class MfaRequiredError extends Error {
    mfaToken = "";
  },
}));

let capturedPasswordProps: Record<string, unknown> | null = null;
vi.mock("@/components/ui/password-input", () => ({
  PasswordInput: (props: Record<string, unknown>) => {
    capturedPasswordProps = props;
    return null;
  },
}));

import LoginPage from "../app/login/page";

function renderLogin(): string {
  capturedPasswordProps = null;
  return renderToString(React.createElement(LoginPage));
}

describe("login form", () => {
  it("keeps the password input uncontrolled so hydration never wipes manager autofill", () => {
    renderLogin();
    expect(capturedPasswordProps).not.toBeNull();
    // A `value` prop makes React enforce empty-on-hydration, erasing any
    // password the manager autofilled between HTML parse and hydration.
    expect(capturedPasswordProps?.value).toBeUndefined();
    expect(capturedPasswordProps?.onChange).toBeUndefined();
    // Save-prompt prerequisites stay intact.
    expect(capturedPasswordProps?.name).toBe("password");
    expect(capturedPasswordProps?.autoComplete).toBe("current-password");
  });

  it("keeps the email input controlled for app-side prefill", () => {
    const html = renderLogin();
    const tag = html.match(/<input[^>]*id="login-email"[^>]*>/)?.[0] ?? "";
    expect(tag).toContain('name="email"');
    expect(tag).toContain('value="');
  });
});
