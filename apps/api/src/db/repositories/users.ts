import { sql } from "kysely";
import type {
  Db,
  NewUser,
  User,
  UserEmailToken,
  UserSession,
} from "../database.js";

export class UsersRepository {
  constructor(private readonly db: Db) {}

  async create(input: NewUser): Promise<User> {
    return this.db
      .insertInto("users")
      .values(input)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getById(id: string): Promise<User | undefined> {
    return this.db
      .selectFrom("users")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async getByEmail(email: string): Promise<User | undefined> {
    return this.db
      .selectFrom("users")
      .selectAll()
      .where("email", "=", email)
      .executeTakeFirst();
  }

  async updateName(id: string, name: string): Promise<User | undefined> {
    return this.db
      .updateTable("users")
      .set({ name, updated_at: sql`now()` })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.db
      .updateTable("users")
      .set({ password_hash: passwordHash, updated_at: sql`now()` })
      .where("id", "=", id)
      .execute();
  }

  async markEmailConfirmed(id: string): Promise<User | undefined> {
    return this.db
      .updateTable("users")
      .set({ email_confirmed_at: sql`now()`, updated_at: sql`now()` })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.db
      .updateTable("users")
      .set({ last_login_at: sql`now()` })
      .where("id", "=", id)
      .execute();
  }

  async updateRole(
    id: string,
    role: "super_admin" | "admin" | "operator" | "technician",
  ): Promise<User | undefined> {
    return this.db
      .updateTable("users")
      .set({ role, updated_at: sql`now()` })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  async updateStatus(
    id: string,
    status: "active" | "suspended" | "deactivated",
  ): Promise<User | undefined> {
    return this.db
      .updateTable("users")
      .set({ status, updated_at: sql`now()` })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  async countByRole(role: "super_admin" | "admin" | "operator" | "technician"): Promise<number> {
    const row = await this.db
      .selectFrom("users")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("role", "=", role)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }
}

export type EmailTokenKind = "email_confirmation" | "password_reset";

export class UserEmailTokensRepository {
  constructor(private readonly db: Db) {}

  async create(
    userId: string,
    kind: EmailTokenKind,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<UserEmailToken> {
    return this.db
      .insertInto("user_email_tokens")
      .values({ user_id: userId, kind, token_hash: tokenHash, expires_at: expiresAt })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Atomically consume a live token: returns the row only when it
   * exists, matches the kind, is unused, and is unexpired. Marks it
   * used so links are single-use.
   */
  async consume(kind: EmailTokenKind, tokenHash: string): Promise<UserEmailToken | undefined> {
    return this.db
      .updateTable("user_email_tokens")
      .set({ used_at: sql`now()` })
      .where("token_hash", "=", tokenHash)
      .where("kind", "=", kind)
      .where("used_at", "is", null)
      .where("expires_at", ">", new Date())
      .returningAll()
      .executeTakeFirst();
  }

  /** Invalidate outstanding tokens of a kind (e.g. on re-request). */
  async revokeOutstanding(userId: string, kind: EmailTokenKind): Promise<void> {
    await this.db
      .updateTable("user_email_tokens")
      .set({ used_at: sql`now()` })
      .where("user_id", "=", userId)
      .where("kind", "=", kind)
      .where("used_at", "is", null)
      .execute();
  }
}

export class UserSessionsRepository {
  constructor(private readonly db: Db) {}

  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<UserSession> {
    return this.db
      .insertInto("user_sessions")
      .values({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getByTokenHash(tokenHash: string): Promise<UserSession | undefined> {
    return this.db
      .selectFrom("user_sessions")
      .selectAll()
      .where("token_hash", "=", tokenHash)
      .executeTakeFirst();
  }

  async deleteByTokenHash(tokenHash: string): Promise<void> {
    await this.db.deleteFrom("user_sessions").where("token_hash", "=", tokenHash).execute();
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.db.deleteFrom("user_sessions").where("user_id", "=", userId).execute();
  }
}
