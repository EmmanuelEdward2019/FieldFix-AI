/**
 * Branded transactional email templates. Table-based layout with inline
 * styles only (email-client safe: no flexbox, grid, or external CSS).
 * Every template ships a plain-text twin; nothing here invents data —
 * callers pass only values the backend already holds.
 */

export const SUPPORT_EMAIL = "info@fieldfix.ai";
export const SUPPORT_PHONE = "+2348062609302";

export interface BuiltTemplate {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

interface LayoutInput {
  preheader: string;
  heading: string;
  intro: string;
  bodyHtml: string;
  cta?: { label: string; url: string };
  fallbackNote?: string;
}

function layout({ preheader, heading, intro, bodyHtml, cta, fallbackNote }: LayoutInput): string {
  const ctaHtml = cta
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 24px 0 8px 0;">
        <tr>
          <td align="center" bgcolor="#0891b2" style="border-radius: 6px;">
            <a href="${escapeHtml(cta.url)}" style="display: inline-block; padding: 12px 28px; font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-weight: bold; color: #ffffff; text-decoration: none;">${escapeHtml(cta.label)}</a>
          </td>
        </tr>
      </table>
      <p style="margin: 0 0 16px 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.6; color: #64748b;">Or paste this link into your browser:<br /><a href="${escapeHtml(cta.url)}" style="color: #0891b2; word-break: break-all;">${escapeHtml(cta.url)}</a></p>`
    : "";
  const noteHtml = fallbackNote
    ? `<p style="margin: 16px 0 0 0; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.6; color: #475569;">${escapeHtml(fallbackNote)}</p>`
    : "";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9;">
<div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(preheader)}</div>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f1f5f9; padding: 24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden;">
        <tr>
          <td style="padding: 20px 28px; border-bottom: 3px solid #22d3ee;">
            <span style="display: inline-block; width: 12px; height: 12px; border-radius: 3px; background-color: #22d3ee; margin-right: 8px;"></span><span style="font-family: Arial, Helvetica, sans-serif; font-size: 20px; font-weight: bold; color: #0f172a;">FieldFix AI</span>
            <div style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #64748b; margin-top: 2px;">Evidence-driven troubleshooting</div>
          </td>
        </tr>
        <tr>
          <td style="padding: 28px;">
            <h1 style="margin: 0 0 12px 0; font-family: Arial, Helvetica, sans-serif; font-size: 22px; line-height: 1.3; color: #0f172a;">${escapeHtml(heading)}</h1>
            <p style="margin: 0 0 16px 0; font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.6; color: #334155;">${escapeHtml(intro)}</p>
            ${bodyHtml}
            ${ctaHtml}
            ${noteHtml}
          </td>
        </tr>
        <tr>
          <td style="padding: 20px 28px; background-color: #f8fafc; border-top: 1px solid #e2e8f0;">
            <p style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.7; color: #64748b;">Need help? Reply to this email or reach us at<br /><a href="mailto:${SUPPORT_EMAIL}" style="color: #0891b2;">${SUPPORT_EMAIL}</a> · <a href="tel:${SUPPORT_PHONE}" style="color: #0891b2;">${SUPPORT_PHONE}</a></p>
            <p style="margin: 8px 0 0 0; font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #94a3b8;">FieldFix AI · evidence-driven troubleshooting</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function bulletList(items: string[]): string {
  if (items.length === 0) {
    return "";
  }
  const rows = items
    .map(
      (item) =>
        `<li style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; color: #334155; margin-bottom: 6px;">${escapeHtml(item)}</li>`,
    )
    .join("");
  return `<ul style="margin: 0 0 16px 0; padding-left: 20px;">${rows}</ul>`;
}

function sectionTitle(title: string): string {
  return `<h2 style="margin: 20px 0 8px 0; font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #0f172a;">${escapeHtml(title)}</h2>`;
}

function textFooter(): string {
  return `Need help? ${SUPPORT_EMAIL} · ${SUPPORT_PHONE}\nFieldFix AI · evidence-driven troubleshooting`;
}

export function confirmationTemplate(name: string, link: string): BuiltTemplate {
  return {
    subject: "Confirm your FieldFix AI account",
    text: [
      `Hi ${name},`,
      "",
      "Welcome to FieldFix AI. Confirm your account by opening this link (expires in 24 hours):",
      link,
      "",
      "If you didn't create this account, ignore this email.",
      "",
      textFooter(),
    ].join("\n"),
    html: layout({
      preheader: "One click confirms your FieldFix AI account.",
      heading: `Welcome, ${name}`,
      intro: "Confirm your account to start diagnosing devices. This link expires in 24 hours.",
      bodyHtml: "",
      cta: { label: "Confirm my account", url: link },
      fallbackNote: "If you didn't create this account, you can safely ignore this email.",
    }),
  };
}

