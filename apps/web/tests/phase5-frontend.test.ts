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

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn() }),
}));

import type { MySessionItem, TechnicianCard } from "@fieldfix/contracts";
import { PRIMARY_NAV } from "../components/app-shell";
import {
  ContextualShortcuts,
  ContinueDiagnosisWidget,
  latestActiveSession,
  NewDiagnosisWidget,
  PartsHintWidget,
  ReportsShortcutWidget,
  ShopShortcutWidget,
  TechnicianShortcutWidget,
} from "../components/dashboard-shortcuts";
import { notificationKindIcon } from "../components/notification-bell";
import {
  cardToForm,
  emptyProfileForm,
  OwnTechnicianProfileForm,
  parseCommaList,
  profileFormToPayload,
} from "../components/own-technician-profile";
import { TechnicianHandoffCta } from "../components/workstation/technician-handoff-cta";
import {
  hasRemainingSafeTest,
  hypothesesInconclusive,
  sessionTechnicianSignal,
  workspaceTechnicianSignal,
} from "../lib/technician-handoff";

function session(overrides: Partial<MySessionItem> = {}): MySessionItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    device_type: "laptop",
    manufacturer: "Acme",
    model: "AcmeBook Pro 14",
    operating_system: null,
    symptoms: "Will not power on.",
    problem_started_at: null,
    problem_started_note: null,
    recent_events: null,
    user_mode: "everyday",
    status: "in_progress",
    safety_state: "normal",
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T01:00:00.000Z",
    test_count: 2,
    tests_recorded: 1,
    evidence_count: 1,
    ...overrides,
  };
}

function card(overrides: Partial<TechnicianCard> = {}): TechnicianCard {
  return {
    user_id: "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa",
    display_name: "Riley Repairs",
    city: "Austin",
    region: "TX",
    postal_code: null,
    latitude: null,
    longitude: null,
    specialties: ["board repair"],
    device_types: ["laptop"],
    about: null,
    accepting_requests: true,
    verified: false,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    phone: null,
    contact_email: null,
    whatsapp: null,
    ...overrides,
  };
}

const noop = () => undefined;

describe("primary nav (Phase 5)", () => {
  it("orders Dashboard, Diagnostics, Repair Reports, Parts Advisor, Voice Guidance first", () => {
    const labels = PRIMARY_NAV.map((item) => item.label);
    expect(labels.slice(0, 5)).toEqual([
      "Dashboard",
      "Diagnostics",
      "Repair Reports",
      "Parts Advisor",
      "Voice Guidance",
    ]);
    const hrefs = PRIMARY_NAV.map((item) => item.href);
    expect(hrefs).toContain("/technicians");
    expect(hrefs).toContain("/shop");
  });

  it("keeps Knowledge Centre after the workspace entries", () => {
    const labels = PRIMARY_NAV.map((item) => item.label);
    expect(labels.indexOf("Knowledge Centre")).toBeGreaterThan(labels.indexOf("Shop Workspace"));
  });

  it("promotes Parts Advisor and Voice Guidance to top-level entries", () => {
    const hrefs = PRIMARY_NAV.map((item) => item.href);
    expect(hrefs).toContain("/parts");
    expect(hrefs).toContain("/voice");
    const labels = PRIMARY_NAV.map((item) => item.label);
    expect(labels).toContain("Parts Advisor");
    expect(labels).toContain("Voice Guidance");
  });

  it("orders the advisor entries between reports and technician discovery", () => {
    const labels = PRIMARY_NAV.map((item) => item.label);
    expect(labels.indexOf("Parts Advisor")).toBeGreaterThan(labels.indexOf("Repair Reports"));
    expect(labels.indexOf("Voice Guidance")).toBeGreaterThan(labels.indexOf("Parts Advisor"));
    expect(labels.indexOf("Find a Technician")).toBeGreaterThan(labels.indexOf("Voice Guidance"));
  });
});

