import type { Application } from "express";
import type { Kysely } from "kysely";
import { generateSync } from "otplib";
import request from "supertest";
import type { Database, UserRole } from "../../src/db/database.js";
import { UsersRepository } from "../../src/db/repositories/users.js";
import { testEmailOutbox } from "../../src/email/resend.js";

export function adminBearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function fail(step: string, res: request.Response): never {
  throw new Error(`${step} failed: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
}

/** Register + confirm a user over HTTP; returns the login session token. */
export async function registerConfirmedSession(
  app: Application,
  email: string,
  name = "Admin User",
): Promise<{ id: string; token: string }> {
  const reg = await request(app)
    .post("/api/v1/auth/register")
    .send({ name, email, password: "admin-pass-01" });
  if (reg.status !== 201) {
    fail("register", reg);
  }
  const found = [...testEmailOutbox]
    .reverse()
    .find((mail) => mail.to === email.toLowerCase() && mail.text.includes("/verify-email"));
  const match = found?.text.match(/[?&]token=([0-9a-f]+)/);
  if (!match?.[1]) {
    throw new Error("confirmation email not found in test outbox");
  }
  const verify = await request(app).post("/api/v1/auth/verify-email").send({ token: match[1] });
  if (verify.status !== 200) {
    fail("verify-email", verify);
  }
  return { id: verify.body.user.id as string, token: verify.body.token as string };
}

/**
 * Login session for a user with the given role. Super admins complete
 * TOTP enrollment since console access requires verified MFA for them.
 */
export async function sessionWithRole(
  app: Application,
  db: Kysely<Database>,
  email: string,
  role: UserRole,
): Promise<{ id: string; token: string }> {
  const account = await registerConfirmedSession(app, email);
  await new UsersRepository(db).updateRole(account.id, role);
  if (role === "super_admin") {
    const enroll = await request(app)
      .post("/api/v1/auth/mfa/enroll")
      .set(adminBearer(account.token));
    if (enroll.status !== 200) {
      fail("mfa enroll", enroll);
    }
    const verify = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .set(adminBearer(account.token))
      .send({ code: generateSync({ secret: enroll.body.secret as string }) });
    if (verify.status !== 200) {
      fail("mfa verify", verify);
    }
  }
  return account;
}
