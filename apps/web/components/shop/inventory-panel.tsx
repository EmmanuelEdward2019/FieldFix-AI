"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, RotateCcw } from "lucide-react";
import type { InventoryItem, InventoryMovement } from "@fieldfix/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents, isLowStock } from "./shop-ui";
import {
  createInventoryItemApi,
  createInventoryMovementApi,
  describeApiError,
  isAbortError,
  listInventoryApi,
  listInventoryMovementsApi,
  updateInventoryItemApi,
} from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";

/* Inventory tab: items with low-stock flags, editing, stock
 * movements, and per-item movement history. */

function ItemDialog({
  shopId,
  token,
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  shopId: string;
  token: string;
  item: InventoryItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (saved: InventoryItem, created: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [supplier, setSupplier] = useState("");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [threshold, setThreshold] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[] | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(item?.name ?? "");
    setPartNumber(item?.part_number ?? "");
    setSupplier(item?.supplier ?? "");
    setCost(item?.cost_cents != null ? String(item.cost_cents) : "");
    setPrice(item?.price_cents != null ? String(item.price_cents) : "");
    setQuantity("0");
    setThreshold(item ? String(item.low_threshold) : "0");
    setBusy(false);
    setError(null);
    setMovements(null);
    if (item) {
      const controller = new AbortController();
      void listInventoryMovementsApi(shopId, item.id, token, controller.signal).then(
        (res) => setMovements(res.movements),
        () => {
          if (!controller.signal.aborted) {
            setMovements([]);
          }
        },
      );
      return () => controller.abort();
    }
  }, [open, item, shopId, token]);

  const parseOptionalCents = (raw: string): number | null | undefined => {
    if (raw.trim() === "") {
      return null;
    }
    const value = Number.parseInt(raw, 10);
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  };

  const save = () => {
    if (name.trim().length === 0 || busy) {
      return;
    }
    const costCents = parseOptionalCents(cost);
    const priceCents = parseOptionalCents(price);
    if (costCents === undefined || priceCents === undefined) {
      setError("Cost and price must be whole cent amounts of 0 or more.");
      return;
    }
    setBusy(true);
    setError(null);
    if (!item) {
      const qty = Number.parseInt(quantity, 10);
      const low = Number.parseInt(threshold, 10);
      if (!Number.isInteger(qty) || qty < 0 || !Number.isInteger(low) || low < 0) {
        setBusy(false);
        setError("Quantity and low-stock threshold must be 0 or more.");
        return;
      }
      void createInventoryItemApi(shopId, token, {
        name: name.trim(),
        ...(partNumber.trim() ? { part_number: partNumber.trim() } : {}),
        ...(supplier.trim() ? { supplier: supplier.trim() } : {}),
        ...(costCents !== null ? { cost_cents: costCents } : {}),
        ...(priceCents !== null ? { price_cents: priceCents } : {}),
        quantity: qty,
        low_threshold: low,
      }).then(
        (created) => {
          setBusy(false);
          onSaved(created, true);
          onOpenChange(false);
        },
        (err: unknown) => {
          setBusy(false);
          setError(describeApiError(err));
        },
      );
      return;
    }
    const patch: Record<string, string | number | null> = {};
    if (name.trim() !== item.name) {
      patch.name = name.trim();
    }
    const pairs: Array<[string, string | number | null, string | number | null]> = [
      ["part_number", partNumber.trim() === "" ? null : partNumber.trim(), item.part_number],
      ["supplier", supplier.trim() === "" ? null : supplier.trim(), item.supplier],
      ["cost_cents", costCents, item.cost_cents],
      ["price_cents", priceCents, item.price_cents],
    ];
    for (const [key, next, current] of pairs) {
      if (next !== current) {
        patch[key] = next;
      }
    }
    const low = Number.parseInt(threshold, 10);
    if (!Number.isInteger(low) || low < 0) {
      setBusy(false);
      setError("Low-stock threshold must be 0 or more.");
      return;
    }
    if (low !== item.low_threshold) {
      patch.low_threshold = low;
    }
    if (Object.keys(patch).length === 0) {
      setBusy(false);
      setError("No changes to save.");
      return;
    }
    void updateInventoryItemApi(shopId, item.id, token, patch).then(
      (updated) => {
        setBusy(false);
        onSaved(updated, false);
      },
      (err: unknown) => {
        setBusy(false);
        setError(describeApiError(err));
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>{item ? item.name : "New inventory item"}</DialogTitle>
        <DialogDescription>
          {item ? "Edit details or review stock history." : "Opening stock is set once, at creation."}
        </DialogDescription>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="inv-name" className="text-xs font-medium text-slate-400">
              Name
            </label>
            <input
              id="inv-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={300}
              required
              className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="inv-part" className="text-xs font-medium text-slate-400">
                Part number
              </label>
              <input
                id="inv-part"
                type="text"
                value={partNumber}
                onChange={(e) => setPartNumber(e.target.value)}
                maxLength={120}
                className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="inv-supplier" className="text-xs font-medium text-slate-400">
                Supplier
              </label>
              <input
                id="inv-supplier"
                type="text"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                maxLength={200}
                className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="inv-cost" className="text-xs font-medium text-slate-400">
                Cost (cents)
              </label>
              <input
                id="inv-cost"
                inputMode="numeric"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="—"
                className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="inv-price" className="text-xs font-medium text-slate-400">
                Price (cents)
              </label>
              <input
                id="inv-price"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="—"
                className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
              />
            </div>
            {!item && (
              <div className="flex flex-col gap-1">
                <label htmlFor="inv-qty" className="text-xs font-medium text-slate-400">
                  Opening stock
                </label>
                <input
                  id="inv-qty"
                  inputMode="numeric"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
                />
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor="inv-threshold" className="text-xs font-medium text-slate-400">
                Low-stock threshold
              </label>
              <input
                id="inv-threshold"
                inputMode="numeric"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
              />
            </div>
          </div>
          {error != null && (
            <p className="text-xs text-red-300" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={name.trim().length === 0 || busy} onClick={save}>
              {busy ? "Saving…" : item ? "Save changes" : "Create item"}
            </Button>
          </div>
          {item && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">
                Movement history
              </p>
              {movements == null && <Skeleton className="h-12" />}
              {movements != null && movements.length === 0 && (
                <p className="text-xs text-slate-500">No movements recorded.</p>
              )}
              {movements != null && movements.length > 0 && (
                <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                  {movements.map((m) => (
                    <li
                      key={m.id}
                      className="flex flex-wrap items-baseline gap-x-2 rounded-md border border-edge bg-canvas px-2 py-1.5 text-xs"
                    >
                      <span className={m.delta < 0 ? "font-semibold text-amber-300" : "font-semibold text-emerald-300"}>
                        {m.delta > 0 ? `+${m.delta}` : m.delta}
                      </span>
                      <span className="text-slate-300">{m.reason}</span>
                      <span className="ml-auto text-slate-500">{formatRelativeTime(m.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MovementDialog({
  shopId,
  token,
  item,
  open,
  onOpenChange,
  onMoved,
}: {
  shopId: string;
  token: string;
  item: InventoryItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoved: (itemId: string, quantity: number) => void;
}) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDelta("");
      setReason("");
      setBusy(false);
      setError(null);
    }
  }, [open ]);

  const submit = () => {
    if (!item || busy) {
      return;
    }
    const value = Number.parseInt(delta, 10);
    if (!Number.isInteger(value) || value === 0) {
      setError("Enter a non-zero whole number: positive to restock, negative to use.");
      return;
    }
    if (reason.trim().length === 0) {
      setError("A reason is required.");
      return;
    }
    setBusy(true);
    setError(null);
    void createInventoryMovementApi(shopId, item.id, token, {
      delta: value,
      reason: reason.trim(),
    }).then(
      (res) => {
        setBusy(false);
        onMoved(item.id, res.quantity);
        onOpenChange(false);
      },
      (err: unknown) => {
        setBusy(false);
        setError(describeApiError(err));
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Record stock movement</DialogTitle>
        <DialogDescription>
          {item ? `${item.name} — ${item.quantity} in stock.` : ""}
        </DialogDescription>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="mov-delta" className="text-xs font-medium text-slate-400">
              Change in units (negative uses stock)
            </label>
            <input
              id="mov-delta"
              inputMode="numeric"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="e.g. 5 or -2"
              className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="mov-reason" className="text-xs font-medium text-slate-400">
              Reason
            </label>
            <input
              id="mov-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="e.g. supplier delivery, fitted in repair"
              className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
            />
          </div>
          {error != null && (
            <p className="text-xs text-red-300" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={busy} onClick={submit}>
              {busy ? "Recording…" : "Record"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function InventoryPanel({ shopId, token }: { shopId: string; token: string }) {
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<InventoryItem | null>(null);

  const load = useCallback(() => {
    const controller = new AbortController();
    setItems(null);
    setError(null);
    void listInventoryApi(
      shopId,
      token,
      {
        ...(lowStockOnly ? { low_stock: true } : {}),
        ...(submittedSearch.trim() ? { search: submittedSearch.trim() } : {}),
      },
      controller.signal,
    ).then(
      (res) => setItems(res.items),
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setError(describeApiError(err));
        }
      },
    );
    return () => controller.abort();
  }, [shopId, token, lowStockOnly, submittedSearch, reload]);

  useEffect(() => load(), [load]);

  return (
    <div className="flex flex-col gap-3">
      <form
        role="search"
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmittedSearch(search);
        }}
      >
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search inventory…"
          aria-label="Search inventory"
          className="min-w-0 flex-1 rounded-md border border-edge bg-panel px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={(e) => setLowStockOnly(e.target.checked)}
            className="size-4 accent-cyan-400"
          />
          Low stock only
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
        <Button
          type="button"
          onClick={() => {
            setSelected(null);
            setItemDialogOpen(true);
          }}
        >
          <Plus aria-hidden />
          New item
        </Button>
      </form>

      {error != null && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5"
          role="alert"
        >
          <p className="text-sm text-slate-200">Couldn&apos;t load inventory: {error}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => setReload((n) => n + 1)}>
            <RotateCcw aria-hidden />
            Retry
          </Button>
        </div>
      )}

      {items == null && error == null && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading inventory">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}

      {items != null && items.length === 0 && error == null && (
        <div className="rounded-xl border border-dashed border-edge-strong p-6 text-center">
          <p className="text-sm text-slate-300">
            {lowStockOnly ? "Nothing is low on stock." : "No inventory items yet."}
          </p>
        </div>
      )}

      {items != null && items.length > 0 && (
        <ul className="flex flex-col gap-2" role="list">
          {items.map((item) => {
            const low = isLowStock(item.quantity, item.low_threshold);
            return (
              <li key={item.id} className="rounded-xl border border-edge bg-panel p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(item);
                      setItemDialogOpen(true);
                    }}
                    className="min-w-0 flex-1 text-left"
                    aria-label={`Open ${item.name}`}
                  >
                    <span className="block truncate text-sm font-medium text-slate-100">
                      {item.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {[item.part_number, item.supplier].filter(Boolean).join(" · ") || "No part details"}
                      {item.price_cents != null ? ` · sells at ${formatCents(item.price_cents)}` : ""}
                    </span>
                  </button>
                  <span className="flex items-center gap-2">
                    {low ? (
                      <Badge variant="warning">Low stock · {item.quantity}</Badge>
                    ) : (
                      <Badge variant="secondary">{item.quantity} in stock</Badge>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setMoveTarget(item);
                        setMoveDialogOpen(true);
                      }}
                    >
                      Move stock
                    </Button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ItemDialog
        shopId={shopId}
        token={token}
        item={selected}
        open={itemDialogOpen}
        onOpenChange={setItemDialogOpen}
        onSaved={(saved, created) => {
          if (created) {
            setItems((prev) => (prev ? [saved, ...prev] : [saved]));
          } else {
            setItems((prev) => (prev ?? []).map((row) => (row.id === saved.id ? saved : row)));
            setSelected(saved);
          }
        }}
      />
      <MovementDialog
        shopId={shopId}
        token={token}
        item={moveTarget}
        open={moveDialogOpen}
        onOpenChange={setMoveDialogOpen}
        onMoved={(itemId, quantity) =>
          setItems((prev) => (prev ?? []).map((row) => (row.id === itemId ? { ...row, quantity } : row)))
        }
      />
    </div>
  );
}
