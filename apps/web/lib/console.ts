import { z } from "zod";
import {
  adminDocumentListResponseSchema,
  adminDocumentResponseSchema,
  adminMeSchema,
  adminUserSchema,
  bulkImportResponseSchema,
  healthCheckSchema,
  ingestionJobDetailResponseSchema,
  listAdminEvidenceResponseSchema,
  listAuditLogsResponseSchema,
  listIngestionJobsResponseSchema,
  listModelRunsResponseSchema,
  listNotificationsResponseSchema,
  listProvidersResponseSchema,
  listReportsResponseSchema,
  listSupplierProductsResponseSchema,
  listSuppliersResponseSchema,
  supplierProductResponseSchema,
  supplierResponseSchema,
  supplierSyncResponseSchema,
  listSafetyEventsResponseSchema,
  listSessionsResponseSchema,
  listUsersResponseSchema,
  notificationSchema,
  overviewStatsSchema,
  platformSettingsSchema,
  providerTestResponseSchema,
  publicMetaSchema,
  qualityStatsSchema,
  reportResponseSchema,
  sessionDetailResponseSchema,
  type AdminMe,
  type AdminSessionItem,
  type AuditLog,
  type AdminNotification,
  type CreateAnnouncement,
  type CreateManualProduct,
  type CreateSupplier,
  type HealthCheck,
  type ListSupplierProductsResponse,
  type ListSuppliersResponse,
  type Supplier,
  type SupplierProduct,
  type SupplierSyncResult,
  type UpdateSupplier,
  type UpdateSupplierProduct,
  type IngestionJobDetailResponse,
  type ListAdminEvidenceResponse,
  type ListAuditLogsResponse,
  type ListIngestionJobsResponse,
  type ListModelRunsResponse,
  type ListNotificationsResponse,
  type ListProvidersResponse,
  type ListSafetyEventsResponse,
  type ListSessionsResponse,
  type ListUsersResponse,
  type OverviewStats,
  type PlatformSettings,
  type ProviderTestResponse,
  type PublicMeta,
  type QualityStats,
  type ReportResponse,
  type ReviewSafetyEvent,
  type SessionDetailResponse,
  type UpdateDocumentPermission,
  type UpdateProvider,
  type UpdateSettings,
  type UpdateUser,
  type AdminDocumentListResponse,
  type AdminDocumentResponse,
} from "@fieldfix/contracts";
import { getApiBaseUrl } from "./env";
import { parseApiResponse, request, safeParseWith } from "./api";

export type {
  AdminMe,
  AdminSessionItem,
  AuditLog,
  AdminNotification,
  HealthCheck,
  OverviewStats,
  PlatformSettings,
  PublicMeta,
  QualityStats,
};
export type { CreateAnnouncement, ReviewSafetyEvent, UpdateSettings, UpdateUser };

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const out = search.toString();
  return out ? `?${out}` : "";
}

export interface PageParams {
  limit?: number;
  offset?: number;
}

