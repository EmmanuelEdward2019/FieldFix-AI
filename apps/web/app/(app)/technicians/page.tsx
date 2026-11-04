"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  BellRing,
  LocateFixed,
  RotateCcw,
  Search,
  UserRound,
  X,
} from "lucide-react";
import type {
  ContactRequest,
  ContactRequestStatus,
  EvidenceFileResponse,
  HandoffDetailResponse,
  MySessionItem,
  TechnicianCard,
  TechnicianListItem,
} from "@fieldfix/contracts";
import { OwnTechnicianProfileSection } from "@/components/own-technician-profile";
import type { MapPoint } from "@/components/technician-map";

const TechnicianMap = dynamic(
  () => import("@/components/technician-map").then((mod) => mod.TechnicianMap),
  {
    ssr: false,
    loading: () => <Skeleton className="h-72 w-full rounded-xl" />,
  },
);
import {
  RequestStatusBadge,
  TechnicianResultCard,
  nextActionsFor,
} from "@/components/technicians";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createContactRequestApi,
  createHandoffApi,
  describeApiError,
  getHandoffApi,
  getSessionDetailApi,
  getTechnicianCardApi,
  isAbortError,
  listContactRequestsApi,
  mySessionsApi,
  searchTechniciansApi,
  updateContactRequestApi,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatBytes, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/* Contact dialog: card + session picker + message + consent checkboxes. */

function sessionLabel(session: MySessionItem): string {
  const device = session.model ?? session.device_type;
  return `${device} — ${session.symptoms.slice(0, 60)}${session.symptoms.length > 60 ? "…" : ""}`;
}

