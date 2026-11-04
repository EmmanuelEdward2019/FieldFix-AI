import { describe, expect, it, vi } from "vitest";
import {
  SupplierFetchError,
  WooCommerceClient,
  wooPriceToCents,
} from "../../src/suppliers/woocommerce.js";

const PRODUCT = {
  id: 3954,
  name: "HP Laptop Charger 65W",
  slug: "hp-laptop-charger",
  sku: "HP-65W-BLUE",
  permalink: "https://store.example/product/hp-laptop-charger/",
  is_in_stock: true,
  prices: {
    price: "1200000",
    currency_code: "NGN",
    currency_minor_unit: 2,
  },
  images: [{ id: 1, src: "https://store.example/img.jpg" }],
};

function jsonResponse(payload: unknown, totalPages = "1", status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "x-wp-totalpages": totalPages },
  });
}

describe("WooCommerceClient", () => {
  it("parses a product page and total pages", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([PRODUCT], "4"));
    const client = new WooCommerceClient({ baseUrl: "https://store.example/", fetchFn });
    const page = await client.listProducts(2);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://store.example/wp-json/wc/store/v1/products?per_page=100&page=2",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(page.totalPages).toBe(4);
    expect(page.products).toHaveLength(1);
    expect(page.products[0]?.sku).toBe("HP-65W-BLUE");
  });

  it("rejects invalid page numbers without fetching", async () => {
    const fetchFn = vi.fn();
    const client = new WooCommerceClient({ baseUrl: "https://store.example", fetchFn });
    await expect(client.listProducts(0)).rejects.toMatchObject({ code: "fetch_failed" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("wraps network failures", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("down"));
    const client = new WooCommerceClient({ baseUrl: "https://store.example", fetchFn });
    await expect(client.listProducts(1)).rejects.toMatchObject({ code: "fetch_failed" });
  });

  it("reports HTTP failures with status", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: "x" }, "1", 500));
    const client = new WooCommerceClient({ baseUrl: "https://store.example", fetchFn });
    const err = await client.listProducts(1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SupplierFetchError);
    expect(err).toMatchObject({ code: "fetch_failed", status: 500 });
  });

  it("rejects non-array and malformed payloads", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ products: [] }));
    const client = new WooCommerceClient({ baseUrl: "https://store.example", fetchFn });
    await expect(client.listProducts(1)).rejects.toMatchObject({ code: "unexpected_shape" });
  });

  it("rejects invalid JSON", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("<html>nope</html>", { status: 200 }));
    const client = new WooCommerceClient({ baseUrl: "https://store.example", fetchFn });
    await expect(client.listProducts(1)).rejects.toMatchObject({ code: "unexpected_shape" });
  });
});

describe("wooPriceToCents", () => {
  it("passes minor-unit-2 prices through", () => {
    expect(wooPriceToCents("1200000", 2)).toBe(1200000);
  });

  it("normalizes other minor units to cents", () => {
    expect(wooPriceToCents("12000", 0)).toBe(1200000);
    expect(wooPriceToCents("12000000", 3)).toBe(1200000);
  });

  it("returns null for unparseable prices", () => {
    expect(wooPriceToCents("", 2)).toBeNull();
    expect(wooPriceToCents("12.5", 2)).toBeNull();
    expect(wooPriceToCents("-5", 2)).toBeNull();
  });
});
