import { sql } from "kysely";
import type { Db, UserMfa, UserMfaChallenge } from "../database.js";

export class MfaRepository {
  constructor(private readonly db: Db) {}

  async get(userId: string): Promise<UserMfa | undefined> {
    return this.db
      .selectFrom("user_mfa")
      .selectAll()
      .where("user_id", "=", userId)
      .executeTakeFirst();
  }

  async isVerified(userId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom("user_mfa")
      .select("verified_at")
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return row?.verified_at != null;
  }

  /** Upsert a pending (unverified) secret; re-enrolling replaces it. */
  async savePending(userId: string, secretEnc: string): Promise<void> {
    await this.db
      .insertInto("user_mfa")
      .values({ user_id: userId, secret_enc: secretEnc, verified_at: null })
      .onConflict((oc) =>
        oc.column("user_id").doUpdateSet({
          secret_enc: secretEnc,
          verified_at: null,
          updated_at: sql`now()`,
        }),
      )
      .execute();
  }

  async markVerified(userId: string): Promise<void> {
    await this.db
      .updateTable("user_mfa")
      .set({ verified_at: sql`now()`, updated_at: sql`now()` })
      .where("user_id", "=", userId)
      .execute();
  }

  async remove(userId: string): Promise<void> {
    await this.db.deleteFrom("user_mfa").where("user_id", "=", userId).execute();
    await this.db
      .deleteFrom("user_mfa_backup_codes")
      .where("user_id", "=", userId)
      .execute();
    await this.db
      .deleteFrom("user_mfa_challenges")
      .where("user_id", "=", userId)
      .execute();
  }

  async replaceBackupCodes(userId: string, codeHashes: string[]): Promise<void> {
    await this.db
      .deleteFrom("user_mfa_backup_codes")
      .where("user_id", "=", userId)
      .execute();
    if (codeHashes.length > 0) {
      await this.db
        .insertInto("user_mfa_backup_codes")
        .values(codeHashes.map((code_hash) => ({ user_id: userId, code_hash })))
        .execute();
    }
  }

  async unusedBackupCodeHashes(userId: string): Promise<{ id: string; code_hash: string }[]> {
    return this.db
      .selectFrom("user_mfa_backup_codes")
      .select(["id", "code_hash"])
      .where("user_id", "=", userId)
      .where("used_at", "is", null)
      .execute();
  }

  async markBackupCodeUsed(id: string): Promise<void> {
    await this.db
      .updateTable("user_mfa_backup_codes")
      .set({ used_at: sql`now()` })
      .where("id", "=", id)
      .execute();
  }

  async createChallenge(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<UserMfaChallenge> {
    return this.db
      .insertInto("user_mfa_challenges")
      .values({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findChallenge(tokenHash: string): Promise<UserMfaChallenge | undefined> {
    return this.db
      .selectFrom("user_mfa_challenges")
      .selectAll()
      .where("token_hash", "=", tokenHash)
      .where("used_at", "is", null)
      .where("expires_at", ">", new Date())
      .executeTakeFirst();
  }

  async consumeChallenge(tokenHash: string): Promise<UserMfaChallenge | undefined> {
    // Called after the code verifies: marks the challenge used only if
    // still unused, so concurrent replays lose the race. Wrong codes
    // never burn the challenge — it stays valid until it expires.
    return this.db
      .updateTable("user_mfa_challenges")
      .set({ used_at: sql`now()` })
      .where("token_hash", "=", tokenHash)
      .where("used_at", "is", null)
      .where("expires_at", ">", new Date())
      .returningAll()
      .executeTakeFirst();
  }
}
