import { sql, type Kysely } from "kysely";
import type { Database } from "../database.js";

/**
 * 018 — repair-shop workspace.
 *
 * Multi-tenant by shop: shops own members, customers, devices
 * (via customers), jobs, events (via jobs), estimates (via jobs),
 * inventory, and movements (via items). Every shop-scoped table
 * cascades from its parent so deleting a shop removes its data;
 * cross-references that must survive use SET NULL (shop owner,
 * job assignee/device/session, estimate author, movement job).
 *
 * Customer/job references (C-/J- + 8 hex) are service-generated
 * unique text, never client-supplied — enforced UNIQUE here.
 * Roles, statuses, and kinds are TEXT + CHECK (mirrored in
 * packages/contracts/src/shop.ts), never native enums.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table shops (
      id uuid primary key default gen_random_uuid(),
      owner_user_id uuid references users (id) on delete set null,
      name text not null check (char_length(name) between 1 and 200),
      description text,
      phone text,
      email text,
      address text,
      city text,
      region text,
      country text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`
    create trigger shops_set_updated_at
      before update on shops
      for each row execute function set_updated_at();
  `.execute(db);

  await sql`
    create table shop_members (
      shop_id uuid not null references shops (id) on delete cascade,
      user_id uuid not null references users (id) on delete cascade,
      role text not null check (role in ('owner', 'admin', 'technician', 'front_desk')),
      primary key (shop_id, user_id)
    );
  `.execute(db);
  await sql`create index shop_members_user_idx on shop_members (user_id);`.execute(db);

  await sql`
    create table shop_customers (
      id uuid primary key default gen_random_uuid(),
      shop_id uuid not null references shops (id) on delete cascade,
      reference text not null unique,
      name text not null check (char_length(name) between 1 and 200),
      phone text,
      email text,
      address text,
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`
    create trigger shop_customers_set_updated_at
      before update on shop_customers
      for each row execute function set_updated_at();
  `.execute(db);
  await sql`create index shop_customers_shop_name_idx on shop_customers (shop_id, name);`.execute(
    db,
  );

  await sql`
    create table customer_devices (
      id uuid primary key default gen_random_uuid(),
      customer_id uuid not null references shop_customers (id) on delete cascade,
      category text not null check (category in ('laptop', 'desktop', 'smartphone')),
      manufacturer text,
      model text,
      serial_imei text,
      created_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index customer_devices_customer_idx on customer_devices (customer_id);`.execute(
    db,
  );

  await sql`
    create table repair_jobs (
      id uuid primary key default gen_random_uuid(),
      shop_id uuid not null references shops (id) on delete cascade,
      customer_id uuid not null references shop_customers (id) on delete cascade,
      device_id uuid references customer_devices (id) on delete set null,
      session_id uuid references diagnostic_sessions (id) on delete set null,
      job_reference text not null unique,
      reported_fault text not null,
      device_condition text,
      accessories text,
      assignee_user_id uuid references users (id) on delete set null,
      priority text not null default 'normal'
        check (priority in ('low', 'normal', 'high', 'urgent')),
      status text not null default 'received'
        check (status in ('received', 'awaiting_diagnosis', 'diagnosing', 'awaiting_approval', 'awaiting_parts', 'in_repair', 'testing', 'completed', 'ready_for_collection', 'collected', 'cancelled')),
      received_at timestamptz not null default now(),
      expected_at timestamptz,
      completed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`
    create trigger repair_jobs_set_updated_at
      before update on repair_jobs
      for each row execute function set_updated_at();
  `.execute(db);
  await sql`create index repair_jobs_shop_status_idx on repair_jobs (shop_id, status);`.execute(
    db,
  );
  await sql`create index repair_jobs_customer_idx on repair_jobs (customer_id);`.execute(db);

  await sql`
    create table repair_job_events (
      id uuid primary key default gen_random_uuid(),
      job_id uuid not null references repair_jobs (id) on delete cascade,
      actor_user_id uuid references users (id) on delete set null,
      kind text not null check (kind in ('note', 'status_change', 'assignment', 'estimate', 'inventory')),
      body text,
      from_status text,
      to_status text,
      created_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index repair_job_events_job_idx on repair_job_events (job_id, created_at);`.execute(
    db,
  );

  await sql`
    create table repair_estimates (
      id uuid primary key default gen_random_uuid(),
      job_id uuid not null references repair_jobs (id) on delete cascade,
      status text not null default 'draft'
        check (status in ('draft', 'sent', 'approved', 'rejected', 'converted')),
      diagnosis_summary text,
      recommended_repair text,
      labor_cents integer not null default 0 check (labor_cents >= 0),
      other_cents integer not null default 0 check (other_cents >= 0),
      currency text not null default 'USD',
      validity_days integer check (validity_days is null or validity_days > 0),
      terms text,
      created_by_user_id uuid references users (id) on delete set null,
      decided_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`
    create trigger repair_estimates_set_updated_at
      before update on repair_estimates
      for each row execute function set_updated_at();
  `.execute(db);
  await sql`create index repair_estimates_job_idx on repair_estimates (job_id);`.execute(db);

  await sql`
    create table repair_estimate_items (
      id uuid primary key default gen_random_uuid(),
      estimate_id uuid not null references repair_estimates (id) on delete cascade,
      kind text not null check (kind in ('part', 'labor', 'other')),
      description text not null,
      part_number text,
      quantity integer not null default 1 check (quantity >= 1),
      unit_cents integer not null default 0 check (unit_cents >= 0),
      source_part_rec_id uuid references part_recommendations (id) on delete set null
    );
  `.execute(db);
  await sql`create index repair_estimate_items_estimate_idx on repair_estimate_items (estimate_id);`.execute(
    db,
  );

  await sql`
    create table inventory_items (
      id uuid primary key default gen_random_uuid(),
      shop_id uuid not null references shops (id) on delete cascade,
      name text not null check (char_length(name) between 1 and 300),
      part_number text,
      supplier text,
      cost_cents integer check (cost_cents is null or cost_cents >= 0),
      price_cents integer check (price_cents is null or price_cents >= 0),
      quantity integer not null default 0,
      low_threshold integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`
    create trigger inventory_items_set_updated_at
      before update on inventory_items
      for each row execute function set_updated_at();
  `.execute(db);
  await sql`create index inventory_items_shop_idx on inventory_items (shop_id);`.execute(db);

  await sql`
    create table inventory_movements (
      id uuid primary key default gen_random_uuid(),
      item_id uuid not null references inventory_items (id) on delete cascade,
      job_id uuid references repair_jobs (id) on delete set null,
      delta integer not null,
      reason text not null,
      created_by_user_id uuid references users (id) on delete set null,
      created_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index inventory_movements_item_idx on inventory_movements (item_id, created_at desc);`.execute(
    db,
  );
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists inventory_movements;`.execute(db);
  await sql`drop table if exists inventory_items;`.execute(db);
  await sql`drop table if exists repair_estimate_items;`.execute(db);
  await sql`drop table if exists repair_estimates;`.execute(db);
  await sql`drop table if exists repair_job_events;`.execute(db);
  await sql`drop table if exists repair_jobs;`.execute(db);
  await sql`drop table if exists customer_devices;`.execute(db);
  await sql`drop table if exists shop_customers;`.execute(db);
  await sql`drop table if exists shop_members;`.execute(db);
  await sql`drop table if exists shops;`.execute(db);
}
