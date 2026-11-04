import { z } from "zod";
import { modelRunResponseSchema } from "./diagnostics.js";
import { ingestionJobResponseSchema } from "./knowledge.js";

/* Roles, capabilities, and platform administration contracts. */

export const userRoleSchema = z.enum(["super_admin", "admin", "operator", "technician"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userStatusSchema = z.enum(["active", "suspended", "deactivated"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const adminUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: userRoleSchema,
  status: userStatusSchema,
  email_confirmed: z.boolean(),
  session_count: z.number().int(),
  created_at: z.string().datetime(),
  last_login_at: z.string().datetime().nullable(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const listUsersResponseSchema = z.object({
  users: z.array(adminUserSchema),
  total: z.number().int(),
});
export type ListUsersResponse = z.infer<typeof listUsersResponseSchema>;

export const updateUserSchema = z.object({
  role: userRoleSchema.optional(),
  status: userStatusSchema.optional(),
});
export type UpdateUser = z.infer<typeof updateUserSchema>;

export const adminSessionItemSchema = z.object({
  id: z.string().uuid(),
  user_email: z.string().email().nullable(),
  device_type: z.string(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  symptoms: z.string(),
  status: z.string(),
  safety_state: z.string(),
  evidence_count: z.number().int(),
  hypothesis_count: z.number().int(),
  test_count: z.number().int(),
  model_run_count: z.number().int(),
  last_model_status: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type AdminSessionItem = z.infer<typeof adminSessionItemSchema>;

export const listSessionsResponseSchema = z.object({
  sessions: z.array(adminSessionItemSchema),
  total: z.number().int(),
});
export type ListSessionsResponse = z.infer<typeof listSessionsResponseSchema>;

export const adminReportItemSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  user_email: z.string().email().nullable(),
  device_type: z.string(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  status: z.string(),
  verified_findings: z.number().int(),
  total_findings: z.number().int(),
  created_at: z.string().datetime(),
});
export type AdminReportItem = z.infer<typeof adminReportItemSchema>;

export const listReportsResponseSchema = z.object({
  reports: z.array(adminReportItemSchema),
  total: z.number().int(),
});
export type ListReportsResponse = z.infer<typeof listReportsResponseSchema>;

export const adminEvidenceItemSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  device_type: z.string(),
  media_type: z.string(),
  byte_size: z.number().int(),
  original_filename: z.string().nullable(),
  processing_status: z.string(),
  created_at: z.string().datetime(),
});
export type AdminEvidenceItem = z.infer<typeof adminEvidenceItemSchema>;

export const listAdminEvidenceResponseSchema = z.object({
  evidence: z.array(adminEvidenceItemSchema),
  total: z.number().int(),
});
export type ListAdminEvidenceResponse = z.infer<typeof listAdminEvidenceResponseSchema>;

export const adminModelRunSchema = modelRunResponseSchema.extend({
  session_id: z.string().uuid().nullable(),
  error_category: z.string().nullable(),
  validation_status: z.string(),
  prompt_tokens: z.number().int().nullable(),
  completion_tokens: z.number().int().nullable(),
});
export type AdminModelRun = z.infer<typeof adminModelRunSchema>;

export const listModelRunsResponseSchema = z.object({
  runs: z.array(adminModelRunSchema),
  total: z.number().int(),
});
export type ListModelRunsResponse = z.infer<typeof listModelRunsResponseSchema>;

export const providerStatusSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  enabled: z.boolean(),
  configured: z.boolean(),
  model_id: z.string(),
  runs_24h: z.number().int(),
  succeeded_24h: z.number().int(),
  failed_24h: z.number().int(),
  avg_latency_ms: z.number().nullable(),
  last_run_at: z.string().datetime().nullable(),
  last_status: z.string().nullable(),
});
export type ProviderStatus = z.infer<typeof providerStatusSchema>;

export const listProvidersResponseSchema = z.object({
  providers: z.array(providerStatusSchema),
});
export type ListProvidersResponse = z.infer<typeof listProvidersResponseSchema>;

export const providerTestResponseSchema = z.object({
  ok: z.boolean(),
  latency_ms: z.number().nullable(),
  detail: z.string(),
});
export type ProviderTestResponse = z.infer<typeof providerTestResponseSchema>;

export const updateProviderSchema = z.object({
  enabled: z.boolean(),
});
export type UpdateProvider = z.infer<typeof updateProviderSchema>;

export const adminSafetyEventSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  device_type: z.string(),
  previous_state: z.string(),
  new_state: z.string(),
  trigger_type: z.string(),
  trigger_detail: z.string().nullable(),
  blocked_action: z.string().nullable(),
  reviewed: z.boolean(),
  review_note: z.string().nullable(),
  created_at: z.string().datetime(),
});
export type AdminSafetyEvent = z.infer<typeof adminSafetyEventSchema>;

export const listSafetyEventsResponseSchema = z.object({
  events: z.array(adminSafetyEventSchema),
  total: z.number().int(),
});
export type ListSafetyEventsResponse = z.infer<typeof listSafetyEventsResponseSchema>;

export const reviewSafetyEventSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});
export type ReviewSafetyEvent = z.infer<typeof reviewSafetyEventSchema>;

