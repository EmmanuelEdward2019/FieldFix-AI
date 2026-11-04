"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, RotateCcw, Store } from "lucide-react";
import type { Shop } from "@fieldfix/contracts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { createShopApi, describeApiError, isAbortError, listShopsApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function ShopCard({ shop }: { shop: Shop }) {
  return (
    <li className="rounded-xl border border-edge bg-panel p-4">
      <Link
        href={`/shop/${shop.id}`}
        className="flex items-start gap-3"
        aria-label={`Open ${shop.name}`}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-edge bg-canvas">
          <Store className="size-5 text-slate-300" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-100">{shop.name}</span>
          {shop.description ? (
            <span className="mt-0.5 block line-clamp-2 text-xs text-slate-400">
              {shop.description}
            </span>
          ) : null}
          <span className="mt-1 block text-xs text-slate-500">
            {[shop.city, shop.region, shop.country].filter(Boolean).join(", ") || "No location set"}
          </span>
        </span>
      </Link>
    </li>
  );
}

export default function ShopListPage() {
  const { token, status } = useAuth();
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") {
      return;
    }
    if (!token) {
      setShops([]);
      return;
    }
    const controller = new AbortController();
    setShops(null);
    setError(null);
    void listShopsApi(token, controller.signal).then(
      (res) => setShops(res.shops),
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setError(describeApiError(err));
        }
      },
    );
    return () => controller.abort();
  }, [token, status, reload]);

  const create = () => {
    if (!token || creating || name.trim().length === 0) {
      return;
    }
    setCreating(true);
    setCreateError(null);
    void createShopApi(
      token,
      {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      },
    ).then(
      (res) => {
        setCreating(false);
        setShops((prev) => (prev ? [res.shop, ...prev] : [res.shop]));
        setName("");
        setDescription("");
        setShowCreate(false);
      },
      (err: unknown) => {
        setCreating(false);
        setCreateError(describeApiError(err));
      },
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50">Repair Shops</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Workshops you belong to — jobs, customers, inventory, and reports live inside each one.
          </p>
        </div>
        <Button type="button" onClick={() => setShowCreate((v) => !v)} disabled={!token}>
          <Plus aria-hidden />
          New shop
        </Button>
      </div>

      {showCreate && (
        <form
          className="flex flex-col gap-2 rounded-xl border border-edge bg-panel p-3"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="shop-name" className="text-xs font-medium text-slate-400">
              Shop name
            </label>
            <input
              id="shop-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
              placeholder="e.g. Downtown Repair Co."
              className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="shop-description" className="text-xs font-medium text-slate-400">
              Description <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <textarea
              id="shop-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="What does this shop do?"
              className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />
          </div>
          {createError != null && (
            <div className="rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5" role="alert">
              <p className="text-sm text-slate-200">{createError}</p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!token || creating || name.trim().length === 0}>
              {creating ? "Creating…" : "Create shop"}
            </Button>
          </div>
        </form>
      )}

      {status === "loading" && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading shops">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}

      {status !== "loading" && !token && (
        <div className="rounded-xl border border-dashed border-edge-strong p-6 text-center">
          <p className="text-sm text-slate-300">Sign in to see your repair shops.</p>
        </div>
      )}

      {error != null && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5"
          role="alert"
        >
          <p className="text-sm text-slate-200">Couldn&apos;t load shops: {error}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => setReload((n) => n + 1)}>
            <RotateCcw aria-hidden />
            Retry
          </Button>
        </div>
      )}

      {token != null && shops == null && error == null && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading shops">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}

      {shops != null && shops.length === 0 && error == null && (
        <div className="rounded-xl border border-dashed border-edge-strong p-6 text-center">
          <p className="text-sm text-slate-300">You don&apos;t belong to any shop yet.</p>
          <p className="mt-1 text-xs text-slate-500">
            Create one above — you&apos;ll become its owner — or ask a shop owner to add you.
          </p>
        </div>
      )}

      {shops != null && shops.length > 0 && (
        <ul className="flex flex-col gap-2" role="list">
          {shops.map((shop) => (
            <ShopCard key={shop.id} shop={shop} />
          ))}
        </ul>
      )}
    </div>
  );
}
