import type { SupplierSyncResult } from "@fieldfix/contracts";
import type { Db, Supplier } from "../db/database.js";
import { SuppliersRepository } from "../db/repositories/suppliers.js";
import {
  SupplierFetchError,
  WooCommerceClient,
  wooPriceToCents,
  type WooProduct,
} from "./woocommerce.js";

export type SupplierSyncErrorCode =
  | "supplier_not_found"
  | "sync_not_supported"
  | "sync_disabled"
  | "sync_not_configured"
  | "fetch_failed"
  | "unexpected_shape"
  | "unexpected_status";

export class SupplierSyncError extends Error {
  readonly code: SupplierSyncErrorCode;

  constructor(code: SupplierSyncErrorCode, message: string) {
    super(message);
    this.name = "SupplierSyncError";
    this.code = code;
  }
}

/** Guard against runaway catalogues; the result flags truncation. */
const MAX_SYNC_PAGES = 20;

export interface SyncSupplierOptions {
  client?: WooCommerceClient;
}

function toProductRow(supplierId: string, item: WooProduct) {
  const sku = item.sku?.trim();
  return {
    supplier_id: supplierId,
    external_id: String(item.id),
    name: item.name.slice(0, 500),
    part_number: sku && sku.length > 0 ? sku.slice(0, 120) : null,
    price_cents: wooPriceToCents(item.prices.price, item.prices.currency_minor_unit),
    currency: item.prices.currency_code.slice(0, 3).toUpperCase(),
    stock_status: (item.is_in_stock ? "in_stock" : "out_of_stock") as
      | "in_stock"
      | "out_of_stock",
    product_url: item.permalink.slice(0, 2000),
    image_url: item.images[0]?.src.slice(0, 2000) ?? null,
    last_seen_at: new Date(),
  };
}

/**
 * Pull one supplier's catalogue into supplier_products. Only
 * woocommerce_store suppliers sync; manual rows are admin-managed and
 * link_only suppliers have no rows by design.
 */
export async function syncSupplier(
  db: Db,
  supplierId: string,
  options: SyncSupplierOptions = {},
): Promise<SupplierSyncResult> {
  const repo = new SuppliersRepository(db);
  const supplier: Supplier | undefined = await repo.getById(supplierId);
  if (!supplier) {
    throw new SupplierSyncError("supplier_not_found", "Unknown supplier.");
  }
  if (supplier.feed_type !== "woocommerce_store") {
    throw new SupplierSyncError(
      "sync_not_supported",
      `Supplier "${supplier.name}" is ${supplier.feed_type}; only live store feeds sync.`,
    );
  }
  if (!supplier.sync_enabled) {
    throw new SupplierSyncError("sync_disabled", `Sync is disabled for "${supplier.name}".`);
  }
  if (!supplier.feed_base_url) {
    throw new SupplierSyncError(
      "sync_not_configured",
      `Supplier "${supplier.name}" has no feed URL configured.`,
    );
  }
  const client = options.client ?? new WooCommerceClient({ baseUrl: supplier.feed_base_url });
  let fetched = 0;
  let created = 0;
  let updated = 0;
  let pages = 0;
  let truncated = false;
  try {
    let page = 1;
    let totalPages = 1;
    do {
      if (page > MAX_SYNC_PAGES) {
        truncated = true;
        break;
      }
      const result = await client.listProducts(page);
      totalPages = result.totalPages;
      pages = page;
      for (const item of result.products) {
        fetched += 1;
        const outcome = await repo.upsertFeedProduct(toProductRow(supplier.id, item));
        if (outcome.created) {
          created += 1;
        } else {
          updated += 1;
        }
      }
      page += 1;
    } while (page <= totalPages);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed.";
    await repo.recordSync(supplier.id, "failed", message.slice(0, 4000));
    if (err instanceof SupplierFetchError) {
      throw new SupplierSyncError(err.code, err.message);
    }
    throw new SupplierSyncError("fetch_failed", message);
  }
  await repo.recordSync(supplier.id, "ok", null);
  return { supplier_id: supplier.id, fetched, created, updated, pages, truncated };
}