export const auditLogSchema = z.object({
  id: z.string().uuid(),
  actor_type: z.enum(["user", "token"]),
  actor_id: z.string().nullable(),
  actor_email: z.string().email().nullable(),
  action: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  outcome: z.enum(["success", "denied", "failed"]),
  metadata: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  created_at: z.string().datetime(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;

export const listAuditLogsResponseSchema = z.object({
  logs: z.array(auditLogSchema),
  total: z.number().int(),
});
export type ListAuditLogsResponse = z.infer<typeof listAuditLogsResponseSchema>;

export const notificationSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  is_read: z.boolean(),
  created_at: z.string().datetime(),
});
export type AdminNotification = z.infer<typeof notificationSchema>;

export const listNotificationsResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  total: z.number().int(),
  unread: z.number().int(),
});
export type ListNotificationsResponse = z.infer<typeof listNotificationsResponseSchema>;

export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
  link: z.string().max(500).nullable().optional(),
});
export type CreateAnnouncement = z.infer<typeof createAnnouncementSchema>;

export const adminMeSchema = z.object({
  actor_type: z.enum(["user"]),
  actor_id: z.string().nullable(),
  actor_email: z.string().email().nullable(),
  role: userRoleSchema,
  capabilities: z.array(z.string()),
});
export type AdminMe = z.infer<typeof adminMeSchema>;

export const overviewStatsSchema = z.object({
  users: z.object({
    total: z.number().int(),
    active: z.number().int(),
    technicians: z.number().int(),
    active_7d: z.number().int(),
  }),
  sessions: z.object({
    total: z.number().int(),
    active: z.number().int(),
    completed: z.number().int(),
    by_device: z.array(z.object({ device: z.string(), count: z.number().int() })),
    by_day: z.array(z.object({ day: z.string(), count: z.number().int() })),
    by_status: z.array(z.object({ status: z.string(), count: z.number().int() })),
  }),
  reports: z.object({ total: z.number().int() }),
  safety: z.object({
    total_events: z.number().int(),
    critical_stops: z.number().int(),
    unreviewed: z.number().int(),
    recent: z.array(adminSafetyEventSchema),
  }),
  ai: z.object({
    total_runs: z.number().int(),
    succeeded: z.number().int(),
    failed: z.number().int(),
    avg_latency_ms: z.number().nullable(),
    timeouts_24h: z.number().int(),
    rate_limited_24h: z.number().int(),
  }),
  documents: z.object({
    total: z.number().int(),
    indexed: z.number().int(),
    failed: z.number().int(),
  }),
  activity: z.array(
    z.object({
      kind: z.string(),
      title: z.string(),
      link: z.string().nullable(),
      created_at: z.string().datetime(),
    }),
  ),
});
export type OverviewStats = z.infer<typeof overviewStatsSchema>;

export const qualityStatsSchema = z.object({
  sessions_completed: z.number().int(),
  sessions_abandoned_7d: z.number().int(),
  tests_proposed: z.number().int(),
  tests_recorded: z.number().int(),
  hypotheses: z.object({
    total: z.number().int(),
    supported: z.number().int(),
    weakened: z.number().int(),
    verified: z.number().int(),
    ruled_out: z.number().int(),
  }),
  reports: z.object({ total: z.number().int(), with_verified: z.number().int() }),
  validation_failures: z.number().int(),
});
export type QualityStats = z.infer<typeof qualityStatsSchema>;

export const healthCheckSchema = z.object({
  service: z.string(),
  status: z.enum(["ok", "degraded", "down"]),
  latency_ms: z.number().nullable(),
  detail: z.string(),
  checked_at: z.string().datetime(),
});
export type HealthCheck = z.infer<typeof healthCheckSchema>;

export const listHealthResponseSchema = z.object({
  checks: z.array(healthCheckSchema),
});
export type ListHealthResponse = z.infer<typeof listHealthResponseSchema>;

export const platformSettingsSchema = z.object({
  platform_name: z.string(),
  support_contact: z.string(),
  demo_enabled: z.boolean(),
  ai_meta_enabled: z.boolean(),
  upload_limit_mb: z.number().int(),
  session_ttl_days: z.number().int(),
  login_rate_limit: z.string(),
});
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

export const updateSettingsSchema = z.object({
  platform_name: z.string().trim().min(1).max(120).optional(),
  support_contact: z.string().trim().min(3).max(254).optional(),
  demo_enabled: z.boolean().optional(),
  ai_meta_enabled: z.boolean().optional(),
});
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;

export const publicMetaSchema = z.object({
  platform_name: z.string(),
  support_contact: z.string(),
  demo_enabled: z.boolean(),
});
export type PublicMeta = z.infer<typeof publicMetaSchema>;

export const updateDocumentPermissionSchema = z.object({
  permission_status: z.enum(["pending", "approved", "restricted", "rejected"]),
});
export type UpdateDocumentPermission = z.infer<typeof updateDocumentPermissionSchema>;

export const adminIngestionJobSchema = ingestionJobResponseSchema.extend({
  document_title: z.string().nullable(),
});
export type AdminIngestionJob = z.infer<typeof adminIngestionJobSchema>;

export const listIngestionJobsResponseSchema = z.object({
  jobs: z.array(adminIngestionJobSchema),
  total: z.number().int(),
});
export type ListIngestionJobsResponse = z.infer<typeof listIngestionJobsResponseSchema>;
