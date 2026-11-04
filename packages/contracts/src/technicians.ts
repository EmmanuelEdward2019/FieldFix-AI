import { z } from "zod";
import {
  evidenceFileResponseSchema,
  reportResponseSchema,
  sessionResponseSchema,
} from "./diagnostics.js";

/**
 * Technician-directory contracts (Phase 3, backend).
 *
 * Public discovery lists technician profiles WITHOUT contact PII
 * (phone/email/whatsapp appear on the public card only, and only
 * when the technician chose to expose them). Geo-discovery is
 * opt-in: profiles without coordinates never match a radius search,
 * and a searcher's coordinates are query params only — never stored.
 *
 * There are deliberately NO rating/review fields anywhere here. The
 * only trust signal is the admin-managed `verified` boolean.
 */

export const contactRequestStatusSchema = z.enum([
  "submitted",
  "awaiting_response",
  "accepted",
  "declined",
  "customer_contacted",
  "in_progress",
  "completed",
  "cancelled",
]);
export type ContactRequestStatus = z.infer<typeof contactRequestStatusSchema>;

/* Search (public; all filters optional). */

export const searchTechniciansQuerySchema = z
  .object({
    city: z.string().trim().min(1).max(200).optional(),
    region: z.string().trim().min(1).max(200).optional(),
    specialty: z.string().trim().min(1).max(200).optional(),
    device_type: z.string().trim().min(1).max(200).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radius_km: z.coerce.number().min(1).max(200).default(10),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((v) => (v.lat == null) === (v.lng == null), {
    message: "lat and lng must be set together or not at all.",
  });
export type SearchTechniciansQuery = z.infer<typeof searchTechniciansQuerySchema>;

/* Profiles: list items carry no contact PII; cards may. */

const profileBase = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  city: z.string(),
  region: z.string(),
  postal_code: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  specialties: z.array(z.string()),
  device_types: z.array(z.string()),
  about: z.string().nullable(),
  accepting_requests: z.boolean(),
  verified: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const technicianListItemSchema = profileBase.extend({
  /** Kilometers from the search origin; null without lat/lng search. */
  distance_km: z.number().nonnegative().nullable(),
});
export type TechnicianListItem = z.infer<typeof technicianListItemSchema>;

export const listTechniciansResponseSchema = z.object({
  technicians: z.array(technicianListItemSchema),
});
export type ListTechniciansResponse = z.infer<typeof listTechniciansResponseSchema>;

export const technicianCardSchema = profileBase.extend({
  phone: z.string().nullable(),
  contact_email: z.string().nullable(),
  whatsapp: z.string().nullable(),
});
export type TechnicianCard = z.infer<typeof technicianCardSchema>;

export const technicianResponseSchema = z.object({
  technician: technicianCardSchema,
});
export type TechnicianResponse = z.infer<typeof technicianResponseSchema>;

/* Contact requests (login required). */

export const createContactRequestSchema = z.object({
  session_id: z.string().uuid().nullable().optional(),
  message: z.string().trim().min(1).max(2000),
  contact_method: z.string().trim().min(1).max(200).nullable().optional(),
  preferred_time: z.string().trim().min(1).max(200).nullable().optional(),
});
export type CreateContactRequest = z.infer<typeof createContactRequestSchema>;

export const contactRequestSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid().nullable(),
  requester_user_id: z.string().uuid().nullable(),
  technician_user_id: z.string().uuid(),
  message: z.string(),
  contact_method: z.string().nullable(),
  preferred_time: z.string().nullable(),
  status: contactRequestStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type ContactRequest = z.infer<typeof contactRequestSchema>;

export const contactRequestResponseSchema = z.object({
  request: contactRequestSchema,
});
export type ContactRequestResponse = z.infer<typeof contactRequestResponseSchema>;

export const listContactRequestsResponseSchema = z.object({
  requests: z.array(contactRequestSchema),
});
export type ListContactRequestsResponse = z.infer<
  typeof listContactRequestsResponseSchema
>;

export const updateContactRequestStatusSchema = z.object({
  status: contactRequestStatusSchema,
});
export type UpdateContactRequestStatus = z.infer<
  typeof updateContactRequestStatusSchema
>;

/* Consented diagnostic handoffs (explicit evidence allowlist). */

export const createHandoffSchema = z.object({
  session_id: z.string().uuid(),
  shared_evidence_ids: z.array(z.string().uuid()).max(100).default([]),
  shared_report: z.boolean().default(false),
});
export type CreateHandoff = z.infer<typeof createHandoffSchema>;

export const diagnosticHandoffSchema = z.object({
  id: z.string().uuid(),
  request_id: z.string().uuid(),
  session_id: z.string().uuid(),
  shared_evidence_ids: z.array(z.string().uuid()),
  shared_report: z.boolean(),
  created_by_user_id: z.string().uuid(),
  created_at: z.string().datetime(),
});
export type DiagnosticHandoff = z.infer<typeof diagnosticHandoffSchema>;

export const handoffResponseSchema = z.object({
  handoff: diagnosticHandoffSchema,
});
export type HandoffResponse = z.infer<typeof handoffResponseSchema>;

/**
 * What the technician sees: the consented session summary plus ONLY
 * the allowlisted evidence files and (when shared_report) the latest
 * report. No other session rows are included.
 */
export const handoffDetailResponseSchema = z.object({
  handoff: diagnosticHandoffSchema,
  session: sessionResponseSchema,
  evidence: z.array(evidenceFileResponseSchema),
  report: reportResponseSchema.nullable(),
});
export type HandoffDetailResponse = z.infer<typeof handoffDetailResponseSchema>;

/* Own profile (login; upsert — creates the directory card). */

export const upsertOwnTechnicianProfileSchema = z
  .object({
    display_name: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(200),
    region: z.string().trim().min(1).max(200),
    postal_code: z.string().trim().min(1).max(50).nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    specialties: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
    device_types: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
    phone: z.string().trim().min(1).max(200).nullable().optional(),
    contact_email: z.string().trim().email().max(320).nullable().optional(),
    whatsapp: z.string().trim().min(1).max(200).nullable().optional(),
    about: z.string().trim().max(5000).nullable().optional(),
    accepting_requests: z.boolean().default(true),
    // NOTE: `verified` is deliberately absent — unknown keys are
    // stripped, so a user payload can never set the admin badge.
  })
  .refine((v) => (v.latitude == null) === (v.longitude == null), {
    message: "latitude and longitude must be set together or not at all.",
  });
export type UpsertOwnTechnicianProfile = z.infer<
  typeof upsertOwnTechnicianProfileSchema
>;

/* Admin: the verified badge is the only trust signal, admin-managed. */

export const updateTechnicianVerifiedSchema = z.object({
  verified: z.boolean(),
});
export type UpdateTechnicianVerified = z.infer<typeof updateTechnicianVerifiedSchema>;
