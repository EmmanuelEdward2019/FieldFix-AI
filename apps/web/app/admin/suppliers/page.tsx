"use client";

import { useState } from "react";
import type {
  CreateManualProduct,
  CreateSupplier,
  Supplier,
  SupplierFeedType,
  SupplierProduct,
  SupplierStockStatus,
  UpdateSupplier,
  UpdateSupplierProduct,
} from "@fieldfix/contracts";
import { useAdminAuth, useCan } from "@/components/console/admin-auth";
import { useConsoleFetch } from "@/components/console/use-fetch";
import {
  ConfirmButton,
  EmptyState,
  FilterSelect,
  PAGE_SIZE,
  PageError,
  Pagination,
  SearchInput,
  TextField,
} from "@/components/console/widgets";
import type { ConsoleApi } from "@/lib/console";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError } from "@/lib/api";
import { formatPrice, formatRelativeTime } from "@/lib/format";

const FEED_LABELS: Record<SupplierFeedType, string> = {
  woocommerce_store: "Live store feed",
  manual: "Manual listings",
  link_only: "Outbound links",
};

function FeedBadge({ feed }: { feed: SupplierFeedType }) {
  switch (feed) {
    case "woocommerce_store":
      return <Badge variant="success">{FEED_LABELS[feed]}</Badge>;
    case "manual":
      return <Badge variant="secondary">{FEED_LABELS[feed]}</Badge>;
    default:
      return <Badge variant="muted">{FEED_LABELS[feed]}</Badge>;
  }
}

function StockBadge({ status }: { status: SupplierStockStatus }) {
  switch (status) {
    case "in_stock":
      return <Badge variant="success">In stock</Badge>;
    case "out_of_stock":
      return <Badge variant="danger">Out of stock</Badge>;
    default:
      return <Badge variant="muted">Unknown</Badge>;
  }
}

function toCents(major: string): number | null {
  const trimmed = major.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value * 100);
}

function toMajor(cents: number | null): string {
  return cents === null ? "" : String(cents / 100);
}

