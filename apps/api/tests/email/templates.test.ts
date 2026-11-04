import { describe, expect, it } from "vitest";
import {
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  confirmationTemplate,
  diagnosticReportTemplate,
  mfaEnabledTemplate,
  passwordChangedTemplate,
  passwordResetTemplate,
  type BuiltTemplate,
} from "../../src/email/templates.js";

function expectBranded(tpl: BuiltTemplate): void {
  for (const body of [tpl.text, tpl.html]) {
    expect(body).toContain("FieldFix AI");
    expect(body).toContain(SUPPORT_EMAIL);
    expect(body).toContain(SUPPORT_PHONE);
  }
  // Table layout, inline styles, no external assets or scripts.
  expect(tpl.html).toContain("<table");
  expect(tpl.html).toContain('style="');
  expect(tpl.html).not.toContain("<link");
  expect(tpl.html).not.toContain("<img");
  expect(tpl.html).not.toContain("<script");
  expect(tpl.subject.length).toBeGreaterThan(0);
}

describe("confirmationTemplate", () => {
  it("greets, links, and carries the brand footer", () => {
    const tpl = confirmationTemplate("Ada", "https://app/verify-email?token=abc");
    expect(tpl.subject).toContain("Confirm");
    expect(tpl.text).toContain("Hi Ada,");
    expect(tpl.text).toContain("https://app/verify-email?token=abc");
    expect(tpl.text).toContain("24 hours");
    expect(tpl.html).toContain("Confirm my account");
    expectBranded(tpl);
  });

  it("escapes user input in html", () => {
    const tpl = confirmationTemplate("<b>Ada</b>", "https://app/?x=1&y=2");
    expect(tpl.html).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(tpl.html).not.toContain("<b>Ada</b>");
    expect(tpl.html).toContain("x=1&amp;y=2");
  });
});

describe("passwordResetTemplate", () => {
  it("states the 1-hour single-use terms", () => {
    const tpl = passwordResetTemplate("Ada", "https://app/reset-password?token=abc");
    expect(tpl.subject).toContain("Reset");
    expect(tpl.text).toContain("1 hour, single use");
    expect(tpl.text).toContain("https://app/reset-password?token=abc");
    expect(tpl.html).toContain("Reset my password");
    expectBranded(tpl);
  });
});

describe("passwordChangedTemplate", () => {
  it("confirms the change with a sign-in path", () => {
    const tpl = passwordChangedTemplate("Ada", "https://app/login");
    expect(tpl.subject).toContain("changed");
    expect(tpl.text).toContain("https://app/login");
    expect(tpl.text).toContain("If this wasn't you");
    expect(tpl.html).toContain("Sign in");
    expectBranded(tpl);
  });
});

describe("mfaEnabledTemplate", () => {
  it("confirms 2FA without ever including secrets", () => {
    const tpl = mfaEnabledTemplate("Ada", "https://app/profile#security");
    expect(tpl.subject).toContain("Two-factor");
    expect(tpl.text).toContain("never emailed");
    expect(tpl.text).toContain("https://app/profile#security");
    expect(tpl.html).toContain("Review security settings");
    expectBranded(tpl);
  });
});

describe("diagnosticReportTemplate", () => {
  function input() {
    return {
      name: "Ada",
      deviceLabel: "HP Pavilion",
      symptoms: "No power.",
      hypotheses: [{ title: "Dead adapter", status: "proposed", confidence: "high" }],
      testsPerformed: [{ name: "Adapter LED check", result: "No light." }],
      nextSteps: ["Try a known-good adapter."],
      reportUrl: "https://app/diagnostics/123",
    };
  }

  it("renders device, hypotheses, tests, and next steps", () => {
    const tpl = diagnosticReportTemplate(input());
    expect(tpl.subject).toContain("HP Pavilion");
    expect(tpl.text).toContain("Dead adapter");
    expect(tpl.text).toContain("Adapter LED check: No light.");
    expect(tpl.text).toContain("Try a known-good adapter.");
    expect(tpl.text).toContain("https://app/diagnostics/123");
    expect(tpl.html).toContain("Open full report");
    expectBranded(tpl);
  });

  it("omits empty sections instead of rendering blanks", () => {
    const tpl = diagnosticReportTemplate({
      ...input(),
      hypotheses: [],
      testsPerformed: [],
      nextSteps: [],
    });
    expect(tpl.text).not.toContain("Fault hypotheses:");
    expect(tpl.html).not.toContain("Fault hypotheses");
    expect(tpl.html).not.toContain("Tests performed");
  });
});