describe("technician-handoff rules", () => {
  it("finds a remaining safe test", () => {
    expect(hasRemainingSafeTest([])).toBe(false);
    expect(
      hasRemainingSafeTest([
        { result: { selected_option: "a" }, status: "completed" },
        { result: null, status: "blocked" },
        { result: null, status: "skipped" },
      ]),
    ).toBe(false);
    expect(hasRemainingSafeTest([{ result: null, status: "pending" }])).toBe(true);
  });

  it("calls hypotheses inconclusive only while none are verified", () => {
    expect(hypothesesInconclusive([])).toBe(false);
    expect(hypothesesInconclusive([{ status: "supported" }, { status: "ruled_out" }])).toBe(true);
    expect(hypothesesInconclusive([{ status: "verified" }])).toBe(false);
  });

  it("flags critical_stop at workspace level no matter what", () => {
    expect(
      workspaceTechnicianSignal({
        safety_state: "critical_stop",
        tests: [{ result: null, status: "pending" }],
        hypotheses: [],
      }),
    ).toBe("critical_stop");
  });

  it("never flags while a safe test remains", () => {
    expect(
      workspaceTechnicianSignal({
        safety_state: "normal",
        tests: [{ result: null, status: "pending" }],
        hypotheses: [{ status: "weakened" }],
      }),
    ).toBeNull();
  });

  it("flags exhausted, unverified work as inconclusive", () => {
    expect(
      workspaceTechnicianSignal({
        safety_state: "normal",
        tests: [{ result: { selected_option: "a" }, status: "completed" }],
        hypotheses: [{ status: "weakened" }],
      }),
    ).toBe("inconclusive");
  });

  it("stays quiet for fresh and verified sessions", () => {
    expect(
      workspaceTechnicianSignal({ safety_state: "normal", tests: [], hypotheses: [] }),
    ).toBeNull();
    expect(
      workspaceTechnicianSignal({
        safety_state: "normal",
        tests: [{ result: { selected_option: "a" }, status: "completed" }],
        hypotheses: [{ status: "verified" }],
      }),
    ).toBeNull();
  });

  it("derives the dashboard signal from list items", () => {
    expect(sessionTechnicianSignal(session())).toBeNull();
    expect(sessionTechnicianSignal(session({ safety_state: "critical_stop" }))).toBe(
      "critical_stop",
    );
    expect(
      sessionTechnicianSignal(session({ test_count: 3, tests_recorded: 3 })),
    ).toBe("inconclusive");
    expect(
      sessionTechnicianSignal(session({ status: "completed", test_count: 3, tests_recorded: 3 })),
    ).toBeNull();
    expect(sessionTechnicianSignal(session({ test_count: 0, tests_recorded: 0 }))).toBeNull();
  });
});

describe("TechnicianHandoffCta", () => {
  it("recommends professional help on critical_stop without DIY steps", () => {
    const html = renderToString(
      React.createElement(TechnicianHandoffCta, {
        safetyState: "critical_stop",
        tests: [],
        hypotheses: [],
      }),
    );
    expect(html).toContain("Contact Technicians Near Me");
    expect(html).toContain("/technicians");
    expect(html).toContain("professional help");
    expect(html).not.toContain("Record result");
  });

  it("shows the directory action when the diagnosis stalls", () => {
    const html = renderToString(
      React.createElement(TechnicianHandoffCta, {
        safetyState: "normal",
        tests: [{ result: { selected_option: "a" }, status: "completed" }],
        hypotheses: [{ status: "weakened" }],
      }),
    );
    expect(html).toContain("Contact Technicians Near Me");
    expect(html).toContain("/technicians");
  });

  it("renders nothing while a safe test remains or work is verified", () => {
    const pending = renderToString(
      React.createElement(TechnicianHandoffCta, {
        safetyState: "normal",
        tests: [{ result: null, status: "pending" }],
        hypotheses: [{ status: "weakened" }],
      }),
    );
    expect(pending).toBe("");
    const verified = renderToString(
      React.createElement(TechnicianHandoffCta, {
        safetyState: "normal",
        tests: [{ result: { selected_option: "a" }, status: "completed" }],
        hypotheses: [{ status: "verified" }],
      }),
    );
    expect(verified).toBe("");
  });
});

