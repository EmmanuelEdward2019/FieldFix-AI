"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, RotateCcw, Search } from "lucide-react";
import type {
  CustomerDevice,
  DeviceCategory,
  ShopCustomer,
} from "@fieldfix/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { CustomerRow } from "./shop-ui";
import {
  createCustomerDeviceApi,
  createShopCustomerApi,
  describeApiError,
  isAbortError,
  listCustomerDevicesApi,
  listShopCustomersApi,
  updateShopCustomerApi,
} from "@/lib/api";

/* Customers tab: searchable list, creation, editing, and devices. */

function CustomerDialog({
  shopId,
  token,
  customer,
  open,
  onOpenChange,
  onSaved,
}: {
  shopId: string;
  token: string;
  customer: ShopCustomer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (saved: ShopCustomer, created: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [devices, setDevices] = useState<CustomerDevice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceCategory, setDeviceCategory] = useState<DeviceCategory>("laptop");
  const [deviceMaker, setDeviceMaker] = useState("");
  const [deviceModel, setDeviceModel] = useState("");
  const [deviceSerial, setDeviceSerial] = useState("");
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(customer?.name ?? "");
    setPhone(customer?.phone ?? "");
    setEmail(customer?.email ?? "");
    setAddress(customer?.address ?? "");
    setNotes(customer?.notes ?? "");
    setDevices(null);
    setBusy(false);
    setError(null);
    setDeviceBusy(false);
    setDeviceError(null);
    if (customer) {
      const controller = new AbortController();
      void listCustomerDevicesApi(shopId, customer.id, token, controller.signal).then(
        (res) => setDevices(res.devices),
        () => {
          if (!controller.signal.aborted) {
            setDevices([]);
          }
        },
      );
      return () => controller.abort();
    }
  }, [open, customer, shopId, token]);

  const save = () => {
    if (name.trim().length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const optional = {
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(address.trim() ? { address: address.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    if (!customer) {
      void createShopCustomerApi(shopId, token, { name: name.trim(), ...optional }).then(
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
    const patch: Record<string, string | null> = {};
    if (name.trim() !== customer.name) {
      patch.name = name.trim();
    }
    const pairs: Array<[string, string, string | null]> = [
      ["phone", phone.trim(), customer.phone],
      ["email", email.trim(), customer.email],
      ["address", address.trim(), customer.address],
      ["notes", notes.trim(), customer.notes],
    ];
    for (const [key, next, current] of pairs) {
      const value = next === "" ? null : next;
      if (value !== current) {
        patch[key] = value;
      }
    }
    if (Object.keys(patch).length === 0) {
      setBusy(false);
      setError("No changes to save.");
      return;
    }
    void updateShopCustomerApi(shopId, customer.id, token, patch).then(
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

  const addDevice = () => {
    if (!customer || deviceBusy) {
      return;
    }
    setDeviceBusy(true);
    setDeviceError(null);
    void createCustomerDeviceApi(shopId, customer.id, token, {
      category: deviceCategory,
      ...(deviceMaker.trim() ? { manufacturer: deviceMaker.trim() } : {}),
      ...(deviceModel.trim() ? { model: deviceModel.trim() } : {}),
      ...(deviceSerial.trim() ? { serial_imei: deviceSerial.trim() } : {}),
    }).then(
      (created) => {
        setDeviceBusy(false);
        setDevices((prev) => (prev ? [...prev, created] : [created]));
        setDeviceMaker("");
        setDeviceModel("");
        setDeviceSerial("");
        onSaved(customer, false);
      },
      (err: unknown) => {
        setDeviceBusy(false);
        setDeviceError(describeApiError(err));
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>{customer ? `Customer ${customer.reference}` : "New customer"}</DialogTitle>
        <DialogDescription>
          {customer
            ? "Edit contact details or register a device."
            : "The customer reference is generated automatically."}
        </DialogDescription>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="cust-name" className="text-xs font-medium text-slate-400">
              Name
            </label>
            <input
              id="cust-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
              className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="cust-phone" className="text-xs font-medium text-slate-400">
                Phone
              </label>
              <input
                id="cust-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={60}
                className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="cust-email" className="text-xs font-medium text-slate-400">
                Email
              </label>
              <input
                id="cust-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={320}
                className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="cust-address" className="text-xs font-medium text-slate-400">
              Address
            </label>
            <input
              id="cust-address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={500}
              className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="cust-notes" className="text-xs font-medium text-slate-400">
              Notes
            </label>
            <textarea
              id="cust-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              rows={2}
              className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
            />
          </div>
          {error != null && (
            <p className="text-xs text-red-300" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={name.trim().length === 0 || busy}
              onClick={save}
            >
              {busy ? "Saving…" : customer ? "Save changes" : "Create customer"}
            </Button>
          </div>

          {customer && (
            <div className="flex flex-col gap-2 rounded-lg border border-edge bg-canvas p-3">
              <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">Devices</p>
              {devices == null && <Skeleton className="h-10" />}
              {devices != null && devices.length === 0 && (
                <p className="text-xs text-slate-500">No devices registered.</p>
              )}
              {devices != null && devices.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {devices.map((d) => (
                    <li key={d.id} className="text-xs text-slate-300">
                      <span className="font-medium">{d.category}</span>
                      {[d.manufacturer, d.model].filter(Boolean).length > 0
                        ? ` · ${[d.manufacturer, d.model].filter(Boolean).join(" ")}`
                        : ""}
                      {d.serial_imei ? ` · ${d.serial_imei}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <select
                  value={deviceCategory}
                  onChange={(e) => setDeviceCategory(e.target.value as DeviceCategory)}
                  aria-label="Device category"
                  className="rounded-md border border-edge bg-panel px-2 py-1.5 text-xs text-slate-100"
                >
                  <option value="laptop">Laptop</option>
                  <option value="desktop">Desktop</option>
                  <option value="smartphone">Smartphone</option>
                </select>
                <input
                  value={deviceMaker}
                  onChange={(e) => setDeviceMaker(e.target.value)}
                  placeholder="Maker (optional)"
                  aria-label="Manufacturer"
                  className="rounded-md border border-edge bg-panel px-2 py-1.5 text-xs text-slate-100"
                />
                <input
                  value={deviceModel}
                  onChange={(e) => setDeviceModel(e.target.value)}
                  placeholder="Model (optional)"
                  aria-label="Model"
                  className="rounded-md border border-edge bg-panel px-2 py-1.5 text-xs text-slate-100"
                />
                <input
                  value={deviceSerial}
                  onChange={(e) => setDeviceSerial(e.target.value)}
                  placeholder="Serial/IMEI (optional)"
                  aria-label="Serial or IMEI"
                  className="rounded-md border border-edge bg-panel px-2 py-1.5 text-xs text-slate-100"
                />
              </div>
              {deviceError != null && (
                <p className="text-xs text-red-300" role="alert">
                  {deviceError}
                </p>
              )}
              <div className="flex justify-end">
                <Button type="button" variant="secondary" size="sm" disabled={deviceBusy} onClick={addDevice}>
                  {deviceBusy ? "Adding…" : "Add device"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CustomersPanel({
  shopId,
  token,
  customers,
  onCustomersChange,
}: {
  shopId: string;
  token: string;
  customers: ShopCustomer[] | null;
  onCustomersChange: (customers: ShopCustomer[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<ShopCustomer | null>(null);

  const load = useCallback(() => {
    const controller = new AbortController();
    onCustomersChange([]);
    setError(null);
    void listShopCustomersApi(
      shopId,
      token,
      submittedSearch.trim() || undefined,
      controller.signal,
    ).then(
      (res) => onCustomersChange(res.customers),
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setError(describeApiError(err));
        }
      },
    );
    return () => controller.abort();
  }, [shopId, token, submittedSearch, reload]);

  useEffect(() => load(), [load]);

  const openCustomer = (customer: ShopCustomer) => {
    setSelected(customer);
    setDialogOpen(true);
  };

  return (
    <div className="flex flex-col gap-3">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmittedSearch(search);
        }}
      >
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customers by name…"
          aria-label="Search customers"
          className="min-w-0 flex-1 rounded-md border border-edge bg-panel px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
        />
        <Button type="submit" variant="secondary">
          <Search aria-hidden />
          Search
        </Button>
        <Button
          type="button"
          onClick={() => {
            setSelected(null);
            setDialogOpen(true);
          }}
        >
          <Plus aria-hidden />
          New customer
        </Button>
      </form>

      {error != null && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5"
          role="alert"
        >
          <p className="text-sm text-slate-200">Couldn&apos;t load customers: {error}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => setReload((n) => n + 1)}>
            <RotateCcw aria-hidden />
            Retry
          </Button>
        </div>
      )}

      {customers == null && error == null && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading customers">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}

      {customers != null && customers.length === 0 && error == null && (
        <div className="rounded-xl border border-dashed border-edge-strong p-6 text-center">
          <p className="text-sm text-slate-300">
            {submittedSearch ? "No customers match this search." : "No customers yet."}
          </p>
        </div>
      )}

      {customers != null && customers.length > 0 && (
        <ul className="flex flex-col gap-2" role="list">
          {customers.map((customer) => (
            <CustomerRow
              key={customer.id}
              customer={customer}
              deviceCount={null}
              onOpen={openCustomer}
            />
          ))}
        </ul>
      )}

      <CustomerDialog
        shopId={shopId}
        token={token}
        customer={selected}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={(saved, created) => {
          if (created) {
            onCustomersChange([saved, ...(customers ?? [])]);
          } else {
            onCustomersChange((customers ?? []).map((c) => (c.id === saved.id ? saved : c)));
            setSelected(saved);
          }
        }}
      />
    </div>
  );
}
