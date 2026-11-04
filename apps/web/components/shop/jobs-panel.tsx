"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RotateCcw } from "lucide-react";
import type {
  CustomerDevice,
  DeviceCategory,
  JobPriority,
  JobStatus,
  RepairJob,
  ShopCustomer,
  ShopMember,
} from "@fieldfix/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ACTIVE_JOB_STATUSES,
  ALL_JOB_STATUSES,
  groupJobsByStatus,
  JobCard,
  jobPriorityLabel,
  jobStatusLabel,
} from "./shop-ui";
import {
  createRepairJobApi,
  describeApiError,
  isAbortError,
  listCustomerDevicesApi,
  listRepairJobsApi,
} from "@/lib/api";

/* Jobs tab: filter bar, creation dialog, and a status kanban that
 * scrolls horizontally on small screens. */

export interface JobFilters {
  status: JobStatus | "";
  priority: JobPriority | "";
  assignee: string;
  customer: string;
  category: DeviceCategory | "";
  from: string;
  to: string;
}

export const EMPTY_JOB_FILTERS: JobFilters = {
  status: "",
  priority: "",
  assignee: "",
  customer: "",
  category: "",
  from: "",
  to: "",
};

function deviceLabel(device: CustomerDevice | undefined): string | null {
  if (!device) {
    return null;
  }
  const name = [device.manufacturer, device.model].filter(Boolean).join(" ");
  return name ? `${device.category} · ${name}` : device.category;
}

