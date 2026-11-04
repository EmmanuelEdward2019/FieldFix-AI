"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, RotateCcw } from "lucide-react";
import type {
  EstimateItemInput,
  EstimateStatus,
  InventoryItem,
  JobPriority,
  JobStatus,
  PartRecommendation,
  RepairEstimateItem,
  RepairJob,
  RepairJobEvent,
  SafetyState,
  ShopMember,
  RepairEstimateResponse,
} from "@fieldfix/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ALL_JOB_STATUSES,
  EstimateStatusBadge,
  estimateGrandTotalCents,
  estimateStatusLabel,
  formatCents,
  JobEventRow,
  jobPriorityLabel,
  JobPriorityBadge,
  jobStatusLabel,
  JobStatusBadge,
  SafetyWarningBanner,
} from "./shop-ui";
import {
  attachJobSessionApi,
  convertEstimateApi,
  createEstimateApi,
  createInventoryMovementApi,
  createJobEventApi,
  describeApiError,
  detachJobSessionApi,
  getRepairJobDetailApi,
  isAbortError,
  listEstimatesApi,
  listInventoryApi,
  listJobEventsApi,
  listPartRecommendationsApi,
  updateEstimateApi,
  updateRepairJobApi,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

/* Job detail dialog: field editing, status timeline + notes, session
 * link with safety display, estimates with parts-advisor import, and
 * inventory use against the job. */

function uuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function EstimateCard({
  shopId,
  jobId,
  token,
  bundle,
  onChanged,
}: {
  shopId: string;
  jobId: string;
  token: string;
  bundle: RepairEstimateResponse;
  onChanged: (updated: RepairEstimateResponse) => void;
}) {
  const { estimate, items } = bundle;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setStatus = (status: EstimateStatus) => {
    if (busy || status === estimate.status) {
      return;
    }
    setBusy(true);
    setError(null);
    void updateEstimateApi(shopId, jobId, estimate.id, token, { status }).then(
      (updated) => {
        setBusy(false);
        onChanged(updated);
      },
      (err: unknown) => {
        setBusy(false);
        setError(describeApiError(err));
      },
    );
  };

  const convert = () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    void convertEstimateApi(shopId, jobId, estimate.id, token).then(
      (updated) => {
        setBusy(false);
        onChanged(updated);
      },
      (err: unknown) => {
        setBusy(false);
        setError(describeApiError(err));
      },
    );
  };

  const total = estimateGrandTotalCents({
    items,
    labor_cents: estimate.labor_cents,
    other_cents: estimate.other_cents,
  });
  const editable = estimate.status === "draft";

  return (
    <li className="rounded-lg border border-edge bg-canvas p-3">
      <div className="flex flex-wrap items-center gap-2">
        <EstimateStatusBadge status={estimate.status} />
        <span className="text-sm font-semibold text-slate-100">
          {formatCents(total, estimate.currency)}
        </span>
        <span className="ml-auto text-xs text-slate-500">{formatDateTime(estimate.created_at)}</span>
      </div>
      {estimate.diagnosis_summary && (
        <p className="mt-1.5 text-sm text-slate-300">Diagnosis: {estimate.diagnosis_summary}</p>
      )}
      {estimate.recommended_repair && (
        <p className="mt-0.5 text-sm text-slate-300">Repair: {estimate.recommended_repair}</p>
      )}
      {items.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {items.map((item: RepairEstimateItem) => (
            <li key={item.id} className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-400">
              <Badge variant="muted">{item.kind}</Badge>
              <span className="text-slate-300">{item.description}</span>
              {item.part_number && <span>· {item.part_number}</span>}
              <span className="ml-auto text-slate-300">
                {item.quantity} × {formatCents(item.unit_cents, estimate.currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-xs text-slate-500">
        Labor {formatCents(estimate.labor_cents, estimate.currency)} · Other{" "}
        {formatCents(estimate.other_cents, estimate.currency)}
        {estimate.validity_days ? ` · valid ${estimate.validity_days} days` : ""}
      </p>
      {error != null && (
        <p className="mt-1.5 text-xs text-red-300" role="alert">
          {error}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {editable && (
          <>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setStatus("sent")}>
              Mark sent
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setStatus("approved")}>
              Approve
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setStatus("rejected")}>
              Reject
            </Button>
          </>
        )}
        {estimate.status === "sent" && (
          <>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setStatus("approved")}>
              Approve
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setStatus("rejected")}>
              Reject
            </Button>
          </>
        )}
        {estimate.status === "approved" && (
          <Button type="button" size="sm" disabled={busy} onClick={convert}>
            {busy ? "Converting…" : "Convert to job"}
          </Button>
        )}
      </div>
      {!editable && estimate.status !== "sent" && estimate.status !== "approved" && (
        <p className="mt-1.5 text-xs text-slate-500">
          {estimateStatusLabel(estimate.status)} estimates are read-only.
        </p>
      )}
    </li>
  );
}

interface DraftItem {
  key: number;
  kind: "part" | "labor" | "other";
  description: string;
  part_number: string;
  quantity: string;
  unit_cents: string;
  source_part_rec_id: string | null;
}

let draftKey = 0;

function EstimateBuilder({
  shopId,
  jobId,
  token,
  sessionId,
  onCreated,
}: {
  shopId: string;
  jobId: string;
  token: string;
  sessionId: string | null;
  onCreated: (bundle: RepairEstimateResponse) => void;
}) {
  const [open, setOpen] = useState(false);
  const [diagnosis, setDiagnosis] = useState("");
  const [repair, setRepair] = useState("");
  const [labor, setLabor] = useState("");
  const [other, setOther] = useState("");
  const [validity, setValidity] = useState("");
  const [terms, setTerms] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [advisorParts, setAdvisorParts] = useState<PartRecommendation[] | null>(null);
  const [advisorError, setAdvisorError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !sessionId) {
      setAdvisorParts(sessionId ? null : []);
      return;
    }
    const controller = new AbortController();
    setAdvisorParts(null);
    setAdvisorError(null);
    void listPartRecommendationsApi(sessionId, token, controller.signal).then(
      (res) => setAdvisorParts(res.recommendations),
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setAdvisorError(describeApiError(err));
          setAdvisorParts([]);
        }
      },
    );
    return () => controller.abort();
  }, [open, sessionId, token]);

  const addBlankItem = () => {
    draftKey += 1;
    setItems((prev) => [
      ...prev,
      {
        key: draftKey,
        kind: "part",
        description: "",
        part_number: "",
        quantity: "1",
        unit_cents: "0",
        source_part_rec_id: null,
      },
    ]);
  };

  const addAdvisorPart = (part: PartRecommendation) => {
    draftKey += 1;
    setItems((prev) => [
      ...prev,
      {
        key: draftKey,
        kind: "part",
        description: part.part_name,
        part_number: part.part_number ?? "",
        quantity: "1",
        unit_cents: "0",
        source_part_rec_id: part.id,
      },
    ]);
  };

  const patchItem = (key: number, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const removeItem = (key: number) => {
    setItems((prev) => prev.filter((item) => item.key !== key));
  };

  const toInput = (item: DraftItem): EstimateItemInput | null => {
    const quantity = Number.parseInt(item.quantity, 10);
    const unit = Number.parseInt(item.unit_cents, 10);
    if (!item.description.trim() || !Number.isInteger(quantity) || quantity < 1 || !Number.isInteger(unit) || unit < 0) {
      return null;
    }
    return {
      kind: item.kind,
      description: item.description.trim(),
      ...(item.part_number.trim() ? { part_number: item.part_number.trim() } : {}),
      quantity,
      unit_cents: unit,
      ...(item.source_part_rec_id ? { source_part_rec_id: item.source_part_rec_id } : {}),
    };
  };

  const submit = () => {
    const parsed: EstimateItemInput[] = [];
    for (const item of items) {
      const input = toInput(item);
      if (!input) {
        setError("Each line item needs a description, a quantity of at least 1, and a unit price of 0 or more (cents).");
        return;
      }
      parsed.push(input);
    }
    const laborCents = labor.trim() === "" ? 0 : Number.parseInt(labor, 10);
    const otherCents = other.trim() === "" ? 0 : Number.parseInt(other, 10);
    if (!Number.isInteger(laborCents) || laborCents < 0 || !Number.isInteger(otherCents) || otherCents < 0) {
      setError("Labor and other charges must be whole cent amounts of 0 or more.");
      return;
    }
    const validityDays = validity.trim() === "" ? null : Number.parseInt(validity, 10);
    if (validityDays !== null && (!Number.isInteger(validityDays) || validityDays < 1)) {
      setError("Validity must be at least 1 day.");
      return;
    }
    setBusy(true);
    setError(null);
    void createEstimateApi(shopId, jobId, token, {
      ...(diagnosis.trim() ? { diagnosis_summary: diagnosis.trim() } : {}),
      ...(repair.trim() ? { recommended_repair: repair.trim() } : {}),
      labor_cents: laborCents,
      other_cents: otherCents,
      currency: "USD",
      ...(validityDays !== null ? { validity_days: validityDays } : {}),
      ...(terms.trim() ? { terms: terms.trim() } : {}),
      items: parsed,
    }).then(
      (bundle) => {
        setBusy(false);
        setOpen(false);
        setDiagnosis("");
        setRepair("");
        setLabor("");
        setOther("");
        setValidity("");
        setTerms("");
        setItems([]);
        onCreated(bundle);
      },
      (err: unknown) => {
        setBusy(false);
        setError(describeApiError(err));
      },
    );
  };

  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Draft estimate
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-edge bg-canvas p-3">
      <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">New estimate</p>
      <textarea
        value={diagnosis}
        onChange={(e) => setDiagnosis(e.target.value)}
        rows={2}
        maxLength={4000}
        placeholder="Diagnosis summary (optional)"
        aria-label="Diagnosis summary"
        className="rounded-md border border-edge bg-panel px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
      />
      <textarea
        value={repair}
        onChange={(e) => setRepair(e.target.value)}
        rows={2}
        maxLength={4000}
        placeholder="Recommended repair (optional)"
        aria-label="Recommended repair"
        className="rounded-md border border-edge bg-panel px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
      />
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500" htmlFor={`est-labor-${jobId}`}>
            Labor (cents)
          </label>
          <input
            id={`est-labor-${jobId}`}
            inputMode="numeric"
            value={labor}
            onChange={(e) => setLabor(e.target.value)}
            placeholder="0"
            className="rounded-md border border-edge bg-panel px-2 py-1.5 text-sm text-slate-100"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500" htmlFor={`est-other-${jobId}`}>
            Other (cents)
          </label>
          <input
            id={`est-other-${jobId}`}
            inputMode="numeric"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder="0"
            className="rounded-md border border-edge bg-panel px-2 py-1.5 text-sm text-slate-100"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500" htmlFor={`est-validity-${jobId}`}>
            Valid (days)
          </label>
          <input
            id={`est-validity-${jobId}`}
            inputMode="numeric"
            value={validity}
            onChange={(e) => setValidity(e.target.value)}
            placeholder="—"
            className="rounded-md border border-edge bg-panel px-2 py-1.5 text-sm text-slate-100"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-slate-400">Line items</p>
        {sessionId == null && (
          <p className="text-xs text-slate-500">
            Link a diagnostic session to import parts from its advisor.
          </p>
        )}
        {sessionId != null && advisorParts == null && advisorError == null && (
          <Skeleton className="h-8" />
        )}
        {advisorError != null && (
          <p className="text-xs text-amber-300" role="alert">
            Couldn&apos;t load advisor parts: {advisorError}
          </p>
        )}
        {advisorParts != null && advisorParts.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-slate-500">From the parts advisor:</p>
            {advisorParts.map((part) => {
              const added = items.some((i) => i.source_part_rec_id === part.id);
              return (
                <div key={part.id} className="flex items-center gap-2 text-xs text-slate-300">
                  <span className="min-w-0 flex-1 truncate">
                    {part.part_name}
                    {part.part_number ? ` · ${part.part_number}` : ""}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={added}
                    onClick={() => addAdvisorPart(part)}
                  >
                    {added ? "Added" : "Add"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        {items.map((item) => (
          <div key={item.key} className="flex flex-col gap-1 rounded-md border border-edge p-2">
            <div className="flex gap-1.5">
              <select
                value={item.kind}
                onChange={(e) => patchItem(item.key, { kind: e.target.value as DraftItem["kind"] })}
                aria-label="Item kind"
                className="rounded-md border border-edge bg-panel px-2 py-1.5 text-xs text-slate-100"
              >
                <option value="part">Part</option>
                <option value="labor">Labor</option>
                <option value="other">Other</option>
              </select>
              <input
                value={item.description}
                onChange={(e) => patchItem(item.key, { description: e.target.value })}
                placeholder="Description"
                aria-label="Item description"
                className="min-w-0 flex-1 rounded-md border border-edge bg-panel px-2 py-1.5 text-xs text-slate-100"
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(item.key)} aria-label="Remove item">
                ✕
              </Button>
            </div>
            <div className="flex gap-1.5">
              <input
                value={item.part_number}
                onChange={(e) => patchItem(item.key, { part_number: e.target.value })}
                placeholder="Part no. (optional)"
                aria-label="Part number"
                className="min-w-0 flex-1 rounded-md border border-edge bg-panel px-2 py-1.5 text-xs text-slate-100"
              />
              <input
                value={item.quantity}
                onChange={(e) => patchItem(item.key, { quantity: e.target.value })}
                placeholder="Qty"
                aria-label="Quantity"
                inputMode="numeric"
                className="w-16 rounded-md border border-edge bg-panel px-2 py-1.5 text-xs text-slate-100"
              />
              <input
                value={item.unit_cents}
                onChange={(e) => patchItem(item.key, { unit_cents: e.target.value })}
                placeholder="Unit ¢"
                aria-label="Unit price in cents"
                inputMode="numeric"
                className="w-24 rounded-md border border-edge bg-panel px-2 py-1.5 text-xs text-slate-100"
              />
            </div>
            {item.source_part_rec_id && (
              <p className="text-[11px] text-cyan-300/80">Linked to an advisor part suggestion</p>
            )}
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" onClick={addBlankItem}>
          Add line item
        </Button>
      </div>

      {error != null && (
        <p className="text-xs text-red-300" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={busy} onClick={submit}>
          {busy ? "Saving…" : "Save draft"}
        </Button>
      </div>
    </div>
  );
}

function InventoryUseForm({
  shopId,
  jobId,
  token,
  onUsed,
}: {
  shopId: string;
  jobId: string;
  token: string;
  onUsed: (notice: string) => void;
}) {
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void listInventoryApi(shopId, token, {}, controller.signal).then(
      (res) => setItems(res.items),
      () => setItems([]),
    );
    return () => controller.abort();
  }, [shopId, token]);

  const submit = () => {
    const qty = Number.parseInt(quantity, 10);
    if (!itemId || !Number.isInteger(qty) || qty < 1 || reason.trim().length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    void createInventoryMovementApi(shopId, itemId, token, {
      delta: -qty,
      job_id: jobId,
      reason: reason.trim(),
    }).then(
      (res) => {
        setBusy(false);
        setQuantity("1");
        setReason("");
        onUsed(`Used ${qty} unit${qty === 1 ? "" : "s"} — ${res.quantity} left in stock.`);
      },
      (err: unknown) => {
        setBusy(false);
        setError(describeApiError(err));
      },
    );
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-edge bg-canvas p-3">
      <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">
        Use inventory for this job
      </p>
      {items == null && <Skeleton className="h-9" />}
      {items != null && (
        <select
          value={itemId}
          onChange={(e) => setItemId(e.target.value)}
          aria-label="Inventory item"
          className="rounded-md border border-edge bg-panel px-3 py-2 text-sm text-slate-100"
        >
          <option value="">Select an item…</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} — {item.quantity} in stock
            </option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        <input
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          inputMode="numeric"
          aria-label="Quantity to use"
          placeholder="Qty"
          className="w-20 rounded-md border border-edge bg-panel px-3 py-2 text-sm text-slate-100"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          aria-label="Reason"
          placeholder="Reason, e.g. fitted screen"
          className="min-w-0 flex-1 rounded-md border border-edge bg-panel px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
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
          disabled={!itemId || reason.trim().length === 0 || busy}
          onClick={submit}
        >
          {busy ? "Recording…" : "Record use"}
        </Button>
      </div>
    </div>
  );
}

export function JobDetailDialog({
  shopId,
  token,
  job,
  members,
  customerName,
  open,
  onOpenChange,
  onJobChanged,
  onHazardChange,
}: {
  shopId: string;
  token: string;
  job: RepairJob | null;
  members: ShopMember[];
  customerName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJobChanged: (job: RepairJob) => void;
  onHazardChange: (jobId: string, hazardous: boolean) => void;
}) {
  const [detail, setDetail] = useState<RepairJob | null>(null);
  const [safety, setSafety] = useState<SafetyState | null>(null);
  const [events, setEvents] = useState<RepairJobEvent[] | null>(null);
  const [estimates, setEstimates] = useState<RepairEstimateResponse[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editFault, setEditFault] = useState("");
  const [editCondition, setEditCondition] = useState("");
  const [editAccessories, setEditAccessories] = useState("");
  const [editPriority, setEditPriority] = useState<JobPriority>("normal");
  const [editAssignee, setEditAssignee] = useState("");
  const [editStatus, setEditStatus] = useState<JobStatus>("received");
  const [sessionInput, setSessionInput] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !job) {
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setSafety(null);
    setEvents(null);
    setEstimates(null);
    setLoadError(null);
    setNote("");
    setNoteError(null);
    setEditError(null);
    setSessionError(null);
    setNotice(null);
    void getRepairJobDetailApi(shopId, job.id, token, controller.signal).then(
      (res) => {
        setDetail(res.job);
        setSafety(res.session_safety_state);
        onHazardChange(
          res.job.id,
          res.session_safety_state === "critical_stop" || res.session_safety_state === "caution",
        );
        setEditFault(res.job.reported_fault);
        setEditCondition(res.job.device_condition ?? "");
        setEditAccessories(res.job.accessories ?? "");
        setEditPriority(res.job.priority);
        setEditAssignee(res.job.assignee_user_id ?? "");
        setEditStatus(res.job.status);
        setSessionInput("");
      },
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setLoadError(describeApiError(err));
        }
      },
    );
    void listJobEventsApi(shopId, job.id, token, controller.signal).then(
      (res) => setEvents(res.events),
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setEvents([]);
          setLoadError((prev) => prev ?? describeApiError(err));
        }
      },
    );
    void listEstimatesApi(shopId, job.id, token, controller.signal).then(
      (res) => setEstimates(res.estimates),
      () => {
        if (!controller.signal.aborted) {
          setEstimates([]);
        }
      },
    );
    return () => controller.abort();
  }, [open, job?.id, shopId, token, reload]);

  if (!job) {
    return null;
  }

  const saveEdits = () => {
    if (!detail || editBusy) {
      return;
    }
    const patch: Parameters<typeof updateRepairJobApi>[3] = {};
    if (editStatus !== detail.status) {
      patch.status = editStatus;
    }
    if (editPriority !== detail.priority) {
      patch.priority = editPriority;
    }
    const assignee = editAssignee === "" ? null : editAssignee;
    if (assignee !== detail.assignee_user_id) {
      patch.assignee_user_id = assignee;
    }
    if (editFault.trim() !== detail.reported_fault) {
      if (editFault.trim().length === 0) {
        setEditError("The reported fault cannot be empty.");
        return;
      }
      patch.reported_fault = editFault.trim();
    }
    const condition = editCondition.trim() === "" ? null : editCondition.trim();
    if (condition !== detail.device_condition) {
      patch.device_condition = condition;
    }
    const acc = editAccessories.trim() === "" ? null : editAccessories.trim();
    if (acc !== detail.accessories) {
      patch.accessories = acc;
    }
    if (Object.keys(patch).length === 0) {
      setEditError("No changes to save.");
      return;
    }
    setEditBusy(true);
    setEditError(null);
    void updateRepairJobApi(shopId, detail.id, token, patch).then(
      (updated) => {
        setEditBusy(false);
        setDetail(updated);
        onJobChanged(updated);
        setNotice("Job updated.");
        void listJobEventsApi(shopId, updated.id, token).then(
          (res) => setEvents(res.events),
          () => undefined,
        );
      },
      (err: unknown) => {
        setEditBusy(false);
        setEditError(describeApiError(err));
      },
    );
  };

  const addNote = () => {
    if (!detail || note.trim().length === 0 || noteBusy) {
      return;
    }
    setNoteBusy(true);
    setNoteError(null);
    void createJobEventApi(shopId, detail.id, token, {
      kind: "note",
      body: note.trim(),
    }).then(
      (created) => {
        setNoteBusy(false);
        setNote("");
        setEvents((prev) => (prev ? [...prev, created] : [created]));
      },
      (err: unknown) => {
        setNoteBusy(false);
        setNoteError(describeApiError(err));
      },
    );
  };

  const attachSession = () => {
    if (!detail || sessionBusy) {
      return;
    }
    if (!uuidLike(sessionInput)) {
      setSessionError("Enter the session id (UUID) from the diagnostics page.");
      return;
    }
    setSessionBusy(true);
    setSessionError(null);
    void attachJobSessionApi(shopId, detail.id, token, { session_id: sessionInput.trim() }).then(
      (updated) => {
        setSessionBusy(false);
        setDetail(updated);
        onJobChanged(updated);
        setReload((n) => n + 1);
      },
      (err: unknown) => {
        setSessionBusy(false);
        setSessionError(describeApiError(err));
      },
    );
  };

  const detachSession = () => {
    if (!detail || sessionBusy) {
      return;
    }
    setSessionBusy(true);
    setSessionError(null);
    void detachJobSessionApi(shopId, detail.id, token).then(
      (updated) => {
        setSessionBusy(false);
        setDetail(updated);
        setSafety(null);
        onJobChanged(updated);
        onHazardChange(updated.id, false);
      },
      (err: unknown) => {
        setSessionBusy(false);
        setSessionError(describeApiError(err));
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-2xl">
        <DialogTitle>Job {job.job_reference}</DialogTitle>
        <DialogDescription>
          {customerName ?? "Unknown customer"} · received {formatDateTime(job.received_at)}
        </DialogDescription>

        {loadError != null && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5"
            role="alert"
          >
            <p className="text-sm text-slate-200">Couldn&apos;t load job details: {loadError}</p>
            <Button type="button" variant="secondary" size="sm" onClick={() => setReload((n) => n + 1)}>
              <RotateCcw aria-hidden />
              Retry
            </Button>
          </div>
        )}

        {detail == null && loadError == null && (
          <div className="flex flex-col gap-2" role="status" aria-label="Loading job">
            <Skeleton className="h-16" />
            <Skeleton className="h-32" />
          </div>
        )}

        {detail != null && (
          <div className="flex flex-col gap-3">
            {notice != null && (
              <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-3 py-2 text-sm text-slate-200" role="status">
                {notice}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <JobStatusBadge status={detail.status} />
              <JobPriorityBadge priority={detail.priority} />
              {safety != null && (
                <Badge variant={safety === "normal" ? "success" : safety === "review_required" ? "warning" : "danger"}>
                  Session: {safety.replace(/_/g, " ")}
                </Badge>
              )}
            </div>

            <SafetyWarningBanner state={safety} />

            <section aria-label="Linked session" className="flex flex-col gap-2 rounded-lg border border-edge bg-canvas p-3">
              <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">
                Linked diagnostic session
              </p>
              {detail.session_id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/diagnostics/${detail.session_id}`}
                    className="inline-flex items-center gap-1 text-sm text-cyan-300 hover:text-cyan-200 hover:underline"
                  >
                    Open session {detail.session_id.slice(0, 8)}
                    <ExternalLink className="size-3.5" aria-hidden />
                  </Link>
                  <Button type="button" variant="secondary" size="sm" disabled={sessionBusy} onClick={detachSession}>
                    Unlink
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5 sm:flex-row">
                  <input
                    value={sessionInput}
                    onChange={(e) => setSessionInput(e.target.value)}
                    placeholder="Session id (UUID)"
                    aria-label="Session id"
                    className="min-w-0 flex-1 rounded-md border border-edge bg-panel px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500"
                  />
                  <Button type="button" variant="secondary" size="sm" disabled={sessionBusy} onClick={attachSession}>
                    {sessionBusy ? "Linking…" : "Link session"}
                  </Button>
                </div>
              )}
              {sessionError != null && (
                <p className="text-xs text-red-300" role="alert">
                  {sessionError}
                </p>
              )}
              <p className="text-xs text-slate-500">
                Only sessions you own can be linked. Safety state is read-only here.
              </p>
            </section>

            <section aria-label="Job fields" className="flex flex-col gap-2 rounded-lg border border-edge bg-canvas p-3">
              <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">Details</p>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500" htmlFor={`job-edit-fault-${job.id}`}>
                  Reported fault
                </label>
                <textarea
                  id={`job-edit-fault-${job.id}`}
                  value={editFault}
                  onChange={(e) => setEditFault(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  className="rounded-md border border-edge bg-panel px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500" htmlFor={`job-edit-status-${job.id}`}>
                    Status
                  </label>
                  <select
                    id={`job-edit-status-${job.id}`}
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as JobStatus)}
                    className="rounded-md border border-edge bg-panel px-2 py-1.5 text-sm text-slate-100"
                  >
                    {ALL_JOB_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {jobStatusLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500" htmlFor={`job-edit-priority-${job.id}`}>
                    Priority
                  </label>
                  <select
                    id={`job-edit-priority-${job.id}`}
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value as JobPriority)}
                    className="rounded-md border border-edge bg-panel px-2 py-1.5 text-sm text-slate-100"
                  >
                    {(["low", "normal", "high", "urgent"] as const).map((p) => (
                      <option key={p} value={p}>
                        {jobPriorityLabel(p)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500" htmlFor={`job-edit-assignee-${job.id}`}>
                    Assignee
                  </label>
                  <select
                    id={`job-edit-assignee-${job.id}`}
                    value={editAssignee}
                    onChange={(e) => setEditAssignee(e.target.value)}
                    className="rounded-md border border-edge bg-panel px-2 py-1.5 text-sm text-slate-100"
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500" htmlFor={`job-edit-condition-${job.id}`}>
                    Device condition
                  </label>
                  <input
                    id={`job-edit-condition-${job.id}`}
                    value={editCondition}
                    onChange={(e) => setEditCondition(e.target.value)}
                    maxLength={2000}
                    className="rounded-md border border-edge bg-panel px-3 py-2 text-sm text-slate-100"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500" htmlFor={`job-edit-acc-${job.id}`}>
                    Accessories
                  </label>
                  <input
                    id={`job-edit-acc-${job.id}`}
                    value={editAccessories}
                    onChange={(e) => setEditAccessories(e.target.value)}
                    maxLength={2000}
                    className="rounded-md border border-edge bg-panel px-3 py-2 text-sm text-slate-100"
                  />
                </div>
              </div>
              {editError != null && (
                <p className="text-xs text-red-300" role="alert">
                  {editError}
                </p>
              )}
              <div className="flex justify-end">
                <Button type="button" size="sm" disabled={editBusy} onClick={saveEdits}>
                  {editBusy ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </section>

            <section aria-label="Status timeline" className="flex flex-col gap-2 rounded-lg border border-edge bg-canvas p-3">
              <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">
                Timeline
              </p>
              {events == null && <Skeleton className="h-20" />}
              {events != null && events.length === 0 && (
                <p className="text-xs text-slate-500">No timeline entries yet.</p>
              )}
              {events != null && events.length > 0 && (
                <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto" role="list">
                  {events.map((event) => (
                    <JobEventRow key={event.id} event={event} />
                  ))}
                </ul>
              )}
              <div className="flex flex-col gap-1.5 sm:flex-row">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={4000}
                  placeholder="Add a note…"
                  aria-label="Add a note"
                  className="min-w-0 flex-1 rounded-md border border-edge bg-panel px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={note.trim().length === 0 || noteBusy}
                  onClick={addNote}
                >
                  {noteBusy ? "Adding…" : "Add note"}
                </Button>
              </div>
              {noteError != null && (
                <p className="text-xs text-red-300" role="alert">
                  {noteError}
                </p>
              )}
            </section>

            <section aria-label="Estimates" className="flex flex-col gap-2 rounded-lg border border-edge bg-canvas p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">
                  Estimates
                </p>
              </div>
              {estimates == null && <Skeleton className="h-16" />}
              {estimates != null && estimates.length === 0 && (
                <p className="text-xs text-slate-500">No estimates yet.</p>
              )}
              {estimates != null && estimates.length > 0 && (
                <ul className="flex flex-col gap-2" role="list">
                  {estimates.map((bundle) => (
                    <EstimateCard
                      key={bundle.estimate.id}
                      shopId={shopId}
                      jobId={detail.id}
                      token={token}
                      bundle={bundle}
                      onChanged={(updated) => {
                        setEstimates((prev) =>
                          (prev ?? []).map((b) =>
                            b.estimate.id === updated.estimate.id ? updated : b,
                          ),
                        );
                        if (updated.estimate.status === "converted") {
                          setReload((n) => n + 1);
                        }
                      }}
                    />
                  ))}
                </ul>
              )}
              <EstimateBuilder
                shopId={shopId}
                jobId={detail.id}
                token={token}
                sessionId={detail.session_id}
                onCreated={(bundle) =>
                  setEstimates((prev) => (prev ? [bundle, ...prev] : [bundle]))
                }
              />
            </section>

            <InventoryUseForm
              shopId={shopId}
              jobId={detail.id}
              token={token}
              onUsed={(message) => setNotice(message)}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
