import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Kysely } from "kysely";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { Database, DiagnosticSession } from "../db/database.js";
import { SessionRepository } from "../db/repositories/sessions.js";
import { UsersRepository } from "../db/repositories/users.js";
import { sendError } from "../http/errors.js";
import { resolveUser } from "./user-access.js";

export function issueSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function verifyToken(presented: string, expectedHash: string): boolean {
  let actual: Buffer;
  let expected: Buffer;
  try {
    actual = Buffer.from(hashToken(presented), "hex");
    expected = Buffer.from(expectedHash, "hex");
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Request authenticated to a session via `Authorization: Bearer <token>`. */
export interface SessionRequest extends Request {
  session: DiagnosticSession;
}

const uuidParam = z.string().uuid();

export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) {
    return null;
  }
  const [scheme, value] = header.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || !value) {
    return null;
  }
  return value;
}

/**
 * Load `:id` session and verify its access token. Unknown or malformed
 * ids return 404 (no existence leak); missing/invalid tokens return 403.
 */
export function requireSessionAccess(db: Kysely<Database>) {
  const sessions = new SessionRepository(db);
  return async (req: Request, res: Response, next: NextFunction) => {
    const parsedId = uuidParam.safeParse(req.params.id);
    if (!parsedId.success) {
      sendError(res, 404, "session_not_found", "No such session.");
      return;
    }
    let session: DiagnosticSession | undefined;
    try {
      session = await sessions.getById(parsedId.data);
    } catch (err) {
      next(err);
      return;
    }
    if (!session) {
      sendError(res, 404, "session_not_found", "No such session.");
      return;
    }
    // Suspension locks the account's sessions for everyone, including
    // holders of shareable session tokens, until reinstated.
    if (session.user_id) {
      try {
        const ownerRow = await new UsersRepository(db).getById(session.user_id);
        if (ownerRow && ownerRow.status !== "active") {
          sendError(res, 403, "account_suspended", "This account is suspended or deactivated.");
          return;
        }
      } catch (err) {
        next(err);
        return;
      }
    }
    const token = bearerToken(req);
    if (!token) {
      sendError(
        res,
        403,
        "forbidden",
        "Session access token required (Authorization: Bearer).",
      );
      return;
    }
    // Owners may use their login token instead of the session token,
    // unless their account is suspended (then only the session token works).
    if (session.user_id) {
      try {
        const owner = await resolveUser(db, req);
        if (owner && owner.id === session.user_id && owner.status === "active") {
          (req as SessionRequest).session = session;
          next();
          return;
        }
      } catch (err) {
        next(err);
        return;
      }
    }
    if (!verifyToken(token, session.access_token_hash)) {
      sendError(res, 403, "forbidden", "Invalid session access token.");
      return;
    }
    (req as SessionRequest).session = session;
    next();
  };
}
