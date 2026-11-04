import type {
  CreateManualProduct,
  CreateSupplier,
  SupplierSyncStatus,
  UpdateSupplier,
  UpdateSupplierProduct,
} from "@fieldfix/contracts";
import { sql } from "kysely";
import type {
  Db,
  NewSupplierProduct,
  Supplier,
  SupplierProduct,
  SupplierProductUpdate,
} from "../database.js";

export class SuppliersRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<Array<Supplier & { product_count: number }>> {
    const rows = await this.db
      .selectFrom("suppliers")
      .leftJoin("supplier_products", "supplier_products.supplier_id", "suppliers.id")
      .selectAll("suppliers")
      .select((eb) => eb.fn.count<number>("supplier_products.id").as("product_count"))
      .groupBy("suppliers.id")
      .orderBy("suppliers.name", "asc")
      .execute();
    return rows.map((row) => ({ ...row, product_count: Number(row.product_count) }));
  }

  async getById(id: string): Promise<Supplier | undefined> {
    return this.db
      .selectFrom("suppliers")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async create(input: CreateSupplier): Promise<Supplier> {
    return this.db
      .insertInto("suppliers")
      .values({
        name: input.name.trim(),
        website_url: input.website_url,
        feed_type: input.feed_type,
        feed_base_url: input.feed_base_url ?? null,
        search_url_template: input.search_url_template ?? null,
        sync_enabled: input.sync_enabled,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(id: string, input: UpdateSupplier): Promise<Supplier | undefined> {
    return this.db
      .updateTable("suppliers")
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.website_url !== undefined ? { website_url: input.website_url } : {}),
        ...(input.feed_base_url !== undefined ? { feed_base_url: input.feed_base_url } : {}),
        ...(input.search_url_template !== undefined
          ? { search_url_template: input.search_url_template }
          : {}),
        ...(input.sync_enabled !== undefined ? { sync_enabled: input.sync_enabled } : {}),
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  /** Deleting a supplier cascades to its product rows. */
  async remove(id: string): Promise<boolean> {
    const result = await this.db.deleteFrom("suppliers").where("id", "=", id).executeTakeFirst();
    return (result.numDeletedRows ?? 0n) > 0n;
  }

  async recordSync(
    id: string,
    status: SupplierSyncStatus,
    error: string | null,
  ): Promise<void> {
    await this.db
      .updateTable("suppliers")
      .set({
        last_sync_at: sql`now()`,
        last_sync_status: status,
        last_sync_error: error,
      })
      .where("id", "=", id)
      .execute();
  }

  async listProducts(
    supplierId: string,
    options: { limit: number; offset: number; query?: string },
  ): Promise<{ items: SupplierProduct[]; total: number }> {
    let query = this.db
      .selectFrom("supplier_products")
      .selectAll()
      .where("supplier_id", "=", supplierId);
    if (options.query) {
      const needle = `%${options.query.replace(/[%_]/g, "")}%`;
      query = query.where((eb) =>
        eb.or([
          eb("name", "ilike", needle),
          eb("part_number", "ilike", needle),
          eb("external_id", "=", options.query as string),
        ]),
      );
    }
    const total = await query
      .clearSelect()
      .select((eb) => eb.fn.count<number>("id").as("count"))
      .executeTakeFirstOrThrow();
    const items = await query
      .clearSelect()
      .selectAll()
      .orderBy("updated_at", "desc")
      .limit(options.limit)
      .offset(options.offset)
      .execute();
    return { items, total: Number(total.count) };
  }

  async getProduct(id: string): Promise<SupplierProduct | undefined> {
    return this.db
      .selectFrom("supplier_products")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async upsertFeedProduct(row: NewSupplierProduct): Promise<{ created: boolean }> {
    const existing = await this.db
      .selectFrom("supplier_products")
      .select("id")
      .where("supplier_id", "=", row.supplier_id)
      .where("external_id", "=", row.external_id)
      .executeTakeFirst();
    if (!existing) {
      await this.db.insertInto("supplier_products").values(row).execute();
      return { created: true };
    }
    const update: SupplierProductUpdate = {
      name: row.name,
      part_number: row.part_number ?? null,
      price_cents: row.price_cents ?? null,
      currency: row.currency ?? null,
      stock_status: row.stock_status ?? "unknown",
      product_url: row.product_url,
      image_url: row.image_url ?? null,
      last_seen_at: row.last_seen_at ?? null,
    };
    await this.db
      .updateTable("supplier_products")
      .set(update)
      .where("id", "=", existing.id)
      .execute();
    return { created: false };
  }

  /** Manual listings get a generated external_id; feed rows use the store's id. */
  async createManualProduct(
    supplierId: string,
    externalId: string,
    input: CreateManualProduct,
  ): Promise<SupplierProduct> {
    return this.db
      .insertInto("supplier_products")
      .values({
        supplier_id: supplierId,
        external_id: externalId,
        name: input.name.trim(),
        part_number: input.part_number?.trim() || null,
        price_cents: input.price_cents ?? null,
        currency: input.currency ?? null,
        stock_status: input.stock_status,
        product_url: input.product_url,
        image_url: input.image_url ?? null,
        last_seen_at: sql`now()`,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateProduct(
    id: string,
    input: UpdateSupplierProduct,
  ): Promise<SupplierProduct | undefined> {
    return this.db
      .updateTable("supplier_products")
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.part_number !== undefined
          ? { part_number: input.part_number?.trim() || null }
          : {}),
        ...(input.price_cents !== undefined ? { price_cents: input.price_cents } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.stock_status !== undefined ? { stock_status: input.stock_status } : {}),
        ...(input.product_url !== undefined ? { product_url: input.product_url } : {}),
        ...(input.image_url !== undefined ? { image_url: input.image_url ?? null } : {}),
        last_seen_at: sql`now()`,
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  async removeProduct(id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom("supplier_products")
      .where("id", "=", id)
      .executeTakeFirst();
    return (result.numDeletedRows ?? 0n) > 0n;
  }

  /**
   * Candidate rows for offer matching: products whose name contains at
   * least one significant term, or whose part number matches exactly.
   * Scoring happens in JS (match.ts); this only narrows the scan.
   */
  async findMatchCandidates(
    terms: string[],
    partNumber: string | null,
    limit = 200,
  ): Promise<Array<SupplierProduct & { supplier_name: string; supplier_website_url: string }>> {
    if (terms.length === 0 && !partNumber) {
      return [];
    }
    return this.db
      .selectFrom("supplier_products")
      .innerJoin("suppliers", "suppliers.id", "supplier_products.supplier_id")
      .selectAll("supplier_products")
      .select(["suppliers.name as supplier_name", "suppliers.website_url as supplier_website_url"])
      .where((eb) => {
        const conditions = terms.map((term) =>
          eb("supplier_products.name", "ilike", `%${term.replace(/[%_]/g, "")}%`),
        );
        if (partNumber) {
          conditions.push(eb("supplier_products.part_number", "=", partNumber));
        }
        return eb.or(conditions);
      })
      .orderBy("supplier_products.updated_at", "desc")
      .limit(limit)
      .execute();
  }
}
