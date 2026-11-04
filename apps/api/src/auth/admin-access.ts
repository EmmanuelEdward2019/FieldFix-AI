import type { Kysely } from "kysely";
import type { NextFunction, Request, Response } from "express";
import type { Database, User, UserRole } from "../db/database.js";
import { sendError } from "../http/errors.js";
import { bearerToken } from "./session-access.js";
import { hashUserToken } from "./user-access.js";
import { UserSessionsRepository, UsersRepository } from "../db/repositories/users.js";
import { MfaRepository } from "../db/repositories/mfa.js";

/**
 * Capability-based RBAC. Roles map to capability sets; adding a future
 * role means adding one entry here — no route changes required.
 */
export const CAPABILITIES = [
  "overview:view",
  "users:view",
  "users:manage",
  "roles:manage",
  "sessions:view",
  "evidence:view",
  "ai:view",
  "ai:manage",
  "documents:view",
  "documents:manage",
  "safety:view",
  "safety:manage",
  "notifications:view",
  "notifications:manage",
  "health:view",
  "audit:view",
  "settings:view",
  "settings:manage",
  "suppliers:view",
  "suppliers:manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ALL: Capability[] = [...CAPABILITIES];

const ROLE_CAPABILITIES: Record<UserRole, Capability[]> = {
  super_admin: ALL,
  admin: [
    "overview:view",
    "users:view",
    "users:manage",
    "sessions:view",
    "evidence:view",
    "ai:view",
    "documents:view",
    "documents:manage",
    "safety:view",
    "safety:manage",
    "notifications:view",
    "notifications:manage",
    "health:view",
    "audit:view",
    "settings:view",
    "suppliers:view",
    "suppliers:manage",
  ],
  operator: [
    "overview:view",
    "users:view",
    "sessions:view",
    "evidence:view",
    "ai:view",
    "documents:view",
    "safety:view",
    "notifications:view",
    "health:view",
    "suppliers:view",
  ],
  technician: [],
};

export function capabilitiesFor(role: UserRole): Capability[] {
  return ROLE_CAPABILITIES[role] ?? [];
}

export function hasCapability(role: UserRole, capability: Capability): boolean {
  return capabilitiesFor(role).includes(capability);
}

export interface AdminActor {
  actorType: "user";
  actorId: string | null;
  actorEmail: string | null;
  role: UserRole;
  capabilities: Capability[];
  user: User | null;
}

export interface AdminRequest extends Request {
  admin: AdminActor;
}

async function resolveAdminUser(
  db: Kysely<Database>,
  token: string,
): Promise<User | null> {
  const record = await new UserSessionsRepository(db).getByTokenHash(hashUserToken(token));
  if (!record) {
    return null;
  }
  if (new Date(record.expires_at).getTime() <= Date.now()) {
    await new UserSessionsRepository(db).deleteByTokenHash(record.token_hash).catch(() => undefined);
    return null;
  }
  return (await new UsersRepository(db).getById(record.user_id)) ?? null;
}

/**
 * Require one capability. Accepts a user login token only: the account
 * must be active and its role must grant the capability.
 * Suspended/deactivated accounts are rejected even with valid tokens.
 * Bootstrap the first Super Admin via SUPER_ADMIN_EMAILS (auto-promotion
 * on login), then assign further roles from the console.
 */
export function requireCapability(db: Kysely<Database>, capability: Capability) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const presented = bearerToken(req);
    if (!presented) {
      sendError(res, 403, "forbidden", "Admin access required.");
      return;
    }
    try {
      const user = await resolveAdminUser(db, presented);
      if (!user) {
        sendError(res, 403, "forbidden", "Admin access required.");
        return;
      }
      if (user.status !== "active") {
        sendError(res, 403, "account_suspended", "This account is suspended or deactivated.");
        return;
      }
      if (user.role === "super_admin" && !(await new MfaRepository(db).isVerified(user.id))) {
        sendError(
          res,
          403,
          "mfa_required",
          "Super Admin accounts must enable two-factor authentication first (Profile → Security).",
        );
        return;
      }
      if (!hasCapability(user.role, capability)) {
        sendError(res, 403, "forbidden", "This action requires additional permissions.");
        return;
      }
      (req as AdminRequest).admin = {
        actorType: "user",
        actorId: user.id,
        actorEmail: user.email,
        role: user.role,
        capabilities: capabilitiesFor(user.role),
        user,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
