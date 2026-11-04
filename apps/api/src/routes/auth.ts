import { randomBytes } from "node:crypto";
import type { Kysely } from "kysely";
import express, { type Request, type Response } from "express";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaChallengeSchema,
  mfaCodeSchema,
  registerSchema,
  resendConfirmationSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from "@fieldfix/contracts";
import type { Database } from "../db/database.js";
import {
  UserEmailTokensRepository,
  UserSessionsRepository,
  UsersRepository,
  type EmailTokenKind,
} from "../db/repositories/users.js";
import { MfaRepository } from "../db/repositories/mfa.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { decryptSecret, encryptSecret, parseMfaKey } from "../auth/mfa-crypto.js";
import { generateTotpSecret, totpKeyUri, verifyTotp } from "../auth/totp.js";
import { bearerToken } from "../auth/session-access.js";
import { hashUserToken, requireUser, type UserRequest } from "../auth/user-access.js";
import { AuditLogRepository } from "../db/repositories/audit.js";
import { NotificationRepository } from "../db/repositories/notifications.js";
import type { User } from "../db/database.js";
import { EmailService } from "../email/resend.js";
import type { AppEnv } from "../env.js";
import { sendError } from "../http/errors.js";
import { PostgresRateLimitStore, rateLimit } from "../http/rate-limit.js";
import {
  toAuthResponse,
  toMfaStatusResponse,
  toRegisterResponse,
  toUserResponse,
} from "./serializers.js";

export interface AuthRouterDeps {
  db: Kysely<Database>;
  env: AppEnv;
}

/** Login sessions last 30 days. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Email-confirmation links last 24 hours; reset links 1 hour. */
const CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
/** MFA challenge tokens last 5 minutes and are single-use. */
const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MFA_BACKUP_CODE_COUNT = 10;

/**
 * Constant dummy hash so unknown-email logins cost the same scrypt
 * verification as real ones (no account-enumeration timing signal).
 */
const DUMMY_HASH =
  "scrypt$16384$8$1$3c952863326f2e9639c2769869a6e9ab$9fe183adafd711a641bba67399a07afdec0dd472542893a21f7e2997ae858ece8aee4ebe46e00bec98e2ed17deb28d241d0dbeff88e2ffe0f3c91236baf453ff";

function issueToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashUserToken(token) };
}

