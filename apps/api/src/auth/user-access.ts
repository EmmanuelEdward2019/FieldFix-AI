import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import type { NextFunction, Request, Response } from "express";
import type { Database, User } from "../db/database.js";
import { UserSessionsRepository, UsersRepository } from "../db/repositories/users.js";
import { sendError } from "../http/errors.js";
import { bearerToken } from "./session-access.js";

/** Request authenticated to a user account via `Authorization: Bearer <token>`. */
export interface UserRequest extends Request {
  user: User;
}

export function hashUserToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Resolve the request's user from a login token. Returns null for
 * missing, unknown, or expired tokens (callers decide the status).
 */
export async function resolveUser(
  db: Kysely<Database>,
  req: Request,
): Promise<User | null> {
  const token = bearerToken(req);
  if (!token) {
    return null;
  }
  const record = await new UserSessionsRepository(db).getByTokenHash(hashUserToken(token));
  if (!record) {
    return null;
  }
  if (new Date(record.expires_at).getTime() <= Date.now()) {
    await new UserSessionsRepository(db).deleteByTokenHash(record.token_hash).catch(() => undefined);
    return null;
  }
  const user = await new UsersRepository(db).getById(record.user_id);
  return user ?? null;
}

/** Require a valid login token for an active account; attaches `req.user`. */
export function requireUser(db: Kysely<Database>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    let user: User | null;
    try {
      user = await resolveUser(db, req);
    } catch (err) {
      next(err);
      return;
    }
    if (!user) {
      sendError(res, 401, "unauthorized", "Sign in to access this resource.");
      return;
    }
    if (user.status !== "active") {
      sendError(res, 403, "account_suspended", "This account is suspended or deactivated.");
      return;
    }
    (req as UserRequest).user = user;
    next();
  };
}
