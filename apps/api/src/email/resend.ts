import {
  confirmationTemplate,
  diagnosticReportTemplate,
  mfaEnabledTemplate,
  passwordChangedTemplate,
  passwordResetTemplate,
  type ReportEmailInput,
} from "./templates.js";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailServiceConfig {
  resendApiKey?: string;
  from: string;
  testMode: boolean;
}

/**
 * In-memory outbox, populated only when `testMode` is set. Integration
 * tests read links/tokens from here instead of the network; production
 * never exposes it.
 */
export const testEmailOutbox: OutgoingEmail[] = [];

export function clearTestEmailOutbox(): void {
  testEmailOutbox.length = 0;
}

/**
 * Minimal Resend client (plain HTTPS, no SDK). Without a key the
 * service runs in log-only mode: links are returned to the caller and
 * logged, so local development works with no email provider.
 */
export class EmailService {
  constructor(private readonly config: EmailServiceConfig) {}

  get live(): boolean {
    return this.config.resendApiKey != null && this.config.resendApiKey.length > 0;
  }

  async sendConfirmation(to: string, name: string, link: string): Promise<void> {
    await this.send({ to, ...confirmationTemplate(name, link) });
  }

  async sendPasswordReset(to: string, name: string, link: string): Promise<void> {
    await this.send({ to, ...passwordResetTemplate(name, link) });
  }

  async sendPasswordChanged(to: string, name: string, loginUrl: string): Promise<void> {
    await this.send({ to, ...passwordChangedTemplate(name, loginUrl) });
  }

  async sendMfaEnabled(to: string, name: string, securityUrl: string): Promise<void> {
    await this.send({ to, ...mfaEnabledTemplate(name, securityUrl) });
  }

  async sendReportCopy(to: string, input: ReportEmailInput): Promise<void> {
    await this.send({ to, ...diagnosticReportTemplate(input) });
  }

  private async send(email: OutgoingEmail): Promise<void> {
    if (this.config.testMode) {
      testEmailOutbox.push(email);
      return;
    }
    const key = this.config.resendApiKey;
    if (!key) {
      console.info(`[email:log-only] to=${email.to} subject=${email.subject}\n${email.text}`);
      return;
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.config.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend send failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
    }
  }
}
