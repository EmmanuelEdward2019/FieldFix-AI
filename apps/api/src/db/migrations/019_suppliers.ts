import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/**
 * 019 — parts suppliers and product listings.
 *
 * suppliers: one row per store. feed_type decides where product rows
 * come from:
 * - woocommerce_store: synced live from the store's public WooCommerce
 *   Store API (no credentials; prices/stock as published by the store).
 * - manual: listings entered by an admin (prices/stock as keyed in).
 * - link_only: no product rows; the advisor links out to the store
 *   without claiming prices or stock.
 * search_url_template interpolates an encoded query at {q}; null
 * means "link to website_url only".
 *
 * supplier_products: normalized listings. last_seen_at records when a
 * feed row was last confirmed (sync time) or when a manual row was
 * last edited; the UI renders "verified … ago" from it. Nothing here
 * is ever invented: feed rows mirror the supplier API verbatim.
 *
 * Seeds the six approved Nigerian suppliers. LinksCreek exposes a
 * public Store API; the rest have no public product feed, so they
 * start as link_only (Jumia with its verified catalog search URL).
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table suppliers (
      id uuid primary key default gen_random_uuid(),
      name text not null check (char_length(name) between 1 and 200),
      website_url text not null check (char_length(website_url) between 1 and 2000),
      feed_type text not null check (feed_type in ('woocommerce_store', 'manual', 'link_only')),
      feed_base_url text check (feed_base_url is null or char_length(feed_base_url) between 1 and 2000),
      search_url_template text check (search_url_template is null or char_length(search_url_template) between 1 and 2000),
      sync_enabled boolean not null default true,
      last_sync_at timestamptz,
      last_sync_status text check (last_sync_status is null or last_sync_status in ('ok', 'failed')),
      last_sync_error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`
    create trigger suppliers_set_updated_at
      before update on suppliers
      for each row execute function set_updated_at();
  `.execute(db);

  await sql`
    create table supplier_products (
      id uuid primary key default gen_random_uuid(),
      supplier_id uuid not null references suppliers (id) on delete cascade,
      external_id text not null check (char_length(external_id) between 1 and 200),
      name text not null check (char_length(name) between 1 and 500),
      part_number text check (part_number is null or char_length(part_number) between 1 and 120),
      price_cents integer check (price_cents is null or price_cents >= 0),
      currency text check (currency is null or char_length(currency) = 3),
      stock_status text not null default 'unknown'
        check (stock_status in ('in_stock', 'out_of_stock', 'unknown')),
      product_url text not null check (char_length(product_url) between 1 and 2000),
      image_url text check (image_url is null or char_length(image_url) between 1 and 2000),
      last_seen_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (supplier_id, external_id)
    );
  `.execute(db);
  await sql`
    create trigger supplier_products_set_updated_at
      before update on supplier_products
      for each row execute function set_updated_at();
  `.execute(db);
  await sql`create index supplier_products_supplier_id_idx on supplier_products (supplier_id);`.execute(db);
  await sql`create index supplier_products_part_number_idx on supplier_products (part_number);`.execute(db);

  await sql`
    insert into suppliers (name, website_url, feed_type, feed_base_url, search_url_template, sync_enabled)
    values
      ('LinksCreek', 'https://linkscreek.com.ng', 'woocommerce_store', 'https://linkscreek.com.ng', null, true),
      ('ComputerRepair NG', 'https://computerrepair.com.ng/products', 'link_only', null, null, false),
      ('Blessing Computers', 'https://www.blessingcomputers.com/', 'link_only', null, null, false),
      ('FriiMarket', 'https://friimarket.com/', 'link_only', null, null, false),
      ('GadgetWorld NG', 'https://gadgetworld.com.ng/product-category/laptop-replacement-parts/', 'link_only', null, null, false),
      ('Jumia Nigeria', 'https://www.jumia.com.ng/mlp-replacement-parts-for-phones/', 'link_only', null, 'https://www.jumia.com.ng/catalog/?q={q}', false);
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists supplier_products;`.execute(db);
  await sql`drop table if exists suppliers;`.execute(db);
}
