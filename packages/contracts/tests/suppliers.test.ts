import { describe, expect, it } from "vitest";
import {
  createManualProductSchema,
  createSupplierSchema,
  partOffersResponseSchema,
  supplierFeedTypeSchema,
  supplierStockStatusSchema,
  supplierSyncStatusSchema,
} from "../src/index.js";

describe("supplier enums", () => {
  it("accepts the three feed types", () => {
    for (const feed of ["woocommerce_store", "manual", "link_only"]) {
      expect(supplierFeedTypeSchema.safeParse(feed).success).toBe(true);
    }
    expect(supplierFeedTypeSchema.safeParse("scrape").success).toBe(false);
  });

  it("accepts stock and sync states", () => {
    for (const status of ["in_stock", "out_of_stock", "unknown"]) {
      expect(supplierStockStatusSchema.safeParse(status).success).toBe(true);
    }
    expect(supplierStockStatusSchema.safeParse("plenty").success).toBe(false);
    expect(supplierSyncStatusSchema.safeParse("ok").success).toBe(true);
    expect(supplierSyncStatusSchema.safeParse("running").success).toBe(false);
  });
});

describe("createSupplierSchema", () => {
  it("accepts a minimal link-only supplier", () => {
    const parsed = createSupplierSchema.safeParse({
      name: "Link Store",
      website_url: "https://link.example/shop",
      feed_type: "link_only",
    });
    expect(parsed.success).toBe(true);
  });

  it("requires {q} in search templates", () => {
    const parsed = createSupplierSchema.safeParse({
      name: "Bad Store",
      website_url: "https://bad.example",
      feed_type: "link_only",
      search_url_template: "https://bad.example/search",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects invalid website URLs", () => {
    const parsed = createSupplierSchema.safeParse({
      name: "Bad Store",
      website_url: "not-a-url",
      feed_type: "manual",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("createManualProductSchema", () => {
  it("accepts a listing with price and stock", () => {
    const parsed = createManualProductSchema.safeParse({
      name: "Laptop Battery 56Wh",
      part_number: "BAT-56",
      price_cents: 4500000,
      currency: "NGN",
      stock_status: "in_stock",
      product_url: "https://store.example/battery",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects negative prices and bad currencies", () => {
    expect(
      createManualProductSchema.safeParse({
        name: "x",
        price_cents: -1,
        product_url: "https://store.example/x",
      }).success,
    ).toBe(false);
    expect(
      createManualProductSchema.safeParse({
        name: "x",
        currency: "naira",
        product_url: "https://store.example/x",
      }).success,
    ).toBe(false);
  });
});

describe("partOffersResponseSchema", () => {
  it("accepts an empty result with outbound links", () => {
    const parsed = partOffersResponseSchema.safeParse({
      recommendation_id: "11111111-1111-4111-8111-111111111111",
      part_name: "Unobtanium widget",
      offers: [],
      outbound_links: [
        {
          supplier_id: "22222222-2222-4222-8222-222222222222",
          supplier_name: "Link Store",
          search_url: "https://link.example/catalog/?q=Unobtanium",
          has_live_prices: false,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});