function ProductForm({
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: SupplierProduct;
  busy: boolean;
  onSubmit: (input: CreateManualProduct | UpdateSupplierProduct, isEdit: boolean) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [partNumber, setPartNumber] = useState(initial?.part_number ?? "");
  const [price, setPrice] = useState(toMajor(initial?.price_cents ?? null));
  const [currency, setCurrency] = useState(initial?.currency ?? "NGN");
  const [stock, setStock] = useState<SupplierStockStatus>(initial?.stock_status ?? "unknown");
  const [url, setUrl] = useState(initial?.product_url ?? "");
  const [image, setImage] = useState(initial?.image_url ?? "");
  const [formError, setFormError] = useState<string | null>(null);

  function submit() {
    const cents = toCents(price);
    if (price.trim().length > 0 && cents === null) {
      setFormError("Price must be a non-negative amount.");
      return;
    }
    if (currency.trim().length > 0 && !/^[A-Z]{3}$/.test(currency.trim().toUpperCase())) {
      setFormError("Currency must be a 3-letter code such as NGN.");
      return;
    }
    setFormError(null);
    const input = {
      name: name.trim(),
      part_number: partNumber.trim().length > 0 ? partNumber.trim() : null,
      price_cents: cents,
      currency: currency.trim().length > 0 ? currency.trim().toUpperCase() : null,
      stock_status: stock,
      product_url: url.trim(),
      image_url: image.trim().length > 0 ? image.trim() : null,
    };
    onSubmit(input, initial !== undefined);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-edge bg-canvas p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Product name" value={name} onChange={setName} maxLength={500} />
        <TextField label="Part number (optional)" value={partNumber} onChange={setPartNumber} maxLength={120} />
        <TextField label="Price, e.g. 12000.00 (blank = on site)" value={price} onChange={setPrice} />
        <TextField label="Currency" value={currency} onChange={setCurrency} maxLength={3} />
        <TextField label="Product URL" value={url} onChange={setUrl} maxLength={2000} />
        <TextField label="Image URL (optional)" value={image} onChange={setImage} maxLength={2000} />
      </div>
      <FilterSelect
        label="Stock"
        value={stock}
        onChange={(next) => setStock(next as SupplierStockStatus)}
        options={[
          { value: "unknown", label: "Unknown" },
          { value: "in_stock", label: "In stock" },
          { value: "out_of_stock", label: "Out of stock" },
        ]}
      />
      {formError && (
        <p role="alert" className="text-xs text-red-300">
          {formError}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy || name.trim().length === 0 || url.trim().length === 0} onClick={submit}>
          {busy ? "Saving…" : initial ? "Save listing" : "Add listing"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ListingManager({ api, supplier }: { api: ConsoleApi; supplier: Supplier }) {
  const canManage = useCan("suppliers:manage");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<SupplierProduct | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, error, loading, reload } = useConsoleFetch(
    (client, signal) =>
      client.supplierProducts(supplier.id, { limit: PAGE_SIZE, offset, q: query }, signal),
    [supplier.id, offset, query],
  );

  async function save(input: CreateManualProduct | UpdateSupplierProduct, isEdit: boolean) {
    setNotice(null);
    setActionError(null);
    setBusy(true);
    try {
      if (isEdit && editing !== null && editing !== "new") {
        await api.patchSupplierProduct(supplier.id, editing.id, input);
        setNotice("Listing updated.");
      } else {
        await api.createSupplierProduct(supplier.id, input as CreateManualProduct);
        setNotice("Listing added.");
      }
      setEditing(null);
      reload();
    } catch (err) {
      setActionError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(productId: string) {
    setNotice(null);
    setActionError(null);
    setBusy(true);
    try {
      await api.deleteSupplierProduct(supplier.id, productId);
      setNotice("Listing deleted.");
      reload();
    } catch (err) {
      setActionError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-edge pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          label="Search listings"
          value={query}
          placeholder="Name, part no., external id…"
          onChange={(next) => {
            setQuery(next);
            setOffset(0);
          }}
        />
        {canManage && supplier.feed_type === "manual" && editing === null && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setEditing("new")}>
            Add listing
          </Button>
        )}
      </div>
      {notice && (
        <p role="status" className="text-xs text-emerald-300">
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className="text-xs text-red-300">
          {actionError}
        </p>
      )}
      {editing !== null && (
        <ProductForm
          initial={editing === "new" ? undefined : editing}
          busy={busy}
          onSubmit={save}
          onCancel={() => setEditing(null)}
        />
      )}
      {error && <PageError message={error} onRetry={reload} />}
      {loading && (
        <div role="status" aria-label="Loading listings" className="flex flex-col gap-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      )}
      {data && data.products.length === 0 && (
        <EmptyState
          title="No listings"
          hint={
            supplier.feed_type === "woocommerce_store"
              ? "Run a sync to pull this store's catalogue."
              : supplier.feed_type === "manual"
                ? "Add the first listing with the button above."
                : "Link-only suppliers hold no listings; the advisor links out to the store."
          }
        />
      )}
      {data && data.products.length > 0 && (
        <ul className="flex flex-col divide-y divide-edge rounded-lg border border-edge">
          {data.products.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-xs font-medium text-slate-100">{p.name}</p>
                <p className="text-[11px] text-slate-500">
                  {p.part_number ? `${p.part_number} · ` : ""}
                  {formatPrice(p.price_cents, p.currency)}
                  {p.last_seen_at ? ` · verified ${formatRelativeTime(p.last_seen_at)}` : ""}
                </p>
              </div>
              <StockBadge status={p.stock_status} />
              <a
                href={p.product_url}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-cyan-200 underline-offset-2 hover:underline"
              >
                View
              </a>
              {canManage && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(p)}
                  >
                    Edit
                  </Button>
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Delete"
                    busy={busy}
                    onConfirm={() => void remove(p.id)}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && <Pagination total={data.total} offset={offset} onOffset={setOffset} />}
    </div>
  );
}

function AddSupplierForm({ api, onDone }: { api: ConsoleApi; onDone: () => void }) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [feedType, setFeedType] = useState<SupplierFeedType>("link_only");
  const [feedUrl, setFeedUrl] = useState("");
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const input: CreateSupplier = {
        name: name.trim(),
        website_url: website.trim(),
        feed_type: feedType,
        feed_base_url: feedUrl.trim().length > 0 ? feedUrl.trim() : null,
        search_url_template: template.trim().length > 0 ? template.trim() : null,
        sync_enabled: feedType === "woocommerce_store",
      };
      await api.createSupplier(input);
      onDone();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-edge bg-panel p-4">
      <h2 className="text-sm font-semibold text-slate-100">Register supplier</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Store name" value={name} onChange={setName} maxLength={200} />
        <TextField label="Website URL" value={website} onChange={setWebsite} maxLength={2000} />
        <TextField
          label="Feed base URL (live WooCommerce stores)"
          value={feedUrl}
          onChange={setFeedUrl}
          placeholder="https://store.example"
          maxLength={2000}
        />
        <TextField
          label="Search template (use {q} for the query)"
          value={template}
          onChange={setTemplate}
          placeholder="https://store.example/catalog/?q={q}"
          maxLength={2000}
        />
      </div>
      <FilterSelect
        label="Feed type"
        value={feedType}
        onChange={(next) => setFeedType(next as SupplierFeedType)}
        options={[
          { value: "link_only", label: "Outbound links (no listings)" },
          { value: "manual", label: "Manual listings" },
          { value: "woocommerce_store", label: "Live WooCommerce feed" },
        ]}
      />
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy || name.trim().length === 0 || website.trim().length === 0}
          onClick={() => void submit()}
        >
          {busy ? "Registering…" : "Register"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function SupplierCard({ api, supplier }: { api: ConsoleApi; supplier: Supplier }) {
  const canManage = useCan("suppliers:manage");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [syncEnabled, setSyncEnabled] = useState(supplier.sync_enabled);

  async function sync() {
    setNotice(null);
    setActionError(null);
    setBusy(true);
    try {
      const result = await api.syncSupplier(supplier.id);
      setNotice(
        `Synced ${result.fetched} products (${result.created} new, ${result.updated} updated)${result.truncated ? ", catalogue truncated at the page cap" : ""}.`,
      );
    } catch (err) {
      setActionError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleSync(next: boolean) {
    setNotice(null);
    setActionError(null);
    const input: UpdateSupplier = { sync_enabled: next };
    try {
      await api.patchSupplier(supplier.id, input);
      setSyncEnabled(next);
      setNotice(next ? "Sync enabled." : "Sync disabled.");
    } catch (err) {
      setActionError(describeApiError(err));
    }
  }

  async function remove() {
    setNotice(null);
    setActionError(null);
    setBusy(true);
    try {
      await api.deleteSupplier(supplier.id);
      setNotice("Supplier deleted. Reload to refresh the list.");
    } catch (err) {
      setActionError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={`${supplier.name} supplier`} className="rounded-xl border border-edge bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-100">{supplier.name}</h2>
        <FeedBadge feed={supplier.feed_type} />
        <span className="text-[11px] text-slate-500 tabular-nums">
          {supplier.product_count} listing{supplier.product_count === 1 ? "" : "s"}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-slate-500">Website</dt>
          <dd>
            <a
              href={supplier.website_url}
              target="_blank"
              rel="noreferrer"
              className="text-cyan-200 underline-offset-2 hover:underline"
            >
              {supplier.website_url.replace(/^https?:\/\//, "").slice(0, 48)}
            </a>
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Last sync</dt>
          <dd className="text-slate-200">
            {supplier.last_sync_at
              ? `${formatRelativeTime(supplier.last_sync_at)} · ${supplier.last_sync_status ?? "—"}`
              : "Never"}
          </dd>
        </div>
      </dl>
      {supplier.last_sync_status === "failed" && supplier.last_sync_error && (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {supplier.last_sync_error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-2 text-xs text-emerald-300">
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {actionError}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide listings" : "Manage listings"}
        </Button>
        {canManage && supplier.feed_type === "woocommerce_store" && (
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void sync()}>
            {busy ? "Syncing…" : "Sync now"}
          </Button>
        )}
        {canManage && supplier.feed_type === "woocommerce_store" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void toggleSync(!syncEnabled)}
          >
            {syncEnabled ? "Disable sync" : "Enable sync"}
          </Button>
        )}
        {canManage && (
          <ConfirmButton label="Delete" confirmLabel="Delete" busy={busy} onConfirm={() => void remove()} />
        )}
      </div>
      {open && <ListingManager api={api} supplier={supplier} />}
    </section>
  );
}

/** Parts suppliers: live feeds, manual listings, outbound links. */
export default function AdminSuppliersPage() {
  const { api } = useAdminAuth();
  const canManage = useCan("suppliers:manage");
  const [adding, setAdding] = useState(false);
  const { data, error, loading, reload } = useConsoleFetch((client, signal) =>
    client.suppliers(signal),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-50">Parts suppliers</h1>
          <p className="text-xs text-slate-500">
            Live WooCommerce feeds sync prices and stock from the store. Manual listings are keyed
            in by hand. Link-only stores get outbound links with no price claims.
          </p>
        </div>
        {canManage && !adding && (
          <Button type="button" size="sm" onClick={() => setAdding(true)}>
            Register supplier
          </Button>
        )}
      </div>
      {adding && api && (
        <AddSupplierForm
          api={api}
          onDone={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
      {error && <PageError message={error} onRetry={reload} />}
      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading suppliers">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      )}
      {data && data.suppliers.length === 0 && (
        <EmptyState title="No suppliers" hint="Register the first store with the button above." />
      )}
      {data && api && (
        <div className="grid gap-3 xl:grid-cols-2">
          {data.suppliers.map((supplier) => (
            <SupplierCard key={supplier.id} api={api} supplier={supplier} />
          ))}
        </div>
      )}
    </div>
  );
}