function NewJobDialog({
  shopId,
  token,
  customers,
  members,
  open,
  onOpenChange,
  onCreated,
}: {
  shopId: string;
  token: string;
  customers: ShopCustomer[];
  members: ShopMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (job: RepairJob) => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [devices, setDevices] = useState<CustomerDevice[]>([]);
  const [reportedFault, setReportedFault] = useState("");
  const [deviceCondition, setDeviceCondition] = useState("");
  const [accessories, setAccessories] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<JobPriority>("normal");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setCustomerId("");
    setDeviceId("");
    setDevices([]);
    setReportedFault("");
    setDeviceCondition("");
    setAccessories("");
    setAssignee("");
    setPriority("normal");
    setSubmitting(false);
    setError(null);
  }, [open ]);

  useEffect(() => {
    setDeviceId("");
    setDevices([]);
    if (!open || !customerId) {
      return;
    }
    const controller = new AbortController();
    void listCustomerDevicesApi(shopId, customerId, token, controller.signal).then(
      (res) => setDevices(res.devices),
      () => setDevices([]),
    );
    return () => controller.abort();
  }, [open, customerId, shopId, token]);

  const submit = () => {
    if (!customerId || reportedFault.trim().length === 0 || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    void createRepairJobApi(shopId, token, {
      customer_id: customerId,
      ...(deviceId ? { device_id: deviceId } : {}),
      reported_fault: reportedFault.trim(),
      ...(deviceCondition.trim() ? { device_condition: deviceCondition.trim() } : {}),
      ...(accessories.trim() ? { accessories: accessories.trim() } : {}),
      ...(assignee ? { assignee_user_id: assignee } : {}),
      priority,
    }).then(
      (job) => {
        setSubmitting(false);
        onCreated(job);
        onOpenChange(false);
      },
      (err: unknown) => {
        setSubmitting(false);
        setError(describeApiError(err));
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>New repair job</DialogTitle>
        <DialogDescription>
          The job reference is generated automatically.
        </DialogDescription>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="job-customer" className="text-xs font-medium text-slate-400">
              Customer
            </label>
            <select
              id="job-customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
              className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
            >
              <option value="">Select a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.reference} — {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="job-device" className="text-xs font-medium text-slate-400">
              Device <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <select
              id="job-device"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              disabled={!customerId}
              className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
            >
              <option value="">No device</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {deviceLabel(d)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="job-fault" className="text-xs font-medium text-slate-400">
              Reported fault
            </label>
            <textarea
              id="job-fault"
              value={reportedFault}
              onChange={(e) => setReportedFault(e.target.value)}
              maxLength={2000}
              rows={3}
              required
              placeholder="What is wrong with the device?"
              className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="job-priority" className="text-xs font-medium text-slate-400">
                Priority
              </label>
              <select
                id="job-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as JobPriority)}
                className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
              >
                {(["low", "normal", "high", "urgent"] as const).map((p) => (
                  <option key={p} value={p}>
                    {jobPriorityLabel(p)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="job-assignee" className="text-xs font-medium text-slate-400">
                Assignee <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <select
                id="job-assignee"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.user_id.slice(0, 8)} · {m.role}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="job-condition" className="text-xs font-medium text-slate-400">
              Device condition <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <input
              id="job-condition"
              type="text"
              value={deviceCondition}
              onChange={(e) => setDeviceCondition(e.target.value)}
              maxLength={2000}
              placeholder="e.g. cracked screen, boots fine"
              className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="job-accessories" className="text-xs font-medium text-slate-400">
              Accessories <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <input
              id="job-accessories"
              type="text"
              value={accessories}
              onChange={(e) => setAccessories(e.target.value)}
              maxLength={2000}
              placeholder="e.g. charger, case"
              className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />
          </div>
          {error != null && (
            <div className="rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5" role="alert">
              <p className="text-sm text-slate-200">{error}</p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!customerId || reportedFault.trim().length === 0 || submitting}
              onClick={submit}
            >
              {submitting ? "Creating…" : "Create job"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function JobsPanel({
  shopId,
  token,
  customers,
  members,
  hazardousJobIds,
  onOpenJob,
  refreshKey,
}: {
  shopId: string;
  token: string;
  customers: ShopCustomer[];
  members: ShopMember[];
  hazardousJobIds: Set<string>;
  onOpenJob: (job: RepairJob) => void;
  refreshKey: number;
}) {
  const [filters, setFilters] = useState<JobFilters>(EMPTY_JOB_FILTERS);
  const [jobs, setJobs] = useState<RepairJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [devicesById, setDevicesById] = useState<Map<string, CustomerDevice>>(new Map());

  const load = useCallback(() => {
    const controller = new AbortController();
    setJobs(null);
    setError(null);
    void listRepairJobsApi(
      shopId,
      token,
      {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.priority ? { priority: filters.priority } : {}),
        ...(filters.assignee ? { assignee: filters.assignee } : {}),
        ...(filters.customer ? { customer: filters.customer } : {}),
        ...(filters.from ? { from: new Date(`${filters.from}T00:00:00.000Z`).toISOString() } : {}),
        ...(filters.to ? { to: new Date(`${filters.to}T23:59:59.999Z`).toISOString() } : {}),
      },
      controller.signal,
    ).then(
      (res) => setJobs(res.jobs),
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setError(describeApiError(err));
        }
      },
    );
    return () => controller.abort();
  }, [shopId, token, filters, reload, refreshKey]);

  useEffect(() => load(), [load]);

  // Device labels + category filter need the shop's devices. Bounded:
  // one request per customer, loaded once per customer list.
  useEffect(() => {
    if (customers.length === 0) {
      setDevicesById(new Map());
      return;
    }
    const controller = new AbortController();
    void Promise.all(
      customers.map((c) =>
        listCustomerDevicesApi(shopId, c.id, token, controller.signal).then(
          (res) => res.devices,
          () => [] as CustomerDevice[],
        ),
      ),
    ).then((lists) => {
      if (controller.signal.aborted) {
        return;
      }
      const map = new Map<string, CustomerDevice>();
      for (const list of lists) {
        for (const device of list) {
          map.set(device.id, device);
        }
      }
      setDevicesById(map);
    });
    return () => controller.abort();
  }, [shopId, token, customers]);

  const customersById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const visibleJobs = useMemo(() => {
    if (!jobs) {
      return null;
    }
    if (!filters.category) {
      return jobs;
    }
    return jobs.filter((job) => {
      if (!job.device_id) {
        return false;
      }
      return devicesById.get(job.device_id)?.category === filters.category;
    });
  }, [jobs, filters.category, devicesById]);

  const columns = useMemo(() => {
    const grouped = groupJobsByStatus(visibleJobs ?? []);
    const wanted = showTerminal ? ALL_JOB_STATUSES : ACTIVE_JOB_STATUSES;
    return grouped.filter((col) => wanted.includes(col.status));
  }, [visibleJobs, showTerminal]);

  const setFilter = <K extends keyof JobFilters>(key: K, value: JobFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const filtersActive =
    filters.status !== "" ||
    filters.priority !== "" ||
    filters.assignee !== "" ||
    filters.customer !== "" ||
    filters.category !== "" ||
    filters.from !== "" ||
    filters.to !== "";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-edge bg-panel p-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="jobs-status" className="text-xs font-medium text-slate-400">
            Status
          </label>
          <select
            id="jobs-status"
            value={filters.status}
            onChange={(e) => setFilter("status", e.target.value as JobStatus | "")}
            className="rounded-md border border-edge bg-canvas px-2 py-1.5 text-sm text-slate-100"
          >
            <option value="">All</option>
            {ALL_JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {jobStatusLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="jobs-priority" className="text-xs font-medium text-slate-400">
            Priority
          </label>
          <select
            id="jobs-priority"
            value={filters.priority}
            onChange={(e) => setFilter("priority", e.target.value as JobPriority | "")}
            className="rounded-md border border-edge bg-canvas px-2 py-1.5 text-sm text-slate-100"
          >
            <option value="">All</option>
            {(["low", "normal", "high", "urgent"] as const).map((p) => (
              <option key={p} value={p}>
                {jobPriorityLabel(p)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="jobs-assignee" className="text-xs font-medium text-slate-400">
            Technician
          </label>
          <select
            id="jobs-assignee"
            value={filters.assignee}
            onChange={(e) => setFilter("assignee", e.target.value)}
            className="rounded-md border border-edge bg-canvas px-2 py-1.5 text-sm text-slate-100"
          >
            <option value="">All</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.user_id.slice(0, 8)} · {m.role}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="jobs-customer" className="text-xs font-medium text-slate-400">
            Customer
          </label>
          <select
            id="jobs-customer"
            value={filters.customer}
            onChange={(e) => setFilter("customer", e.target.value)}
            className="rounded-md border border-edge bg-canvas px-2 py-1.5 text-sm text-slate-100"
          >
            <option value="">All</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.reference} — {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="jobs-category" className="text-xs font-medium text-slate-400">
            Category
          </label>
          <select
            id="jobs-category"
            value={filters.category}
            onChange={(e) => setFilter("category", e.target.value as DeviceCategory | "")}
            className="rounded-md border border-edge bg-canvas px-2 py-1.5 text-sm text-slate-100"
          >
            <option value="">All</option>
            <option value="laptop">Laptop</option>
            <option value="desktop">Desktop</option>
            <option value="smartphone">Smartphone</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="jobs-from" className="text-xs font-medium text-slate-400">
            From
          </label>
          <input
            id="jobs-from"
            type="date"
            value={filters.from}
            onChange={(e) => setFilter("from", e.target.value)}
            className="rounded-md border border-edge bg-canvas px-2 py-1.5 text-sm text-slate-100"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="jobs-to" className="text-xs font-medium text-slate-400">
            To
          </label>
          <input
            id="jobs-to"
            type="date"
            value={filters.to}
            onChange={(e) => setFilter("to", e.target.value)}
            className="rounded-md border border-edge bg-canvas px-2 py-1.5 text-sm text-slate-100"
          />
        </div>
        <div className="flex gap-2">
          {filtersActive && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setFilters(EMPTY_JOB_FILTERS)}>
              Clear
            </Button>
          )}
          <Button type="button" onClick={() => setShowCreate(true)}>
            <Plus aria-hidden />
            New job
          </Button>
        </div>
      </div>

      {error != null && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5"
          role="alert"
        >
          <p className="text-sm text-slate-200">Couldn&apos;t load jobs: {error}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => setReload((n) => n + 1)}>
            <RotateCcw aria-hidden />
            Retry
          </Button>
        </div>
      )}

      {jobs == null && error == null && (
        <div className="flex gap-2 overflow-hidden" role="status" aria-label="Loading jobs">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48 w-64 shrink-0" />
          ))}
        </div>
      )}

      {visibleJobs != null && visibleJobs.length === 0 && error == null && (
        <div className="rounded-xl border border-dashed border-edge-strong p-6 text-center">
          <p className="text-sm text-slate-300">
            {filtersActive ? "No jobs match these filters." : "No jobs yet."}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {filtersActive
              ? "Try clearing a filter."
              : "Create the first job to start tracking repairs."}
          </p>
        </div>
      )}

      {visibleJobs != null && visibleJobs.length > 0 && (
        <>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={showTerminal}
              onChange={(e) => setShowTerminal(e.target.checked)}
              className="size-4 accent-cyan-400"
            />
            Show completed / collected / cancelled columns
          </label>
          <div
            className="flex snap-x gap-2 overflow-x-auto pb-2"
            role="list"
            aria-label="Jobs by status"
          >
            {columns.map((col) => (
              <section
                key={col.status}
                aria-label={`${jobStatusLabel(col.status)} (${col.jobs.length})`}
                className="flex w-64 shrink-0 snap-start flex-col gap-2 rounded-xl border border-edge bg-canvas/50 p-2"
              >
                <h3 className="px-1 text-xs font-semibold tracking-wide text-slate-300 uppercase">
                  {jobStatusLabel(col.status)} · {col.jobs.length}
                </h3>
                {col.jobs.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-edge px-2 py-4 text-center text-xs text-slate-500">
                    Empty
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2" role="list">
                    {col.jobs.map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        customerName={customersById.get(job.customer_id)?.name ?? null}
                        deviceLabel={
                          job.device_id ? deviceLabel(devicesById.get(job.device_id)) : null
                        }
                        hazardous={hazardousJobIds.has(job.id)}
                        onOpen={onOpenJob}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </>
      )}

      <NewJobDialog
        shopId={shopId}
        token={token}
        customers={customers}
        members={members}
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={(job) => setJobs((prev) => (prev ? [job, ...prev] : [job]))}
      />
    </div>
  );
}