/** Typed admin-console API client (user login token or legacy admin token). */
export function consoleApi(token: string) {
  const get = <T>(
    path: string,
    schema: { safeParse: (data: unknown) => { success: boolean; data?: T } },
    context: string,
    signal?: AbortSignal,
  ) =>
    request(path, { token, signal }).then((res) =>
      parseApiResponse(res, safeParseWith(schema), context),
    );

  return {
    me: (signal?: AbortSignal) =>
      get("/api/v1/admin/me", adminMeSchema, "Admin identity", signal),

    overview: (days: number, signal?: AbortSignal) =>
      get(`/api/v1/admin/overview${qs({ days })}`, overviewStatsSchema, "Overview", signal),

    users: (params: Record<string, string | number | undefined>, signal?: AbortSignal) =>
      get(`/api/v1/admin/users${qs(params)}`, listUsersResponseSchema, "Users", signal),
    userDetail: (id: string, signal?: AbortSignal) =>
      get(
        `/api/v1/admin/users/${id}`,
        z.object({
          user: adminUserSchema,
          sessions: z.array(
            z.object({
              id: z.string(),
              device_type: z.string(),
              manufacturer: z.string().nullable(),
              model: z.string().nullable(),
              status: z.string(),
              safety_state: z.string(),
              created_at: z.string(),
              updated_at: z.string(),
            }),
          ),
          reports: z.array(
            z.object({
              id: z.string(),
              session_id: z.string(),
              device_type: z.string(),
              status: z.string(),
              created_at: z.string(),
            }),
          ),
        }),
        "User detail",
        signal,
      ),
    updateUser: (id: string, input: UpdateUser, signal?: AbortSignal) =>
      request(`/api/v1/admin/users/${id}`, { method: "PATCH", token, body: input, signal }).then(
        (res) => {
              return parseApiResponse(
            res,
            safeParseWith(z.object({ user: z.unknown() })),
            "User update",
          );
        },
      ),
    resetUserPassword: (id: string, signal?: AbortSignal) =>
      request(`/api/v1/admin/users/${id}/password-reset`, {
        method: "POST",
        token,
        body: {},
        signal,
      }).then((res) =>
        parseApiResponse(res, safeParseWith(z.object({ ok: z.boolean() })), "Password reset"),
      ),

    sessions: (params: Record<string, string | number | undefined>, signal?: AbortSignal) =>
      get(`/api/v1/admin/sessions${qs(params)}`, listSessionsResponseSchema, "Sessions", signal),
    sessionDetail: (id: string, signal?: AbortSignal): Promise<SessionDetailResponse> =>
      get(`/api/v1/admin/sessions/${id}`, sessionDetailResponseSchema, "Session detail", signal),

    reports: (params: Record<string, string | number | undefined>, signal?: AbortSignal) =>
      get(`/api/v1/admin/reports${qs(params)}`, listReportsResponseSchema, "Reports", signal),
    report: (id: string, signal?: AbortSignal): Promise<{ report: ReportResponse }> =>
      get(
        `/api/v1/admin/reports/${id}`,
        z.object({ report: reportResponseSchema }),
        "Report",
        signal,
      ),

    evidence: (params: Record<string, string | number | undefined>, signal?: AbortSignal) =>
      get(
        `/api/v1/admin/evidence${qs(params)}`,
        listAdminEvidenceResponseSchema,
        "Evidence",
        signal,
      ) as Promise<ListAdminEvidenceResponse>,

    modelRuns: (params: Record<string, string | number | undefined>, signal?: AbortSignal) =>
      get(`/api/v1/admin/model-runs${qs(params)}`, listModelRunsResponseSchema, "Model runs", signal) as Promise<ListModelRunsResponse>,

    providers: (signal?: AbortSignal) =>
      get("/api/v1/admin/providers", listProvidersResponseSchema, "Providers", signal) as Promise<ListProvidersResponse>,
    testProvider: (id: string, signal?: AbortSignal) =>
      request(`/api/v1/admin/providers/${id}/test`, { method: "POST", token, body: {}, signal }).then(
        (res) => parseApiResponse(res, safeParseWith(providerTestResponseSchema), "Provider test"),
      ) as Promise<ProviderTestResponse>,
    toggleProvider: (id: string, input: UpdateProvider, signal?: AbortSignal) => {
      return request(`/api/v1/admin/providers/${id}`, {
        method: "PATCH",
        token,
        body: input,
        signal,
      }).then((res) =>
        parseApiResponse(res, safeParseWith(z.object({ id: z.string(), enabled: z.boolean() })), "Provider update"),
      );
    },

    suppliers: (signal?: AbortSignal) =>
      get("/api/v1/admin/suppliers", listSuppliersResponseSchema, "Suppliers", signal) as Promise<ListSuppliersResponse>,
    createSupplier: (input: CreateSupplier, signal?: AbortSignal) =>
      request("/api/v1/admin/suppliers", { method: "POST", token, body: input, signal }).then((res) =>
        parseApiResponse(res, safeParseWith(supplierResponseSchema), "Supplier create"),
      ).then((parsed) => (parsed as { supplier: Supplier }).supplier),
    patchSupplier: (id: string, input: UpdateSupplier, signal?: AbortSignal) =>
      request(`/api/v1/admin/suppliers/${id}`, { method: "PATCH", token, body: input, signal }).then((res) =>
        parseApiResponse(res, safeParseWith(supplierResponseSchema), "Supplier update"),
      ).then((parsed) => (parsed as { supplier: Supplier }).supplier),
    deleteSupplier: (id: string, signal?: AbortSignal) =>
      request(`/api/v1/admin/suppliers/${id}`, { method: "DELETE", token, signal }).then((res) =>
        parseApiResponse(res, safeParseWith(z.object({ ok: z.boolean() })), "Supplier delete"),
      ),
    syncSupplier: (id: string, signal?: AbortSignal) =>
      request(`/api/v1/admin/suppliers/${id}/sync`, { method: "POST", token, body: {}, signal }).then((res) =>
        parseApiResponse(res, safeParseWith(supplierSyncResponseSchema), "Supplier sync"),
      ).then((parsed) => (parsed as { sync: SupplierSyncResult }).sync),
    supplierProducts: (id: string, params: { limit?: number; offset?: number; q?: string }, signal?: AbortSignal) =>
      get(
        `/api/v1/admin/suppliers/${id}/products${qs(params)}`,
        listSupplierProductsResponseSchema,
        "Listings",
        signal,
      ) as Promise<ListSupplierProductsResponse>,
    createSupplierProduct: (id: string, input: CreateManualProduct, signal?: AbortSignal) =>
      request(`/api/v1/admin/suppliers/${id}/products`, { method: "POST", token, body: input, signal }).then((res) =>
        parseApiResponse(res, safeParseWith(supplierProductResponseSchema), "Listing create"),
      ).then((parsed) => (parsed as { product: SupplierProduct }).product),
    patchSupplierProduct: (id: string, productId: string, input: UpdateSupplierProduct, signal?: AbortSignal) =>
      request(`/api/v1/admin/suppliers/${id}/products/${productId}`, { method: "PATCH", token, body: input, signal }).then((res) =>
        parseApiResponse(res, safeParseWith(supplierProductResponseSchema), "Listing update"),
      ).then((parsed) => (parsed as { product: SupplierProduct }).product),
    deleteSupplierProduct: (id: string, productId: string, signal?: AbortSignal) =>
      request(`/api/v1/admin/suppliers/${id}/products/${productId}`, { method: "DELETE", token, signal }).then((res) =>
        parseApiResponse(res, safeParseWith(z.object({ ok: z.boolean() })), "Listing delete"),
      ),

    documents: (signal?: AbortSignal) =>
      get("/api/v1/admin/documents?limit=100", adminDocumentListResponseSchema, "Documents", signal) as Promise<AdminDocumentListResponse>,
    patchDocument: (id: string, input: UpdateDocumentPermission, signal?: AbortSignal) => {
      return request(`/api/v1/admin/documents/${id}`, {
        method: "PATCH",
        token,
        body: input,
        signal,
      }).then((res) =>
        parseApiResponse(res, safeParseWith(z.object({ ok: z.boolean() })), "Document update"),
      );
    },
    uploadDocument: (file: File, metadata: Record<string, unknown>, source: string, signal?: AbortSignal) =>
      (async (): Promise<AdminDocumentResponse> => {
        const form = new FormData();
        form.append("file", file);
        form.append("metadata", JSON.stringify(metadata));
        form.append("source", source);
        const res = await fetch(`${getApiBaseUrl()}/api/v1/admin/documents`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
          signal,
        });
        return parseApiResponse(res, safeParseWith(adminDocumentResponseSchema), "Document upload");
      })(),
    reingest: (documentId: string, signal?: AbortSignal) =>
      request("/api/v1/admin/ingestion-jobs", {
        method: "POST",
        token,
        body: { document_id: documentId },
        signal,
      }).then((res) =>
        parseApiResponse(res, safeParseWith(adminDocumentResponseSchema), "Re-ingestion"),
      ) as Promise<AdminDocumentResponse>,
    registerConnector: (
      input: { connector: string; ref: string; limit?: number },
      signal?: AbortSignal,
    ) =>
      request("/api/v1/admin/documents", {
        method: "POST",
        token,
        body: input,
        signal,
      }).then((res) =>
        parseApiResponse(
          res,
          safeParseWith(z.union([adminDocumentResponseSchema, bulkImportResponseSchema])),
          "Connector import",
        ),
      ),
    ingestionJobs: (params: Record<string, string | number | undefined>, signal?: AbortSignal) =>
      get(
        `/api/v1/admin/ingestion-jobs${qs(params)}`,
        listIngestionJobsResponseSchema,
        "Ingestion jobs",
        signal,
      ) as Promise<ListIngestionJobsResponse>,
    ingestionJob: (id: string, signal?: AbortSignal) =>
      get(
        `/api/v1/admin/ingestion-jobs/${id}`,
        ingestionJobDetailResponseSchema,
        "Ingestion job",
        signal,
      ) as Promise<IngestionJobDetailResponse>,

    safetyEvents: (params: Record<string, string | number | undefined>, signal?: AbortSignal) =>
      get(
        `/api/v1/admin/safety-events${qs(params)}`,
        listSafetyEventsResponseSchema,
        "Safety events",
        signal,
      ) as Promise<ListSafetyEventsResponse>,
    reviewSafety: (id: string, input: ReviewSafetyEvent, signal?: AbortSignal) => {
      return request(`/api/v1/admin/safety-events/${id}/review`, {
        method: "POST",
        token,
        body: input,
        signal,
      }).then((res) =>
        parseApiResponse(res, safeParseWith(z.object({ ok: z.boolean() })), "Safety review"),
      );
    },

    quality: (signal?: AbortSignal) =>
      get("/api/v1/admin/quality", qualityStatsSchema, "Quality", signal) as Promise<QualityStats>,

    notifications: (params: Record<string, string | number | undefined>, signal?: AbortSignal) =>
      get(
        `/api/v1/admin/notifications${qs(params)}`,
        listNotificationsResponseSchema,
        "Notifications",
        signal,
      ) as Promise<ListNotificationsResponse>,
    announce: (input: CreateAnnouncement, signal?: AbortSignal) => {
      return request("/api/v1/admin/notifications", {
        method: "POST",
        token,
        body: input,
        signal,
      }).then((res) =>
        parseApiResponse(res, safeParseWith(z.object({ notification: notificationSchema })), "Announcement"),
      );
    },
    markRead: (id: string, signal?: AbortSignal) =>
      request(`/api/v1/admin/notifications/${id}/read`, {
        method: "POST",
        token,
        body: {},
        signal,
      }).then((res) =>
        parseApiResponse(res, safeParseWith(z.object({ ok: z.boolean() })), "Mark read"),
      ),
    readAll: (signal?: AbortSignal) =>
      request("/api/v1/admin/notifications/read-all", {
        method: "POST",
        token,
        body: {},
        signal,
      }).then((res) =>
        parseApiResponse(res, safeParseWith(z.object({ ok: z.boolean() })), "Mark all read"),
      ),

    health: (signal?: AbortSignal) =>
      get("/api/v1/admin/health", z.object({ checks: z.array(healthCheckSchema) }), "Health", signal),

    auditLogs: (params: Record<string, string | number | undefined>, signal?: AbortSignal) =>
      get(`/api/v1/admin/audit-logs${qs(params)}`, listAuditLogsResponseSchema, "Audit logs", signal) as Promise<ListAuditLogsResponse>,

    settings: (signal?: AbortSignal) =>
      get("/api/v1/admin/settings", platformSettingsSchema, "Settings", signal) as Promise<PlatformSettings>,
    updateSettings: (input: UpdateSettings, signal?: AbortSignal) => {
      return request("/api/v1/admin/settings", {
        method: "PATCH",
        token,
        body: input,
        signal,
      }).then((res) => parseApiResponse(res, safeParseWith(platformSettingsSchema), "Settings update")) as Promise<PlatformSettings>;
    },
  };
}

export type ConsoleApi = ReturnType<typeof consoleApi>;

/** Public platform metadata (no auth). */
export async function publicMetaApi(signal?: AbortSignal): Promise<PublicMeta> {
  const res = await request("/api/v1/meta", { signal });
  return parseApiResponse(res, safeParseWith(publicMetaSchema), "Platform metadata");
}

/** Binary download helpers (report PDFs, evidence previews). */
export async function consoleDownload(
  token: string,
  path: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await request(path, { token, signal });
  if (!res.ok) {
    const { ApiError } = await import("./api");
    throw new ApiError(res.status, "request_failed", `Download failed (HTTP ${res.status}).`);
  }
  return res.blob();
}

export type { ListSessionsResponse, ListUsersResponse };
