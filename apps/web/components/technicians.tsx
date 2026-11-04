"use client";

import { BadgeCheck, MapPin, Wrench } from "lucide-react";
import type { ContactRequestStatus, TechnicianListItem } from "@fieldfix/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/* Pure helpers shared by the technicians page and its tests. */

export function formatDistanceKm(distance: number | null): string | null {
  if (distance == null) {
    return null;
  }
  return distance < 10
    ? `${distance.toFixed(1)} km away`
    : `${Math.round(distance)} km away`;
}

export function requestStatusLabel(status: ContactRequestStatus): string {
  switch (status) {
    case "submitted":
      return "Submitted";
    case "awaiting_response":
      return "Awaiting response";
    case "accepted":
      return "Accepted";
    case "declined":
      return "Declined";
    case "customer_contacted":
      return "Contacted";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
  }
}

export interface StatusAction {
  status: ContactRequestStatus;
  label: string;
}

/**
 * Client-side mirror of the server lifecycle: the technician side
 * drives progress, the requester side may only cancel, and terminal
 * states offer nothing. The server re-enforces every transition.
 */
export function nextActionsFor(
  status: ContactRequestStatus,
  side: "sent" | "received",
): StatusAction[] {
  if (side === "sent") {
    return status === "declined" || status === "completed" || status === "cancelled"
      ? []
      : [{ status: "cancelled", label: "Cancel request" }];
  }
  switch (status) {
    case "submitted":
    case "awaiting_response":
      return [
        { status: "accepted", label: "Accept" },
        { status: "declined", label: "Decline" },
        { status: "customer_contacted", label: "Mark contacted" },
      ];
    case "accepted":
      return [
        { status: "customer_contacted", label: "Mark contacted" },
        { status: "in_progress", label: "Start progress" },
        { status: "completed", label: "Complete" },
      ];
    case "customer_contacted":
      return [
        { status: "in_progress", label: "Start progress" },
        { status: "completed", label: "Complete" },
      ];
    case "in_progress":
      return [{ status: "completed", label: "Complete" }];
    default:
      return [];
  }
}

function statusBadgeVariant(
  status: ContactRequestStatus,
): "default" | "secondary" | "success" | "warning" | "danger" | "muted" {
  switch (status) {
    case "submitted":
      return "secondary";
    case "awaiting_response":
    case "customer_contacted":
      return "default";
    case "accepted":
    case "completed":
      return "success";
    case "in_progress":
      return "warning";
    case "declined":
      return "danger";
    case "cancelled":
      return "muted";
  }
}

export function RequestStatusBadge({ status }: { status: ContactRequestStatus }) {
  return <Badge variant={statusBadgeVariant(status)}>{requestStatusLabel(status)}</Badge>;
}

/* Search result card (no contact PII — the list API carries none). */

export function TechnicianResultCard({
  tech,
  onContact,
}: {
  tech: TechnicianListItem;
  onContact: (tech: TechnicianListItem) => void;
}) {
  const distance = formatDistanceKm(tech.distance_km);
  const services = tech.specialties.length > 0 ? tech.specialties : tech.device_types;
  return (
    <li className="rounded-xl border border-edge bg-panel p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-edge bg-canvas">
          <Wrench className="size-5 text-slate-300" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-100">
            {tech.display_name}
            {tech.verified && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                <BadgeCheck className="size-3.5" aria-hidden />
                Verified
              </span>
            )}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden />
              {tech.city}, {tech.region}
            </span>
            {distance && <span aria-label={`Distance: ${distance}`}>· {distance}</span>}
          </p>
          {services.length > 0 && (
            <p className="mt-1.5 line-clamp-2 text-sm text-slate-300">{services.join(" · ")}</p>
          )}
          {tech.about && (
            <p className="mt-1 line-clamp-2 text-xs text-slate-500">{tech.about}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge variant={tech.accepting_requests ? "success" : "muted"}>
            {tech.accepting_requests ? "Accepting requests" : "Not accepting"}
          </Badge>
          <Button
            type="button"
            size="sm"
            disabled={!tech.accepting_requests}
            title={
              tech.accepting_requests
                ? `Contact ${tech.display_name}`
                : "This technician is not accepting requests right now"
            }
            onClick={() => onContact(tech)}
          >
            Contact
          </Button>
        </div>
      </div>
    </li>
  );
}
