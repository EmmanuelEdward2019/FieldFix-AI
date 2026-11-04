import type { Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/db/database.js";
import { SuppliersRepository } from "../../src/db/repositories/suppliers.js";
import { SupplierFetchError, WooCommerceClient } from "../../src/suppliers/woocommerce.js";
import { SupplierSyncError, syncSupplier } from "../../src/suppliers/sync.js";
import { setupTestDb, teardownTestDb, truncateAll } from "../db/setup.js";

let db: Kysely<Database>;

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb(db);
});

beforeEach(async () => {
  await truncateAll(db);
});

const PRODUCT = {
  id: 3954,
  name: "HP Laptop Charger 65W",
  slug: "hp-laptop-charger",
  sku: "HP-65W-BLUE",
  permalink: "https://store.example/product/hp-laptop-charger/",
  is_in_stock: true,
  prices: { price: "1200000", currency_code: "NGN", currency_minor_unit: 2 },
  images: [{ id: 1, src: "https://store.example/img.jpg" }],
};

function mockClient(pages: Array<typeof PRODUCT[]>): WooCommerceClient {
  const listProducts = vi.fn(async (page: number) => ({
    products: (pages[page - 1] ?? []) as never,
    totalPages: pages.length,
  }));
  return { listProducts } as unknown as WooCommerceClient;
}

async function makeSupplier(
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const row = await new SuppliersRepository(db).create({
    name: "Test Store",
    website_url: "https://store.example",
    feed_type: "woocommerce_store",
    feed_base_url: "https://store.example",
    search_url_template: null,
    sync_enabled: true,
    ...overrides,
  } as never);
  return { id: row.id };
}

describe("syncSupplier", () => {
  it("upserts feed rows and records a successful sync", async () => {
    const { id } = await makeSupplier();
    const result = await syncSupplier(
      db,
      id,
      { client: mockClient([[PRODUCT]]) },
    );
    expect(result).toMatchObject({ fetched: 1, created: 1, updated: 0, truncated: false });
    const repo = new SuppliersRepository(db);
    const { items, total } = await repo.listProducts(id, { limit: 10, offset: 0 });
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({
      external_id: "3954",
      name: "HP Laptop Charger 65W",
      part_number: "HP-65W-BLUE",
      price_cents: 1200000,
      currency: "NGN",
      stock_status: "in_stock",
    });
    expect(items[0]?.last_seen_at).toBeTruthy();
    const supplier = await repo.getById(id);
    expect(supplier?.last_sync_status).toBe("ok");
    expect(supplier?.last_sync_error).toBeNull();

    // Second sync updates the same row instead of duplicating it.
    const again = await syncSupplier(db, id, { client: mockClient([[PRODUCT]]) });
    expect(again).toMatchObject({ fetched: 1, created: 0, updated: 1 });
    const after = await repo.listProducts(id, { limit: 10, offset: 0 });
    expect(after.total).toBe(1);
  });

  it("walks every page of the catalogue", async () => {
    const { id } = await makeSupplier();
    const second = { ...PRODUCT, id: 3955, name: "Dell Charger 90W", sku: "DELL-90W" };
    const result = await syncSupplier(db, id, { client: mockClient([[PRODUCT], [second]]) });
    expect(result).toMatchObject({ fetched: 2, created: 2, pages: 2 });
  });

  it("records failures and surfaces fetch errors", async () => {
    const { id } = await makeSupplier();
    const failing = {
      listProducts: vi.fn(async () => {
        throw new SupplierFetchError("fetch_failed", "store is down");
      }),
    } as unknown as WooCommerceClient;
    const err = await syncSupplier(db, id, { client: failing }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SupplierSyncError);
    expect(err).toMatchObject({ code: "fetch_failed" });
    const supplier = await new SuppliersRepository(db).getById(id);
    expect(supplier?.last_sync_status).toBe("failed");
    expect(supplier?.last_sync_error).toContain("store is down");
  });

  it("refuses unknown, non-feed, disabled, and unconfigured suppliers", async () => {
    await expect(
      syncSupplier(db, "99999999-9999-4999-8999-999999999999"),
    ).rejects.toMatchObject({ code: "supplier_not_found" });

    const manual = await makeSupplier({ feed_type: "manual", feed_base_url: null });
    await expect(syncSupplier(db, manual.id)).rejects.toMatchObject({
      code: "sync_not_supported",
    });

    const disabled = await makeSupplier({ sync_enabled: false });
    await expect(syncSupplier(db, disabled.id)).rejects.toMatchObject({ code: "sync_disabled" });

    const unconfigured = await makeSupplier({ feed_base_url: null });
    await expect(syncSupplier(db, unconfigured.id)).rejects.toMatchObject({
      code: "sync_not_configured",
    });
  });
});
