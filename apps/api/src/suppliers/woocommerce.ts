import { z } from "zod";

/**
 * WooCommerce Store API client (public, cart/checkout-adjacent read API
 * that WooCommerce exposes for headless storefronts — no credentials).
 * One page per call; the sync service walks pages. Verified live against
 * linkscreek.com.ng `/wp-json/wc/store/v1/products`.
 */

export const DEFAULT_WOO_PER_PAGE = 100;
const FETCH_TIMEOUT_MS = 30_000;

const wooPricesSchema = z
  .object({
    price: z.string(),
    currency_code: z.string(),
    currency_minor_unit: z.number().int().nonnegative(),
  })
  .passthrough();

const wooImageSchema = z.object({ src: z.string() }).passthrough();

const wooProductSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    slug: z.string(),
    sku: z.string().optional(),
    permalink: z.string(),
    is_in_stock: z.boolean(),
    prices: wooPricesSchema,
    images: z.array(wooImageSchema),
  })
  .passthrough();

export type WooProduct = z.infer<typeof wooProductSchema>;

export type SupplierFetchErrorCode =
  | "fetch_failed"
  | "unexpected_shape"
  | "unexpected_status";

export class SupplierFetchError extends Error {
  readonly code: SupplierFetchErrorCode;
  readonly status?: number;

  constructor(code: SupplierFetchErrorCode, message: string, status?: number) {
    super(message);
    this.name = "SupplierFetchError";
    this.code = code;
    this.status = status;
  }
}

export interface WooCommerceClientOptions {
  baseUrl: string;
  fetchFn?: typeof fetch;
}

export interface WooProductPage {
  products: WooProduct[];
  totalPages: number;
}

export class WooCommerceClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: WooCommerceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async listProducts(page: number, perPage = DEFAULT_WOO_PER_PAGE): Promise<WooProductPage> {
    if (!Number.isInteger(page) || page < 1) {
      throw new SupplierFetchError("fetch_failed", `Invalid Store API page: ${page}.`);
    }
    const url = `${this.baseUrl}/wp-json/wc/store/v1/products?per_page=${perPage}&page=${page}`;
    let response: Response;
    try {
      response = await this.fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      throw new SupplierFetchError(
        "fetch_failed",
        `Could not reach the store API: ${err instanceof Error ? err.message : "network error"}.`,
      );
    }
    if (!response.ok) {
      throw new SupplierFetchError(
        response.status === 404 ? "unexpected_status" : "fetch_failed",
        `Store API returned HTTP ${response.status} (page ${page}).`,
        response.status,
      );
    }
    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      throw new SupplierFetchError("unexpected_shape", "Store API returned invalid JSON.");
    }
    const parsed = z.array(wooProductSchema).safeParse(payload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new SupplierFetchError(
        "unexpected_shape",
        `Unexpected product shape: ${first?.path.join(".") || "?"} — ${first?.message || "schema violation"}.`,
      );
    }
    const totalPages = Number.parseInt(response.headers.get("x-wp-totalpages") ?? "1", 10);
    return {
      products: parsed.data,
      totalPages: Number.isFinite(totalPages) && totalPages >= 1 ? totalPages : 1,
    };
  }
}

/** Minor-unit price string ("1200000", minor 2) → integer cents. Null when unparseable. */
export function wooPriceToCents(price: string, minorUnit: number): number | null {
  if (!/^\d+$/.test(price.trim())) {
    return null;
  }
  const minor = Number.parseInt(price.trim(), 10);
  if (!Number.isSafeInteger(minor) || minor < 0) {
    return null;
  }
  // Normalize any minor unit to cents (2dp).
  const cents = minorUnit === 2 ? minor : Math.round((minor / 10 ** minorUnit) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}