export function createAuthRouter(deps: AuthRouterDeps) {
  const { db, env } = deps;
  const router = express.Router();
  // Stricter than the global limiter: credential-stuffing resistance.
  // Shared counters so the budget survives across API processes.
  router.use(
    rateLimit({
      maxRequests: 60,
      windowMs: 15 * 60 * 1000,
      scope: "auth",
      store: new PostgresRateLimitStore(db),
    }),
  );
  const users = new UsersRepository(db);
  const sessions = new UserSessionsRepository(db);
  const emailTokens = new UserEmailTokensRepository(db);
  const notifications = new NotificationRepository(db);
  const audit = new AuditLogRepository(db);
  const mfa = new MfaRepository(db);
  const mfaKey = parseMfaKey(env.MFA_ENCRYPTION_KEY);

  /** Backup codes are compared in normalized form (no dashes, lowercase). */
  const normalizeBackupCode = (code: string): string =>
    code.replace(/[^a-z0-9]/gi, "").toLowerCase();

  const issueBackupCodes = async (userId: string): Promise<string[]> => {
    const codes: string[] = [];
    const hashes: string[] = [];
    for (let i = 0; i < MFA_BACKUP_CODE_COUNT; i += 1) {
      const raw = randomBytes(5).toString("hex");
      codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
      hashes.push(await hashPassword(raw));
    }
    await mfa.replaceBackupCodes(userId, hashes);
    return codes;
  };

  /** True when the code matches an unused backup code; burns it. */
  const consumeBackupCode = async (userId: string, code: string): Promise<boolean> => {
    const normalized = normalizeBackupCode(code);
    if (normalized.length !== 10) {
      return false;
    }
    const candidates = await mfa.unusedBackupCodeHashes(userId);
    for (const candidate of candidates) {
      if (await verifyPassword(normalized, candidate.code_hash)) {
        await mfa.markBackupCodeUsed(candidate.id);
        return true;
      }
    }
    return false;
  };

  const superAdminEmails = (env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);

  /** Bootstrap: listed emails self-promote to super_admin on sign-in. */
  const maybePromote = async (user: User, req: Request): Promise<User> => {
    if (user.role === "super_admin" || !superAdminEmails.includes(user.email.toLowerCase())) {
      return user;
    }
    const promoted = await users.updateRole(user.id, "super_admin");
    if (promoted) {
      await audit.append(
        { actorType: "user", actorId: user.id, actorEmail: user.email },
        req,
        {
          action: "user.role.bootstrap",
          targetType: "user",
          targetId: user.id,
          metadata: { from: user.role, to: "super_admin" },
        },
      );
      return promoted;
    }
    return user;
  };
  const email = new EmailService({
    resendApiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    testMode: env.NODE_ENV === "test",
  });

  const issueEmailToken = async (
    userId: string,
    kind: EmailTokenKind,
    ttlMs: number,
  ): Promise<string> => {
    await emailTokens.revokeOutstanding(userId, kind);
    const { token, hash } = issueToken();
    await emailTokens.create(userId, kind, hash, new Date(Date.now() + ttlMs));
    return token;
  };

  router.post("/register", async (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "Name, a valid email, and a password (8+ chars) are required.");
      return;
    }
    const existing = await users.getByEmail(parsed.data.email);
    if (existing) {
      sendError(res, 409, "email_taken", "An account with this email already exists.");
      return;
    }
    const created = await users.create({
      name: parsed.data.name,
      email: parsed.data.email,
      password_hash: await hashPassword(parsed.data.password),
    });
    await notifications
      .record({
        kind: "registration",
        title: `New user: ${created.name}`,
        body: `${created.email} registered and is awaiting email confirmation.`,
        link: "/admin/users",
      })
      .catch(() => undefined);
    const token = await issueEmailToken(created.id, "email_confirmation", CONFIRM_TTL_MS);
    const link = `${env.APP_BASE_URL}/verify-email?token=${token}`;
    // Registration succeeds even if the mail provider is down; the
    // link can be re-requested from the login page.
    await email.sendConfirmation(created.email, created.name, link).catch((err: unknown) => {
      console.error(`[email] confirmation send failed for ${created.email}:`, err);
    });
    res.status(201).json(toRegisterResponse(created));
  });

  router.post("/login", async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "Email and password are required.");
      return;
    }
    const user = await users.getByEmail(parsed.data.email);
    const ok = await verifyPassword(parsed.data.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) {
      sendError(res, 401, "invalid_credentials", "Email or password is incorrect.");
      return;
    }
    if (!user.email_confirmed_at) {
      sendError(
        res,
        403,
        "email_unconfirmed",
        "Check your email for the confirmation link before signing in.",
      );
      return;
    }
    if (user.status !== "active") {
      sendError(res, 403, "account_suspended", "This account is suspended or deactivated.");
      return;
    }
    if (await mfa.isVerified(user.id)) {
      // Password OK, second factor still required: no session is issued
      // until the challenge below succeeds. Promotion waits too, so the
      // bootstrap audit entry is tied to the completed sign-in.
      const { token: mfaToken, hash: mfaHash } = issueToken();
      await mfa.createChallenge(
        user.id,
        mfaHash,
        new Date(Date.now() + MFA_CHALLENGE_TTL_MS),
      );
      res.json({ mfa_required: true as const, mfa_token: mfaToken });
      return;
    }
    const effective = await maybePromote(user, req);
    const { token, hash } = issueToken();
    const record = await sessions.create(user.id, hash, new Date(Date.now() + SESSION_TTL_MS));
    await users.updateLastLogin(user.id);
    res.json(toAuthResponse(effective, token, record.expires_at));
  });

  router.post("/verify-email", async (req: Request, res: Response) => {
    const parsed = verifyEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "A confirmation token is required.");
      return;
    }
    const consumed = await emailTokens.consume("email_confirmation", hashUserToken(parsed.data.token));
    if (!consumed) {
      sendError(res, 400, "invalid_or_expired", "This link is invalid, expired, or already used.");
      return;
    }
    const confirmed = await users.markEmailConfirmed(consumed.user_id);
    if (!confirmed) {
      sendError(res, 404, "not_found", "Account no longer exists.");
      return;
    }
    // Verifying the link proves email ownership: sign the user in.
    const effective = await maybePromote(confirmed, req);
    const { token, hash } = issueToken();
    const record = await sessions.create(
      confirmed.id,
      hash,
      new Date(Date.now() + SESSION_TTL_MS),
    );
    await users.updateLastLogin(confirmed.id);
    res.json(toAuthResponse(effective, token, record.expires_at));
  });

  router.post("/verify-email/resend", async (req: Request, res: Response) => {
    const parsed = resendConfirmationSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "A valid email is required.");
      return;
    }
    // Uniform response: never reveal whether the email is registered.
    const user = await users.getByEmail(parsed.data.email);
    if (user && !user.email_confirmed_at) {
      const token = await issueEmailToken(user.id, "email_confirmation", CONFIRM_TTL_MS);
      const link = `${env.APP_BASE_URL}/verify-email?token=${token}`;
      await email.sendConfirmation(user.email, user.name, link).catch((err: unknown) => {
        console.error(`[email] confirmation resend failed for ${user.email}:`, err);
      });
    }
    res.json({ ok: true });
  });

  router.post("/password/forgot", async (req: Request, res: Response) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "A valid email is required.");
      return;
    }
    // Uniform response: never reveal whether the email is registered.
    const user = await users.getByEmail(parsed.data.email);
    if (user) {
      const token = await issueEmailToken(user.id, "password_reset", RESET_TTL_MS);
      const link = `${env.APP_BASE_URL}/reset-password?token=${token}`;
      await email.sendPasswordReset(user.email, user.name, link).catch((err: unknown) => {
        console.error(`[email] reset send failed for ${user.email}:`, err);
      });
    }
    res.json({ ok: true });
  });

  router.post("/password/reset", async (req: Request, res: Response) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "A reset token and a new password (8+ chars) are required.");
      return;
    }
    const consumed = await emailTokens.consume("password_reset", hashUserToken(parsed.data.token));
    if (!consumed) {
      sendError(res, 400, "invalid_or_expired", "This link is invalid, expired, or already used.");
      return;
    }
    await users.updatePasswordHash(consumed.user_id, await hashPassword(parsed.data.new_password));
    await sessions.deleteAllForUser(consumed.user_id);
    const changed = await users.getById(consumed.user_id);
    if (changed) {
      await email
        .sendPasswordChanged(changed.email, changed.name, `${env.APP_BASE_URL}/login`)
        .catch((err: unknown) => {
          console.error(`[email] password-changed send failed for ${changed.email}:`, err);
        });
    }
    res.status(204).end();
  });

  router.get("/mfa/status", requireUser(db), async (req: Request, res: Response) => {
    const { user } = req as UserRequest;
    res.json(toMfaStatusResponse(await mfa.get(user.id)));
  });

  router.post("/mfa/enroll", requireUser(db), async (req: Request, res: Response) => {
    const { user } = req as UserRequest;
    if (!mfaKey) {
      sendError(
        res,
        503,
        "mfa_unavailable",
        "Two-factor enrollment is not configured on this server.",
      );
      return;
    }
    const existing = await mfa.get(user.id);
    if (existing?.verified_at != null) {
      sendError(res, 409, "mfa_already_enabled", "Two-factor is already enabled.");
      return;
    }
    const secret = generateTotpSecret();
    await mfa.savePending(user.id, encryptSecret(mfaKey, secret));
    await audit.append(
      { actorType: "user", actorId: user.id, actorEmail: user.email },
      req,
      { action: "mfa.enroll_started", targetType: "user", targetId: user.id },
    );
    res.json({ otpauth_url: totpKeyUri(user.email, secret), secret });
  });

  router.post("/mfa/verify", requireUser(db), async (req: Request, res: Response) => {
    const parsed = mfaCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "A 6-digit code is required.");
      return;
    }
    const { user } = req as UserRequest;
    const row = await mfa.get(user.id);
    if (!row || !mfaKey) {
      sendError(
        res,
        400,
        "mfa_not_enrolled",
        "Enroll a device before verifying a code.",
      );
      return;
    }
    let secret: string;
    try {
      secret = decryptSecret(mfaKey, row.secret_enc);
    } catch {
      sendError(res, 503, "mfa_unavailable", "Two-factor verification is unavailable.");
      return;
    }
    if (!verifyTotp(secret, parsed.data.code)) {
      sendError(res, 401, "invalid_code", "That code is incorrect or expired.");
      return;
    }
    if (row.verified_at == null) {
      await mfa.markVerified(user.id);
      const backupCodes = await issueBackupCodes(user.id);
      await audit.append(
        { actorType: "user", actorId: user.id, actorEmail: user.email },
        req,
        { action: "mfa.enabled", targetType: "user", targetId: user.id },
      );
      await email
        .sendMfaEnabled(user.email, user.name, `${env.APP_BASE_URL}/profile#security`)
        .catch((err: unknown) => {
          console.error(`[email] mfa-enabled send failed for ${user.email}:`, err);
        });
      res.json({ verified: true as const, backup_codes: backupCodes });
      return;
    }
    res.json({ verified: true as const });
  });

  router.post("/mfa/disable", requireUser(db), async (req: Request, res: Response) => {
    const parsed = mfaCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "A code is required to disable two-factor.");
      return;
    }
    const { user } = req as UserRequest;
    const row = await mfa.get(user.id);
    if (!row || !mfaKey) {
      sendError(res, 400, "mfa_not_enrolled", "Two-factor is not enabled.");
      return;
    }
    let secret: string | null = null;
    try {
      secret = decryptSecret(mfaKey, row.secret_enc);
    } catch {
      secret = null;
    }
    const totpOk = secret != null && verifyTotp(secret, parsed.data.code);
    if (!totpOk && !(await consumeBackupCode(user.id, parsed.data.code))) {
      sendError(res, 401, "invalid_code", "That code is incorrect or expired.");
      return;
    }
    await mfa.remove(user.id);
    await audit.append(
      { actorType: "user", actorId: user.id, actorEmail: user.email },
      req,
      { action: "mfa.disabled", targetType: "user", targetId: user.id },
    );
    res.json({ disabled: true as const });
  });

  router.post("/mfa/challenge", async (req: Request, res: Response) => {
    const parsed = mfaChallengeSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "A challenge token and code are required.");
      return;
    }
    const challenge = await mfa.findChallenge(hashUserToken(parsed.data.mfa_token));
    if (!challenge) {
      sendError(res, 401, "invalid_challenge", "This challenge is invalid or expired.");
      return;
    }
    const user = await users.getById(challenge.user_id);
    if (!user || user.status !== "active") {
      sendError(res, 403, "account_suspended", "This account is suspended or deactivated.");
      return;
    }
    const row = await mfa.get(user.id);
    let secret: string | null = null;
    if (row?.verified_at != null && mfaKey) {
      try {
        secret = decryptSecret(mfaKey, row.secret_enc);
      } catch {
        secret = null;
      }
    }
    const totpOk = secret != null && verifyTotp(secret, parsed.data.code);
    const actor = { actorType: "user" as const, actorId: user.id, actorEmail: user.email };
    if (!totpOk && !(await consumeBackupCode(user.id, parsed.data.code))) {
      await audit.append(actor, req, {
        action: "mfa.challenge_failed",
        targetType: "user",
        targetId: user.id,
      });
      sendError(res, 401, "invalid_code", "That code is incorrect or expired.");
      return;
    }
    const consumed = await mfa.consumeChallenge(challenge.token_hash);
    if (!consumed) {
      sendError(res, 401, "invalid_challenge", "This challenge is invalid or expired.");
      return;
    }
    const effective = await maybePromote(user, req);
    const { token, hash } = issueToken();
    const record = await sessions.create(user.id, hash, new Date(Date.now() + SESSION_TTL_MS));
    await users.updateLastLogin(user.id);
    await audit.append(actor, req, {
      action: "mfa.challenge_succeeded",
      targetType: "user",
      targetId: user.id,
    });
    res.json(toAuthResponse(effective, token, record.expires_at));
  });

  router.post("/logout", requireUser(db), async (req: Request, res: Response) => {
    const token = bearerToken(req);
    if (token) {
      await sessions.deleteByTokenHash(hashUserToken(token));
    }
    res.status(204).end();
  });

  router.post("/logout-all", requireUser(db), async (req: Request, res: Response) => {
    const { user } = req as UserRequest;
    await sessions.deleteAllForUser(user.id);
    res.status(204).end();
  });

  router.get("/me", requireUser(db), (req: Request, res: Response) => {
    const { user } = req as UserRequest;
    res.json({ user: toUserResponse(user) });
  });

  router.patch("/me", requireUser(db), async (req: Request, res: Response) => {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "A name (1-120 chars) is required.");
      return;
    }
    const { user } = req as UserRequest;
    const updated = await users.updateName(user.id, parsed.data.name);
    if (!updated) {
      sendError(res, 404, "not_found", "Account no longer exists.");
      return;
    }
    res.json({ user: toUserResponse(updated) });
  });

  router.post("/password", requireUser(db), async (req: Request, res: Response) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "Current password and a new password (8+ chars) are required.");
      return;
    }
    const { user } = req as UserRequest;
    const fresh = await users.getById(user.id);
    if (!fresh || !(await verifyPassword(parsed.data.current_password, fresh.password_hash))) {
      sendError(res, 403, "invalid_credentials", "Current password is incorrect.");
      return;
    }
    await users.updatePasswordHash(user.id, await hashPassword(parsed.data.new_password));
    await sessions.deleteAllForUser(user.id);
    res.status(204).end();
  });

  return router;
}
