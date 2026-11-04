import type { Db, NotificationRecord } from "../database.js";

export class NotificationRepository {
  constructor(private readonly db: Db) {}

  async record(input: {
    kind: string;
    title: string;
    body: string;
    link?: string | null;
    userId?: string | null;
  }): Promise<NotificationRecord> {
    return this.db
      .insertInto("notification_records")
      .values({
        kind: input.kind,
        title: input.title,
        body: input.body,
        link: input.link ?? null,
        user_id: input.userId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async list(options: {
    limit: number;
    offset: number;
    unreadOnly?: boolean;
  }): Promise<{ rows: NotificationRecord[]; total: number; unread: number }> {
    let rowsQuery = this.db
      .selectFrom("notification_records")
      .selectAll()
      .orderBy("created_at", "desc")
      .limit(options.limit)
      .offset(options.offset);
    if (options.unreadOnly) {
      rowsQuery = rowsQuery.where("is_read", "=", false);
    }
    const rows = await rowsQuery.execute();
    const totalRow = await this.db
      .selectFrom("notification_records")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirst();
    const unreadRow = await this.db
      .selectFrom("notification_records")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("is_read", "=", false)
      .executeTakeFirst();
    return {
      rows,
      total: Number(totalRow?.count ?? 0),
      unread: Number(unreadRow?.count ?? 0),
    };
  }

  async markRead(id: string): Promise<boolean> {
    const result = await this.db
      .updateTable("notification_records")
      .set({ is_read: true })
      .where("id", "=", id)
      .executeTakeFirst();
    return (result.numUpdatedRows ?? 0n) > 0n;
  }

  async markAllRead(): Promise<void> {
    await this.db.updateTable("notification_records").set({ is_read: true }).execute();
  }

  /**
   * Account-scoped feed: the user's own rows plus global announcements.
   * Admin-operational rows (ingestion failures, etc.) never leak across.
   */
  async listForUser(
    userId: string,
    options: { limit: number; offset: number; unreadOnly?: boolean },
  ): Promise<{ rows: NotificationRecord[]; total: number; unread: number }> {
    let rowsQuery = this.db
      .selectFrom("notification_records")
      .selectAll()
      .where((eb) =>
        eb.or([
          eb("user_id", "=", userId),
          eb.and([eb("user_id", "is", null), eb("kind", "=", "announcement")]),
        ]),
      )
      .orderBy("created_at", "desc")
      .limit(options.limit)
      .offset(options.offset);
    if (options.unreadOnly) {
      rowsQuery = rowsQuery.where("is_read", "=", false);
    }
    const rows = await rowsQuery.execute();
    const totalRow = await this.db
      .selectFrom("notification_records")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where((eb) =>
        eb.or([
          eb("user_id", "=", userId),
          eb.and([eb("user_id", "is", null), eb("kind", "=", "announcement")]),
        ]),
      )
      .executeTakeFirst();
    // Unread counts owned rows only: announcements are a shared
    // broadcast without per-user read state.
    const unreadRow = await this.db
      .selectFrom("notification_records")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("user_id", "=", userId)
      .where("is_read", "=", false)
      .executeTakeFirst();
    return {
      rows,
      total: Number(totalRow?.count ?? 0),
      unread: Number(unreadRow?.count ?? 0),
    };
  }

  /** Scoped reads: a user can only mark their own rows. */
  async markReadForUser(userId: string, id: string): Promise<boolean> {
    const result = await this.db
      .updateTable("notification_records")
      .set({ is_read: true })
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return (result.numUpdatedRows ?? 0n) > 0n;
  }

  async markAllReadForUser(userId: string): Promise<void> {
    // Only the user's own rows; announcements stay unread for others.
    await this.db
      .updateTable("notification_records")
      .set({ is_read: true })
      .where("user_id", "=", userId)
      .execute();
  }
}