export function passwordResetTemplate(name: string, link: string): BuiltTemplate {
  return {
    subject: "Reset your FieldFix AI password",
    text: [
      `Hi ${name},`,
      "",
      "Reset your password with this link (expires in 1 hour, single use):",
      link,
      "",
      "If you didn't request this, ignore this email — your password stays unchanged.",
      "",
      textFooter(),
    ].join("\n"),
    html: layout({
      preheader: "Reset your password — link expires in 1 hour.",
      heading: "Reset your password",
      intro: "Use the button below to choose a new password. The link expires in 1 hour and works once.",
      bodyHtml: "",
      cta: { label: "Reset my password", url: link },
      fallbackNote: "If you didn't request this, ignore this email — your password stays unchanged.",
    }),
  };
}

export function passwordChangedTemplate(name: string, loginUrl: string): BuiltTemplate {
  return {
    subject: "Your FieldFix AI password was changed",
    text: [
      `Hi ${name},`,
      "",
      "Your password was just changed. If this was you, nothing else is needed.",
      "",
      "If this wasn't you, reset your password immediately:",
      loginUrl,
      "",
      textFooter(),
    ].join("\n"),
    html: layout({
      preheader: "Your password was just changed.",
      heading: "Password changed",
      intro: "Your FieldFix AI password was just changed. If this was you, nothing else is needed.",
      bodyHtml: "",
      cta: { label: "Sign in", url: loginUrl },
      fallbackNote: "If this wasn't you, reset your password immediately and contact us.",
    }),
  };
}

export function mfaEnabledTemplate(name: string, securityUrl: string): BuiltTemplate {
  return {
    subject: "Two-factor authentication is now on",
    text: [
      `Hi ${name},`,
      "",
      "Two-factor authentication is now protecting your FieldFix AI account. You'll enter a code from your authenticator app each time you sign in.",
      "",
      "Keep your backup codes somewhere safe — they are shown once and never emailed.",
      "",
      "Manage your security settings:",
      securityUrl,
      "",
      "If this wasn't you, contact us right away.",
      "",
      textFooter(),
    ].join("\n"),
    html: layout({
      preheader: "Two-factor authentication is now protecting your account.",
      heading: "Two-factor is on",
      intro:
        "Two-factor authentication is now protecting your account. Keep your backup codes somewhere safe — they are shown once and never emailed.",
      bodyHtml: "",
      cta: { label: "Review security settings", url: securityUrl },
      fallbackNote: "If this wasn't you, contact us right away.",
    }),
  };
}

export interface ReportEmailInput {
  name: string;
  deviceLabel: string;
  symptoms: string;
  hypotheses: { title: string; status: string; confidence: string }[];
  testsPerformed: { name: string; result: string | null }[];
  nextSteps: string[];
  reportUrl: string;
}

export function diagnosticReportTemplate(input: ReportEmailInput): BuiltTemplate {
  const hypothesisLines = input.hypotheses.map(
    (h) => `• ${h.title} — ${h.status.replace(/_/g, " ")} (${h.confidence} confidence)`,
  );
  const testLines = input.testsPerformed.map((t) =>
    t.result ? `• ${t.name}: ${t.result}` : `• ${t.name} (no result recorded)`,
  );
  const text = [
    `Hi ${input.name},`,
    "",
    `Your diagnostic report for ${input.deviceLabel} is ready.`,
    `Reported symptoms: ${input.symptoms}`,
    "",
    ...(hypothesisLines.length > 0 ? ["Fault hypotheses:", ...hypothesisLines, ""] : []),
    ...(testLines.length > 0 ? ["Tests performed:", ...testLines, ""] : []),
    ...(input.nextSteps.length > 0 ? ["Recommended next steps:", ...input.nextSteps.map((s) => `• ${s}`), ""] : []),
    "Open the full report:",
    input.reportUrl,
    "",
    textFooter(),
  ].join("\n");

  const hypothesesHtml =
    input.hypotheses.length > 0
      ? sectionTitle("Fault hypotheses") +
        bulletList(
          input.hypotheses.map((h) => `${h.title} — ${h.status.replace(/_/g, " ")} (${h.confidence} confidence)`),
        )
      : "";
  const testsHtml =
    input.testsPerformed.length > 0
      ? sectionTitle("Tests performed") +
        bulletList(
          input.testsPerformed.map((t) => (t.result ? `${t.name}: ${t.result}` : `${t.name} (no result recorded)`)),
        )
      : "";
  const stepsHtml =
    input.nextSteps.length > 0 ? sectionTitle("Recommended next steps") + bulletList(input.nextSteps) : "";

  return {
    subject: `Your ${input.deviceLabel} diagnostic report is ready`,
    text,
    html: layout({
      preheader: `Your ${input.deviceLabel} diagnostic report is ready.`,
      heading: "Your diagnostic report is ready",
      intro: `${input.deviceLabel} — reported symptoms: ${input.symptoms}`,
      bodyHtml: `${hypothesesHtml}${testsHtml}${stepsHtml}`,
      cta: { label: "Open full report", url: input.reportUrl },
    }),
  };
}