function ContactDialog({
  tech,
  token,
  open,
  onOpenChange,
  onSent,
}: {
  tech: TechnicianListItem;
  token: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}) {
  const [card, setCard] = useState<TechnicianCard | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<MySessionItem[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>("");
  const [evidence, setEvidence] = useState<EvidenceFileResponse[] | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [contactMethod, setContactMethod] = useState("");
  const [shareReport, setShareReport] = useState(false);
  const [sharedIds, setSharedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open) {
      return;
    }
    setCard(null);
    setCardError(null);
    setSessions(null);
    setSessionsError(null);
    setSessionId("");
    setEvidence(null);
    setEvidenceError(null);
    setMessage("");
    setContactMethod("");
    setShareReport(false);
    setSharedIds(new Set());
    setSubmitting(false);
    setSubmitError(null);
    setSent(false);
    const controller = new AbortController();
    void getTechnicianCardApi(tech.user_id, {
      signal: controller.signal,
      ...(token ? { token } : {}),
    }).then(
      (loaded) => setCard(loaded),
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setCardError(describeApiError(err));
        }
      },
    );
    if (token) {
      void mySessionsApi(token, controller.signal).then(
        (res) => setSessions(res.sessions),
        (err: unknown) => {
          if (!controller.signal.aborted && !isAbortError(err)) {
            setSessionsError(describeApiError(err));
          }
        },
      );
    }
    return () => controller.abort();
  }, [open, tech.user_id, token, reload]);

  useEffect(() => {
    setEvidence(null);
    setEvidenceError(null);
    setSharedIds(new Set());
    setShareReport(false);
    if (!open || !sessionId || !token) {
      return;
    }
    const controller = new AbortController();
    void getSessionDetailApi(sessionId, token, controller.signal).then(
      (detail) => setEvidence(detail.evidence),
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setEvidenceError(describeApiError(err));
        }
      },
    );
    return () => controller.abort();
  }, [open, sessionId, token]);

  const toggleShared = (id: string, checked: boolean) => {
    setSharedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const sharing = sessionId !== "" && (shareReport || sharedIds.size > 0);

  const submit = () => {
    if (!token || submitting || message.trim().length === 0) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const pickedSession = sessionId === "" ? null : sessionId;
    void createContactRequestApi(
      tech.user_id,
      token,
      {
        session_id: pickedSession,
        message: message.trim(),
        ...(contactMethod.trim() ? { contact_method: contactMethod.trim() } : {}),
      },
    ).then(
      (created) => {
        if (!sharing || !pickedSession) {
          setSubmitting(false);
          setSent(true);
          onSent();
          return;
        }
        void createHandoffApi(created.id, token, {
          session_id: pickedSession,
          shared_evidence_ids: [...sharedIds],
          shared_report: shareReport,
        }).then(
          () => {
            setSubmitting(false);
            setSent(true);
            onSent();
          },
          (err: unknown) => {
            setSubmitting(false);
            setSubmitError(
              `Request sent, but sharing failed: ${describeApiError(err)} You can share from your sent requests later.`,
            );
            onSent();
          },
        );
      },
      (err: unknown) => {
        setSubmitting(false);
        setSubmitError(describeApiError(err));
      },
    );
  };

  const exposedContact =
    card && (card.phone || card.contact_email || card.whatsapp) ? card : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Contact {tech.display_name}</DialogTitle>
        <DialogDescription>
          {tech.city}, {tech.region}
          {tech.verified ? " · Verified technician" : ""}
        </DialogDescription>

        {sent ? (
          <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/5 p-4 text-center" role="status">
            <p className="text-sm font-medium text-slate-100">Request sent</p>
            <p className="mt-1 text-xs text-slate-400">
              {sharing
                ? "Your message and the selected diagnostics are on the way."
                : "Your message is on the way. Track it under My requests."}
            </p>
            <Button type="button" className="mt-3" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {card == null && cardError == null && <Skeleton className="h-16" />}
            {cardError != null && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5" role="alert">
                <p className="text-sm text-slate-200">Couldn&apos;t load the profile: {cardError}</p>
                <Button type="button" variant="secondary" size="sm" onClick={() => setReload((n) => n + 1)}>
                  <RotateCcw aria-hidden />
                  Retry
                </Button>
              </div>
            )}
            {exposedContact && (
              <div className="rounded-lg border border-edge bg-canvas p-3 text-sm text-slate-300">
                <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  Public contact details
                </p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {exposedContact.phone && <li>Phone: {exposedContact.phone}</li>}
                  {exposedContact.contact_email && <li>Email: {exposedContact.contact_email}</li>}
                  {exposedContact.whatsapp && <li>WhatsApp: {exposedContact.whatsapp}</li>}
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="contact-session" className="text-sm font-medium text-slate-200">
                Related diagnosis <span className="font-normal text-slate-500">(optional)</span>
              </label>
              {sessions == null && sessionsError == null ? (
                <Skeleton className="h-9" />
              ) : sessionsError != null ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5" role="alert">
                  <p className="text-sm text-slate-200">Couldn&apos;t load diagnoses: {sessionsError}</p>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setReload((n) => n + 1)}>
                    <RotateCcw aria-hidden />
                    Retry
                  </Button>
                </div>
              ) : (
                <select
                  id="contact-session"
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
                >
                  <option value="">No related diagnosis</option>
                  {(sessions ?? []).map((session) => (
                    <option key={session.id} value={session.id}>
                      {sessionLabel(session)}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="contact-message" className="text-sm font-medium text-slate-200">
                Message
              </label>
              <textarea
                id="contact-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={2000}
                rows={4}
                required
                placeholder="Describe what you need help with…"
                className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              />
              <p className="text-xs text-slate-500">{message.trim().length} / 2000</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="contact-method" className="text-sm font-medium text-slate-200">
                Preferred contact method <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <input
                id="contact-method"
                type="text"
                value={contactMethod}
                onChange={(e) => setContactMethod(e.target.value)}
                maxLength={200}
                placeholder="e.g. phone, email, WhatsApp"
                className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              />
            </div>

            {sessionId !== "" && (
              <fieldset className="flex flex-col gap-2 rounded-lg border border-edge bg-canvas p-3">
                <legend className="px-1 text-sm font-medium text-slate-200">
                  Share diagnostic summary
                </legend>
                <p className="text-xs text-slate-500">
                  Nothing is shared unless you tick it. Only the items below go to this
                  technician.
                </p>
                {evidence == null && evidenceError == null && <Skeleton className="h-9" />}
                {evidenceError != null && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5" role="alert">
                    <p className="text-sm text-slate-200">Couldn&apos;t load files: {evidenceError}</p>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setReload((n) => n + 1)}>
                      <RotateCcw aria-hidden />
                      Retry
                    </Button>
                  </div>
                )}
                {evidence != null && (
                  <>
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={shareReport}
                        onChange={(e) => setShareReport(e.target.checked)}
                        className="mt-1 size-4 accent-cyan-400"
                      />
                      Share the repair report for this diagnosis
                    </label>
                    {evidence.length === 0 ? (
                      <p className="text-xs text-slate-500">This diagnosis has no evidence files.</p>
                    ) : (
                      evidence.map((file) => (
                        <label key={file.id} className="flex cursor-pointer items-start gap-2 text-sm text-slate-200">
                          <input
                            type="checkbox"
                            checked={sharedIds.has(file.id)}
                            onChange={(e) => toggleShared(file.id, e.target.checked)}
                            className="mt-1 size-4 accent-cyan-400"
                          />
                          <span className="min-w-0">
                            <span className="block truncate">
                              {file.original_filename ?? `${file.kind} file`}
                            </span>
                            <span className="block text-xs text-slate-500">
                              {file.media_type} · {formatBytes(file.byte_size)}
                            </span>
                          </span>
                        </label>
                      ))
                    )}
                  </>
                )}
              </fieldset>
            )}

            {submitError != null && (
              <div className="rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5" role="alert">
                <p className="text-sm text-slate-200">{submitError}</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!token || submitting || message.trim().length === 0}
                onClick={submit}
              >
                {submitting ? "Sending…" : sharing ? "Send & share" : "Send request"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* Requests inbox: sent/received tabs with lifecycle actions. */

function SharedSummary({ detail }: { detail: HandoffDetailResponse }) {
  return (
    <div className="rounded-lg border border-edge bg-canvas p-3 text-sm">
      <p className="font-medium text-slate-200">
        {detail.session.model ?? detail.session.device_type} — {detail.session.symptoms}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Shared evidence:{" "}
        {detail.evidence.length === 0
          ? "none"
          : detail.evidence
              .map((file) => file.original_filename ?? `${file.kind} file`)
              .join(", ")}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">
        Repair report: {detail.report ? "shared" : "not shared"}
      </p>
    </div>
  );
}

function RequestRow({
  req,
  side,
  token,
  onChanged,
}: {
  req: ContactRequest;
  side: "sent" | "received";
  token: string;
  onChanged: (updated: ContactRequest) => void;
}) {
  const [pending, setPending] = useState<ContactRequestStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<HandoffDetailResponse | null>(null);
  const [handoffState, setHandoffState] = useState<"idle" | "loading" | "error" | "empty">("idle");
  const [handoffError, setHandoffError] = useState<string | null>(null);

  const act = (status: ContactRequestStatus) => {
    if (pending) {
      return;
    }
    setPending(status);
    setActionError(null);
    void updateContactRequestApi(req.id, token, status).then(
      (updated) => {
        setPending(null);
        onChanged(updated);
      },
      (err: unknown) => {
        setPending(null);
        setActionError(describeApiError(err));
      },
    );
  };

  const loadHandoff = () => {
    if (handoffState === "loading") {
      return;
    }
    setHandoffState("loading");
    setHandoffError(null);
    void getHandoffApi(req.id, token).then(
      (detail) => {
        setHandoff(detail);
        setHandoffState("idle");
      },
      (err: unknown) => {
        if (err instanceof Error && /nothing has been shared/i.test(err.message)) {
          setHandoffState("empty");
          return;
        }
        setHandoffState("error");
        setHandoffError(describeApiError(err));
      },
    );
  };

  const actions = nextActionsFor(req.status, side);

  return (
    <li className="rounded-xl border border-edge bg-panel p-4">
      <div className="flex flex-wrap items-start gap-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-edge bg-canvas">
          {side === "received" ? (
            <BellRing className="size-4 text-slate-300" aria-hidden />
          ) : (
            <UserRound className="size-4 text-slate-300" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed text-slate-200">{req.message}</p>
          <p className="mt-1 text-xs text-slate-500">
            {formatRelativeTime(req.updated_at)}
            {req.contact_method ? ` · prefers ${req.contact_method}` : ""}
          </p>
        </div>
        <RequestStatusBadge status={req.status} />
      </div>

      {actionError != null && (
        <div className="mt-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2" role="alert">
          <p className="text-sm text-slate-200">{actionError}</p>
        </div>
      )}

      {(actions.length > 0 || side === "received") && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map(({ status, label }) => (
            <Button
              key={status}
              type="button"
              variant={status === "cancelled" || status === "declined" ? "secondary" : "default"}
              size="sm"
              disabled={pending != null}
              onClick={() => act(status)}
            >
              {pending === status ? "Saving…" : label}
            </Button>
          ))}
          {side === "received" && handoff == null && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={handoffState === "loading"}
              onClick={loadHandoff}
            >
              {handoffState === "loading" ? "Loading…" : "View shared summary"}
            </Button>
          )}
        </div>
      )}

      {handoffState === "loading" && <Skeleton className="mt-3 h-20" />}
      {handoffState === "empty" && (
        <p className="mt-3 text-xs text-slate-500" role="status">
          Nothing has been shared on this request yet.
        </p>
      )}
      {handoffState === "error" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5" role="alert">
          <p className="text-sm text-slate-200">Couldn&apos;t load the shared summary: {handoffError}</p>
          <Button type="button" variant="secondary" size="sm" onClick={loadHandoff}>
            <RotateCcw aria-hidden />
            Retry
          </Button>
        </div>
      )}
      {handoff != null && (
        <div className="mt-3">
          <SharedSummary detail={handoff} />
        </div>
      )}
    </li>
  );
}

function RequestsInbox({ token }: { token: string | null }) {
  const [role, setRole] = useState<"sent" | "received">("received");
  const [requests, setRequests] = useState<ContactRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!token) {
      return;
    }
    const controller = new AbortController();
    setRequests(null);
    setError(null);
    void listContactRequestsApi(token, role, controller.signal).then(
      (res) => setRequests(res.requests),
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setError(describeApiError(err));
        }
      },
    );
    return () => controller.abort();
  }, [token, role, reload]);

  return (
    <div className="flex flex-col gap-3">
      <Tabs value={role} onValueChange={(v) => setRole(v as "sent" | "received")}>
        <TabsList aria-label="Request direction">
          <TabsTrigger value="received">Received</TabsTrigger>
          <TabsTrigger value="sent">Sent</TabsTrigger>
        </TabsList>
        <TabsContent value="received" />
        <TabsContent value="sent" />
      </Tabs>

      {error != null && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5" role="alert">
          <p className="text-sm text-slate-200">Couldn&apos;t load requests: {error}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => setReload((n) => n + 1)}>
            <RotateCcw aria-hidden />
            Retry
          </Button>
        </div>
      )}

      {requests == null && error == null && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading requests">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}

      {requests != null && requests.length === 0 && (
        <div className="rounded-xl border border-dashed border-edge-strong p-6 text-center">
          <p className="text-sm text-slate-300">
            {role === "sent"
              ? "You haven't contacted any technicians yet."
              : "No one has contacted you yet."}
          </p>
        </div>
      )}

      {requests != null && requests.length > 0 && token != null && (
        <ul className="flex flex-col gap-2" role="list">
          {requests.map((req) => (
            <RequestRow
              key={req.id}
              req={req}
              side={role}
              token={token}
              onChanged={(updated) =>
                setRequests((prev) =>
                  (prev ?? []).map((row) => (row.id === updated.id ? updated : row)),
                )
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/* Main page: search + inbox tabs. */

const RADIUS_OPTIONS = [5, 10, 25, 50];

interface Filters {
  city: string;
  region: string;
  specialty: string;
  device_type: string;
}

const EMPTY_FILTERS: Filters = { city: "", region: "", specialty: "", device_type: "" };

function MapSection({
  results,
  coords,
}: {
  results: TechnicianListItem[];
  coords: { lat: number; lng: number } | null;
}) {
  const points = useMemo<MapPoint[]>(
    () =>
      results
        .filter((tech) => tech.latitude != null && tech.longitude != null)
        .map((tech) => ({
          id: tech.user_id,
          name: tech.display_name,
          lat: tech.latitude as number,
          lng: tech.longitude as number,
          detail: [
            [tech.city, tech.region].filter(Boolean).join(", "),
            tech.distance_km != null ? `${tech.distance_km.toFixed(1)} km away` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        })),
    [results],
  );
  if (points.length === 0 && !coords) {
    return null;
  }
  return <TechnicianMap points={points} origin={coords} />;
}

export default function TechniciansPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState("search");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [radiusKm, setRadiusKm] = useState(10);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const [results, setResults] = useState<TechnicianListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactTarget, setContactTarget] = useState<TechnicianListItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inboxRefresh, setInboxRefresh] = useState(0);

  const runSearch = useCallback(
    (at: { lat: number; lng: number } | null, f: Filters, radius: number) => {
      if (loading) {
        return;
      }
      setLoading(true);
      setError(null);
      void searchTechniciansApi(
        {
          ...(f.city.trim() ? { city: f.city.trim() } : {}),
          ...(f.region.trim() ? { region: f.region.trim() } : {}),
          ...(f.specialty.trim() ? { specialty: f.specialty.trim() } : {}),
          ...(f.device_type.trim() ? { device_type: f.device_type.trim() } : {}),
          ...(at ? { lat: at.lat, lng: at.lng, radius_km: radius } : {}),
        },
        { ...(token ? { token } : {}) },
      ).then(
        (res) => {
          setLoading(false);
          setResults(res.technicians);
          setSearched(true);
        },
        (err: unknown) => {
          if (isAbortError(err)) {
            setLoading(false);
            return;
          }
          setLoading(false);
          setError(describeApiError(err));
        },
      );
    },
    [loading, token],
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    void searchTechniciansApi({}, { ...(token ? { token } : {}) }).then(
      (res) => {
        setLoading(false);
        setResults(res.technicians);
        setSearched(true);
      },
      (err: unknown) => {
        if (isAbortError(err)) {
          setLoading(false);
          return;
        }
        setLoading(false);
        setError(describeApiError(err));
      },
    );
  }, []);

  const useMyLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoMessage("Geolocation isn't available in this browser — search by city or region instead.");
      return;
    }
    setLocating(true);
    setGeoMessage(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const at = { lat: position.coords.latitude, lng: position.coords.longitude };
        setLocating(false);
        setCoords(at);
        setGeoMessage("Using your current location — sent with the search only, never stored.");
        runSearch(at, filters, radiusKm);
      },
      () => {
        setLocating(false);
        setGeoMessage(
          "Couldn't use your location (permission denied or unavailable) — search by city or region instead.",
        );
      },
      { timeout: 10000 },
    );
  };

  const clearLocation = () => {
    setCoords(null);
    setGeoMessage(null);
  };

  const setFilter = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const openContact = (tech: TechnicianListItem) => {
    setContactTarget(tech);
    setDialogOpen(true);
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-50">Find a Technician</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          Search local technicians and send a contact request — no technician account needed.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Technician directory">
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="requests">My requests</TabsTrigger>
          <TabsTrigger value="profile">My technician profile</TabsTrigger>
        </TabsList>

        <TabsContent value="search">
          <div className="flex flex-col gap-3">
            <form
              role="search"
              className="flex flex-col gap-2 rounded-xl border border-edge bg-panel p-3"
              onSubmit={(e) => {
                e.preventDefault();
                runSearch(coords, filters, radiusKm);
              }}
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(
                  [
                    ["city", "City"],
                    ["region", "Region"],
                    ["specialty", "Specialty"],
                    ["device_type", "Device type"],
                  ] as Array<[keyof Filters, string]>
                ).map(([key, label]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <label htmlFor={`tech-${key}`} className="text-xs font-medium text-slate-400">
                      {label}
                    </label>
                    <input
                      id={`tech-${key}`}
                      type="text"
                      value={filters[key]}
                      onChange={(e) => setFilter(key, e.target.value)}
                      placeholder={`Any ${label.toLowerCase()}`}
                      className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                    />
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="tech-radius" className="text-xs font-medium text-slate-400">
                    Search radius
                  </label>
                  <select
                    id="tech-radius"
                    value={radiusKm}
                    onChange={(e) => setRadiusKm(Number(e.target.value))}
                    title="Applies when using your location"
                    className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
                  >
                    {RADIUS_OPTIONS.map((km) => (
                      <option key={km} value={km}>
                        Within {km} km
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={locating}
                  onClick={useMyLocation}
                  title="Use your device location for this search only — coordinates are never stored"
                >
                  <LocateFixed aria-hidden />
                  {locating ? "Locating…" : coords ? "Update my location" : "Use my location"}
                </Button>
                {coords && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearLocation}
                    aria-label="Clear location"
                  >
                    <X aria-hidden />
                    Clear
                  </Button>
                )}
                <Button type="submit" disabled={loading} className="sm:ml-auto">
                  <Search aria-hidden />
                  {loading ? "Searching…" : "Search"}
                </Button>
              </div>
              <p className="text-xs text-slate-500">
                Location is optional: your browser asks permission first, and manual
                city/region search always works.
              </p>
              {geoMessage != null && (
                <p
                  className={cn(
                    "text-xs",
                    coords ? "text-emerald-300" : "text-amber-300",
                  )}
                  role="status"
                >
                  {geoMessage}
                </p>
              )}
            </form>

            {error != null && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5" role="alert">
                <p className="text-sm text-slate-200">Couldn&apos;t search technicians: {error}</p>
                <Button type="button" variant="secondary" size="sm" onClick={() => runSearch(coords, filters, radiusKm)}>
                  <RotateCcw aria-hidden />
                  Retry
                </Button>
              </div>
            )}

            {loading && (
              <div className="flex flex-col gap-2" role="status" aria-label="Searching technicians">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-28" />
                ))}
              </div>
            )}

            {!loading && searched && results != null && results.length === 0 && error == null && (
              <div className="rounded-xl border border-dashed border-edge-strong p-6 text-center">
                <p className="text-sm text-slate-300">No technicians match this search.</p>
                <p className="mt-1 text-xs text-slate-500">
                  Try widening the radius or clearing a filter.
                </p>
              </div>
            )}

            {!loading && results != null && results.length > 0 && (
              <>
                <p className="text-xs text-slate-400" role="status">
                  {results.length} technician{results.length === 1 ? "" : "s"} found
                  {coords ? ` within ${radiusKm} km` : ""}.
                </p>
                <MapSection results={results} coords={coords} />
                <ul className="flex flex-col gap-2" role="list">
                  {results.map((tech) => (
                    <TechnicianResultCard key={tech.user_id} tech={tech} onContact={openContact} />
                  ))}
                </ul>
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="requests">
          <RequestsInbox key={inboxRefresh} token={token} />
        </TabsContent>

        <TabsContent value="profile">
          <OwnTechnicianProfileSection token={token} />
        </TabsContent>
      </Tabs>

      {contactTarget != null && (
        <ContactDialog
          tech={contactTarget}
          token={token}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSent={() => setInboxRefresh((n) => n + 1)}
        />
      )}
    </div>
  );
}