describe("dashboard shortcuts", () => {
  it("picks the latest active session to continue", () => {
    expect(latestActiveSession([])).toBeNull();
    expect(
      latestActiveSession([session({ status: "completed" }), session({ status: "archived" })]),
    ).toBeNull();
    const older = session({
      id: "22222222-2222-4222-8222-222222222222",
      updated_at: "2026-11-01T00:00:00.000Z",
    });
    const newer = session({
      id: "33333333-3333-4333-8333-333333333333",
      status: "awaiting_test",
      updated_at: "2026-11-01T02:00:00.000Z",
    });
    expect(latestActiveSession([older, newer])?.id).toBe(newer.id);
  });

  it("links a fresh diagnosis", () => {
    const html = renderToString(React.createElement(NewDiagnosisWidget));
    expect(html).toContain("/diagnostics/new");
    expect(html).toContain("New Diagnosis");
  });

  it("continues the latest session and is honest when there is none", () => {
    const html = renderToString(
      React.createElement(ContinueDiagnosisWidget, { session: session() }),
    );
    expect(html).toContain("/diagnostics/11111111-1111-4111-8111-111111111111");
    expect(html).toContain("AcmeBook Pro 14");
    const empty = renderToString(React.createElement(ContinueDiagnosisWidget, { session: null }));
    expect(empty).toContain("No in-progress diagnoses");
  });

  it("recommends a technician only for stalled sessions", () => {
    const calm = renderToString(
      React.createElement(TechnicianShortcutWidget, { sessions: [session()] }),
    );
    expect(calm).toContain("/technicians");
    expect(calm).toContain("No diagnosis needs a human");
    expect(calm).not.toContain("Recommended");
    const stuck = renderToString(
      React.createElement(TechnicianShortcutWidget, {
        sessions: [session({ safety_state: "critical_stop" })],
      }),
    );
    expect(stuck).toContain("Recommended");
    expect(stuck).toContain("Critical stop");
  });

  it("hints at accepted parts and stays quiet without them", () => {
    const empty = renderToString(React.createElement(PartsHintWidget, { hint: null }));
    expect(empty).toContain("No accepted parts yet");
    const html = renderToString(
      React.createElement(PartsHintWidget, {
        hint: {
          sessionId: "11111111-1111-4111-8111-111111111111",
          deviceLabel: "AcmeBook Pro 14",
          acceptedCount: 2,
        },
      }),
    );
    expect(html).toContain("accepted part");
    expect(html).toContain("/diagnostics/11111111-1111-4111-8111-111111111111");
  });

  it("always links the shop workspace and reports honestly", () => {
    const shop = renderToString(React.createElement(ShopShortcutWidget));
    expect(shop).toContain("/shop");
    const none = renderToString(React.createElement(ReportsShortcutWidget, { reportCount: 0 }));
    expect(none).toContain("No reports yet");
    const some = renderToString(React.createElement(ReportsShortcutWidget, { reportCount: 3 }));
    expect(some).toContain("3 reports");
  });

  it("composes every shortcut in one section", () => {
    const html = renderToString(
      React.createElement(ContextualShortcuts, {
        sessions: [session()],
        reportCount: 1,
        partsHint: null,
      }),
    );
    for (const label of [
      "Suggested next steps",
      "New Diagnosis",
      "Find a Technician",
      "Parts Advisor",
      "Shop Workspace",
      "Repair Reports",
    ]) {
      expect(html).toContain(label);
    }
  });
});

describe("own technician profile", () => {
  it("splits comma lists and drops blanks", () => {
    expect(parseCommaList("")).toEqual([]);
    expect(parseCommaList("board repair, , data recovery ")).toEqual([
      "board repair",
      "data recovery",
    ]);
  });

  it("builds a trimmed PUT payload, coordinates together or not at all", () => {
    const payload = profileFormToPayload({
      ...emptyProfileForm(),
      display_name: "  Riley Repairs ",
      city: "Austin",
      region: "TX",
      latitude: "30.27",
      longitude: "",
      specialties: "board repair, , data recovery",
      device_types: "",
    });
    expect(payload.display_name).toBe("Riley Repairs");
    expect(payload.specialties).toEqual(["board repair", "data recovery"]);
    expect(payload.device_types).toEqual([]);
    expect(payload.latitude).toBeNull();
    expect(payload.longitude).toBeNull();
    const geo = profileFormToPayload({
      ...emptyProfileForm(),
      display_name: "R",
      city: "A",
      region: "T",
      latitude: "30.27",
      longitude: "-97.74",
    });
    expect(geo.latitude).toBe(30.27);
    expect(geo.longitude).toBe(-97.74);
  });

  it("round-trips a card through the form", () => {
    const form = cardToForm(card({ latitude: 30.27, longitude: -97.74 }));
    expect(form.display_name).toBe("Riley Repairs");
    expect(form.latitude).toBe("30.27");
    expect(form.specialties).toBe("board repair");
    expect(form.accepting_requests).toBe(true);
  });

  it("renders consent, geo opt-in, and contact-visibility explanations", () => {
    const html = renderToString(
      React.createElement(OwnTechnicianProfileForm, {
        initial: emptyProfileForm(),
        verified: false,
        saving: false,
        error: null,
        notice: null,
        onSubmit: noop,
      }),
    );
    expect(html).toContain("Display name");
    expect(html).toContain("Accept contact requests");
    expect(html).toContain("listing consent");
    expect(html).toContain("never match a radius search");
    expect(html).toContain("only through contact requests");
    expect(html).toContain("managed by FieldFix admins");
  });
});

describe("notification kinds", () => {
  it("gives contact_request and shop kinds their own glyphs", () => {
    for (const kind of ["contact_request", "shop", "shop_invite"]) {
      const html = renderToString(notificationKindIcon(kind));
      expect(html).toContain("<svg");
    }
    const contact = renderToString(notificationKindIcon("contact_request"));
    expect(contact).toContain("text-cyan-300");
    const shop = renderToString(notificationKindIcon("shop_update"));
    expect(shop).toContain("text-amber-300");
  });

  it("keeps existing kinds and the generic fallback", () => {
    expect(renderToString(notificationKindIcon("safety_critical"))).toContain("text-red-300");
    expect(renderToString(notificationKindIcon("announcement"))).toContain("text-cyan-300");
    const fallback = renderToString(notificationKindIcon("something_new"));
    expect(fallback).toContain("<svg");
    expect(fallback).toContain("text-slate-400");
  });
});
