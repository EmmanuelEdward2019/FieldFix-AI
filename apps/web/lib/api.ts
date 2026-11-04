import { z } from "zod";
import {
  adminDocumentListResponseSchema,
  adminDocumentResponseSchema,
  analyzeResponseSchema,
  authResponseSchema,
  apiErrorSchema,
  contactRequestResponseSchema,
  createSessionResponseSchema,
  customerDeviceResponseSchema,
  handoffDetailResponseSchema,
  handoffResponseSchema,
  hypothesisResponseSchema,
  ingestionJobDetailResponseSchema,
  inventoryItemResponseSchema,
  inventoryMovementResponseSchema,
  knowledgeSearchResponseSchema,
  listActivityResponseSchema,
  listContactRequestsResponseSchema,
  listCustomerDevicesResponseSchema,
  listInventoryMovementsResponseSchema,
  listInventoryResponseSchema,
  listMyNotificationsResponseSchema,
  listOwnedReportsResponseSchema,
  listRepairEstimatesResponseSchema,
  listRepairJobEventsResponseSchema,
  listRepairJobsResponseSchema,
  listShopCustomersResponseSchema,
  listShopMembersResponseSchema,
  listShopsResponseSchema,
  listTechniciansResponseSchema,
  loginResponseSchema,
  logVoiceInteractionResponseSchema,
  mfaEnrollResponseSchema,
  mfaStatusResponseSchema,
  mfaVerifyResponseSchema,
  listMySessionsResponseSchema,
  listPartRecommendationsResponseSchema,
  listSegmentationsResponseSchema,
  listToolRecommendationsResponseSchema,
  getIdentificationResponseSchema,
  identifyResponseSchema,
  partOffersResponseSchema,
  partRecommendationResponseSchema,
  recordResultResponseSchema,
  registerResponseSchema,
  repairEstimateResponseSchema,
  repairJobDetailResponseSchema,
  repairJobEventResponseSchema,
  repairJobResponseSchema,
  reportResponseSchema,
  safetyEventResponseSchema,
  segmentResponseSchema,
  sessionDetailResponseSchema,
  shopCustomerResponseSchema,
  shopMemberResponseSchema,
  shopReportSummaryResponseSchema,
  shopResponseSchema,
  speakPolicyResponseSchema,
  toolRecommendationResponseSchema,
  technicianResponseSchema,
  transcribeResponseSchema,
  uploadEvidenceResponseSchema,
  userResponseSchema,
  voiceCapabilitiesSchema,
  voicePreferencesResponseSchema,
  type AddShopMember,
  type AdminDocumentListResponse,
  type AdminDocumentResponse,
  type AnalyzeResponse,
  type AttachJobSession,
  type AuthResponse,
  type ContactRequest,
  type ContactRequestStatus,
  type CreateContactRequest,
  type CreateCustomerDevice,
  type CreateHandoff,
  type CreateInventoryItem,
  type CreateInventoryMovement,
  type CreatePartRecommendation,
  type CreateRepairEstimate,
  type CreateRepairJob,
  type CreateRepairJobEvent,
  type CreateSession,
  type CreateSessionResponse,
  type CreateShop,
  type CreateShopCustomer,
  type CreateToolRecommendation,
  type CustomerDevice,
  type DiagnosticHandoff,
  type HandoffDetailResponse,
  type HypothesisResponse,
  type IngestionJobDetailResponse,
  type InventoryItem,
  type InventoryMovementResponse,
  type JobPriority,
  type JobStatus,
  type KnowledgeSearch,
  type KnowledgeSearchResponse,
  type ListActivityResponse,
  type ListContactRequestsResponse,
  type ListCustomerDevicesResponse,
  type ListInventoryMovementsResponse,
  type ListInventoryResponse,
  type ListMyNotificationsResponse,
  type ListMySessionsResponse,
  type ListPartRecommendationsResponse,
  type ListRepairEstimatesResponse,
  type ListRepairJobEventsResponse,
  type ListRepairJobsResponse,
  type ListShopCustomersResponse,
  type ListShopMembersResponse,
  type ListShopsResponse,
  type ListTechniciansResponse,
  type ListToolRecommendationsResponse,
  type PartOffersResponse,
  type LoginResponse,
  type ListOwnedReportsResponse,
  type PartRecommendation,
  type MfaEnrollResponse,
  type MfaStatusResponse,
  type MfaVerifyResponse,
  type ListSegmentationsResponse,
  type GetIdentificationResponse,
  type IdentifyResponse,
  type LogVoiceInteractionResponse,
  type RecordResultResponse,
  type RecordTestResult,
  type Register,
  type RegisterResponse,
  type RepairEstimateResponse,
  type RepairJob,
  type RepairJobDetailResponse,
  type RepairJobEvent,
  type RepairJobEventResponse,
  type ReportResponse,
  type ResetPassword,
  type SafetyEventResponse,
  type SafetyState,
  type SegmentResponse,
  type SessionDetailResponse,
  type Shop,
  type ShopCustomer,
  type ShopMember,
  type ShopReportSummaryResponse,
  type ShopResponse,
  type SpeakPolicyResponse,
  type SpeakRequest,
  type TechnicianCard,
  type ToolRecommendation,
  type TranscribeMode,
  type TranscribeResponse,
  type UpdateInventoryItem,
  type UpdateRecommendationStatus,
  type UpdateRepairEstimate,
  type UpsertOwnTechnicianProfile,
  type UpdateRepairJob,
  type UpdateShop,
  type UpdateShopCustomer,
  type UpdateShopMember,
  type UpdateVoicePreferences,
  type UploadEvidenceResponse,
  type UserResponse,
  type VoiceCapabilities,
  type VoicePreferencesResponse,
  type VoiceRole,
} from "@fieldfix/contracts";
import { getApiBaseUrl } from "./env";

/** Typed API failure with the server's error code when available. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface JsonResponse {
  status: number;
  json(): Promise<unknown>;
}

/**
 * Parse a JSON API response: error envelope on failure, contract schema
 * on success. Shared by the fetch and XHR paths.
 */
export async function parseApiResponse<T>(
  res: JsonResponse,
  parse: (data: unknown) => { success: boolean; data?: T },
  context: string,
): Promise<T> {
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status < 200 || res.status >= 300) {
    const parsed = apiErrorSchema.safeParse(data);
    throw new ApiError(
      res.status,
      parsed.success ? parsed.data.error.code : "request_failed",
      parsed.success
        ? parsed.data.error.message
        : `${context} failed (HTTP ${res.status}).`,
    );
  }
  const parsed = parse(data);
  if (!parsed.success || parsed.data === undefined) {
    throw new ApiError(
      res.status,
      "bad_response",
      `${context} returned an unexpected shape.`,
    );
  }
  return parsed.data;
}

export function safeParseWith<T>(schema: {
  safeParse: (data: unknown) => { success: boolean; data?: T };
}) {
  return (data: unknown) => schema.safeParse(data);
}

export async function request(
  path: string,
  init: {
    method?: string;
    token?: string;
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.token) {
    headers.Authorization = `Bearer ${init.token}`;
  }
  let payload: string | undefined;
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(init.body);
  }
  return fetch(`${getApiBaseUrl()}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: payload,
    signal: init.signal,
  });
}

export async function createSessionApi(
  input: CreateSession,
  signal?: AbortSignal,
  token?: string,
): Promise<CreateSessionResponse> {
  const res = await request("/api/v1/sessions", {
    method: "POST",
    body: input,
    signal,
    ...(token ? { token } : {}),
  });
  return parseApiResponse(
    res,
    safeParseWith(createSessionResponseSchema),
    "Session creation",
  );
}

export async function getSessionDetailApi(
  id: string,
  token: string,
  signal?: AbortSignal,
): Promise<SessionDetailResponse> {
  const res = await request(`/api/v1/sessions/${id}`, { token, signal });
  return parseApiResponse(
    res,
    safeParseWith(sessionDetailResponseSchema),
    "Session load",
  );
}

export interface UploadProgress {
  loaded: number;
  total: number | null;
}

export interface UploadOptions {
  observation?: string;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

/**
 * Multipart evidence upload with progress events (XHR — fetch has no
 * upload progress). Aborting the signal cancels the request.
 */
export function uploadEvidenceApi(
  sessionId: string,
  token: string,
  file: File,
  options: UploadOptions = {},
): Promise<UploadEvidenceResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file, file.name);
    if (options.observation?.trim()) {
      form.append("observation", options.observation.trim());
    }

    const onAbort = () => xhr.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    xhr.upload.onprogress = (event: ProgressEvent) => {
      options.onProgress?.({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : null,
      });
    };
    xhr.onerror = () => {
      options.signal?.removeEventListener("abort", onAbort);
      reject(new ApiError(0, "network_error", "Upload failed: network error."));
    };
    xhr.onabort = () => {
      options.signal?.removeEventListener("abort", onAbort);
      reject(new ApiError(0, "upload_aborted", "Upload cancelled."));
    };
    xhr.onload = () => {
      options.signal?.removeEventListener("abort", onAbort);
      const payload = (): Promise<unknown> =>
        Promise.resolve().then(() => JSON.parse(xhr.responseText || "null"));
      void parseApiResponse(
        { status: xhr.status, json: payload },
        safeParseWith(uploadEvidenceResponseSchema),
        "Evidence upload",
      ).then(resolve, reject);
    };

    xhr.open("POST", `${getApiBaseUrl()}/api/v1/sessions/${sessionId}/evidence`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(form);
  });
}

/** Download private evidence bytes (object URL created by the caller). */
export async function fetchEvidenceBlob(
  sessionId: string,
  fileId: string,
  token: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await request(
    `/api/v1/sessions/${sessionId}/evidence/${fileId}/download`,
    { token, signal },
  );
  if (!res.ok) {
    const data: unknown = await res.json().catch(() => null);
    const parsed = apiErrorSchema.safeParse(data);
    throw new ApiError(
      res.status,
      parsed.success ? parsed.data.error.code : "request_failed",
      parsed.success ? parsed.data.error.message : "Download failed.",
    );
  }
  return res.blob();
}

/**
 * Run component localization on an evidence image. Concepts default
 * server-side to the device vocabulary when omitted. Localization only —
 * the response carries regions, never a fault diagnosis.
 */
export async function segmentEvidenceApi(
  sessionId: string,
  fileId: string,
  token: string,
  concepts?: string[],
  signal?: AbortSignal,
): Promise<SegmentResponse> {
  const res = await request(
    `/api/v1/sessions/${sessionId}/evidence/${fileId}/segmentations`,
    { method: "POST", token, body: concepts ? { concepts } : {}, signal },
  );
  return parseApiResponse(
    res,
    safeParseWith(segmentResponseSchema),
    "Component localization",
  );
}

/**
 * Identify the device and visible components in an evidence image.
 * Additive intelligence: names plus SAM regions, never a diagnosis.
 */
export async function identifyEvidenceApi(
  sessionId: string,
  fileId: string,
  token: string,
  signal?: AbortSignal,
): Promise<IdentifyResponse> {
  const res = await request(
    `/api/v1/sessions/${sessionId}/evidence/${fileId}/identification`,
    { method: "POST", token, body: {}, signal },
  );
  return parseApiResponse(
    res,
    safeParseWith(identifyResponseSchema),
    "Component identification",
  );
}

/** Fetch the latest persisted identification for an image, if any. */
export async function getIdentificationApi(
  sessionId: string,
  fileId: string,
  token: string,
  signal?: AbortSignal,
): Promise<GetIdentificationResponse> {
  const res = await request(
    `/api/v1/sessions/${sessionId}/evidence/${fileId}/identification`,
    { token, signal },
  );
  return parseApiResponse(
    res,
    safeParseWith(getIdentificationResponseSchema),
    "Identification load",
  );
}

/** Fetch previously persisted segmentation annotations for an image. */
export async function listSegmentationsApi(
  sessionId: string,
  fileId: string,
  token: string,
  signal?: AbortSignal,
): Promise<ListSegmentationsResponse> {
  const res = await request(
    `/api/v1/sessions/${sessionId}/evidence/${fileId}/segmentations`,
    { token, signal },
  );
  return parseApiResponse(
    res,
    safeParseWith(listSegmentationsResponseSchema),
    "Segmentation load",
  );
}

/** Run one AI analysis pass over the session's current state. */
export async function analyzeSessionApi(
  sessionId: string,
  token: string,
  input: { question?: string } = {},
  signal?: AbortSignal,
): Promise<AnalyzeResponse> {
  const res = await request(`/api/v1/sessions/${sessionId}/analyze`, {
    method: "POST",
    token,
    body: input,
    signal,
  });
  return parseApiResponse(res, safeParseWith(analyzeResponseSchema), "AI analysis");
}

/** Record a user-reported result for a diagnostic test. */
export async function recordTestResultApi(
  sessionId: string,
  testId: string,
  token: string,
  input: RecordTestResult,
  signal?: AbortSignal,
): Promise<RecordResultResponse> {
  const res = await request(`/api/v1/sessions/${sessionId}/tests/${testId}/results`, {
    method: "POST",
    token,
    body: input,
    signal,
  });
  return parseApiResponse(
    res,
    safeParseWith(recordResultResponseSchema),
    "Result recording",
  );
}

/** Technician-only: mark a hypothesis verified. */
export async function verifyHypothesisApi(
  sessionId: string,
  hypothesisId: string,
  token: string,
  rationale: string,
  signal?: AbortSignal,
): Promise<HypothesisResponse> {
  const res = await request(
    `/api/v1/sessions/${sessionId}/hypotheses/${hypothesisId}/verify`,
    { method: "POST", token, body: { rationale }, signal },
  );
  const parsed = await parseApiResponse(
    res,
    safeParseWith(z.object({ hypothesis: hypothesisResponseSchema })),
    "Hypothesis verification",
  );
  return parsed.hypothesis;
}

/** Request a safety-state transition (controller gates legality). */
export async function transitionSafetyApi(
  sessionId: string,
  token: string,
  input: { to_state: SafetyState; rationale: string },
  signal?: AbortSignal,
): Promise<SafetyEventResponse> {
  const res = await request(`/api/v1/sessions/${sessionId}/safety/transition`, {
    method: "POST",
    token,
    body: input,
    signal,
  });
  const parsed = await parseApiResponse(
    res,
    safeParseWith(z.object({ safety_event: safetyEventResponseSchema })),
    "Safety transition",
  );
  return parsed.safety_event;
}

/** Compile the current repair-report snapshot. */
export async function getReportApi(
  sessionId: string,
  token: string,
  signal?: AbortSignal,
): Promise<ReportResponse> {
  const res = await request(`/api/v1/sessions/${sessionId}/report`, { token, signal });
  const parsed = await parseApiResponse(
    res,
    safeParseWith(z.object({ report: reportResponseSchema })),
    "Report load",
  );
  return parsed.report;
}

/** Email the session owner a copy of the compiled report. Needs a login token. */
export async function emailReportCopyApi(
  sessionId: string,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await request(`/api/v1/sessions/${sessionId}/report/email`, {
    token,
    signal,
    method: "POST",
  });
  await parseApiResponse(res, safeParseWith(z.object({ ok: z.boolean() })), "Report email");
}

/** Download the repair-report PDF snapshot. */
export async function fetchReportPdfApi(
  sessionId: string,
  token: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await request(`/api/v1/sessions/${sessionId}/report?format=pdf`, {
    token,
    signal,
  });
  if (!res.ok) {
    const data: unknown = await res.json().catch(() => null);
    const parsed = apiErrorSchema.safeParse(data);
    throw new ApiError(
      res.status,
      parsed.success ? parsed.data.error.code : "request_failed",
      parsed.success ? parsed.data.error.message : "Report download failed.",
    );
  }
  return res.blob();
}

/** Register a new account; the user must confirm via email before signing in. */
export async function registerApi(input: Register, signal?: AbortSignal): Promise<RegisterResponse> {
  const res = await request("/api/v1/auth/register", { method: "POST", body: input, signal });
  return parseApiResponse(res, safeParseWith(registerResponseSchema), "Registration");
}

/** Confirm an email address; success signs the user in. */
export async function verifyEmailApi(token: string, signal?: AbortSignal): Promise<AuthResponse> {
  const res = await request("/api/v1/auth/verify-email", {
    method: "POST",
    body: { token },
    signal,
  });
  return parseApiResponse(res, safeParseWith(authResponseSchema), "Email confirmation");
}

/** Re-request the confirmation link (uniform response, no enumeration). */
export async function resendConfirmationApi(email: string, signal?: AbortSignal): Promise<void> {
  const res = await request("/api/v1/auth/verify-email/resend", {
    method: "POST",
    body: { email },
    signal,
  });
  await parseApiResponse(res, safeParseWith(z.object({ ok: z.boolean() })), "Resend confirmation");
}

/** Request a password-reset link (uniform response, no enumeration). */
export async function forgotPasswordApi(email: string, signal?: AbortSignal): Promise<void> {
  const res = await request("/api/v1/auth/password/forgot", {
    method: "POST",
    body: { email },
    signal,
  });
  await parseApiResponse(res, safeParseWith(z.object({ ok: z.boolean() })), "Password reset request");
}

/** Set a new password from a reset link (single-use, signs out everywhere). */
export async function resetPasswordApi(
  input: ResetPassword,
  signal?: AbortSignal,
): Promise<void> {
  const res = await request("/api/v1/auth/password/reset", {
    method: "POST",
    body: input,
    signal,
  });
  if (!res.ok && res.status !== 204) {
    await parseApiResponse(res, safeParseWith(z.object({})), "Password reset");
  }
}

/**
 * Log in with email + password. Enrolled accounts get an MFA challenge
 * token instead of a session — complete it with mfaChallengeApi.
 */
export async function loginApi(
  input: { email: string; password: string },
  signal?: AbortSignal,
): Promise<LoginResponse> {
  const res = await request("/api/v1/auth/login", { method: "POST", body: input, signal });
  return parseApiResponse(res, safeParseWith(loginResponseSchema), "Sign in");
}

/** Complete an MFA login challenge with a TOTP or backup code. */
export async function mfaChallengeApi(
  input: { mfa_token: string; code: string },
  signal?: AbortSignal,
): Promise<AuthResponse> {
  const res = await request("/api/v1/auth/mfa/challenge", {
    method: "POST",
    body: input,
    signal,
  });
  return parseApiResponse(res, safeParseWith(authResponseSchema), "Two-factor check");
}

/** Whether the signed-in user has verified two-factor authentication. */
export async function mfaStatusApi(
  token: string,
  signal?: AbortSignal,
): Promise<MfaStatusResponse> {
  const res = await request("/api/v1/auth/mfa/status", { token, signal });
  return parseApiResponse(res, safeParseWith(mfaStatusResponseSchema), "Two-factor status");
}

/** Start enrollment: returns the authenticator secret (pending until verified). */
export async function mfaEnrollApi(
  token: string,
  signal?: AbortSignal,
): Promise<MfaEnrollResponse> {
  const res = await request("/api/v1/auth/mfa/enroll", { method: "POST", token, signal });
  return parseApiResponse(res, safeParseWith(mfaEnrollResponseSchema), "Two-factor setup");
}

/** Verify a code: activates enrollment (yields backup codes) or confirms it works. */
export async function mfaVerifyApi(
  token: string,
  input: { code: string },
  signal?: AbortSignal,
): Promise<MfaVerifyResponse> {
  const res = await request("/api/v1/auth/mfa/verify", {
    method: "POST",
    token,
    body: input,
    signal,
  });
  return parseApiResponse(res, safeParseWith(mfaVerifyResponseSchema), "Two-factor check");
}

/** Disable two-factor (requires a current TOTP or backup code). */
export async function mfaDisableApi(
  token: string,
  input: { code: string },
  signal?: AbortSignal,
): Promise<void> {
  const res = await request("/api/v1/auth/mfa/disable", {
    method: "POST",
    token,
    body: input,
    signal,
  });
  if (!res.ok) {
    await parseApiResponse(res, safeParseWith(z.object({})), "Two-factor removal");
  }
}

/** Log out the current token (server-side invalidation). */
export async function logoutApi(token: string, signal?: AbortSignal): Promise<void> {
  const res = await request("/api/v1/auth/logout", { method: "POST", token, signal });
  if (!res.ok && res.status !== 204) {
    await parseApiResponse(res, safeParseWith(z.object({})), "Sign out");
  }
}

/** Fetch the signed-in user's profile. */
export async function meApi(token: string, signal?: AbortSignal): Promise<UserResponse> {
  const res = await request("/api/v1/auth/me", { token, signal });
  const parsed = await parseApiResponse(
    res,
    safeParseWith(z.object({ user: userResponseSchema })),
    "Profile load",
  );
  return parsed.user;
}

/** Update the signed-in user's display name. */
export async function updateProfileApi(
  token: string,
  input: { name: string },
  signal?: AbortSignal,
): Promise<UserResponse> {
  const res = await request("/api/v1/auth/me", { method: "PATCH", token, body: input, signal });
  const parsed = await parseApiResponse(
    res,
    safeParseWith(z.object({ user: userResponseSchema })),
    "Profile update",
  );
  return parsed.user;
}

/** Change password (signs out all sessions server-side). */
export async function changePasswordApi(
  token: string,
  input: { current_password: string; new_password: string },
  signal?: AbortSignal,
): Promise<void> {
  const res = await request("/api/v1/auth/password", { method: "POST", token, body: input, signal });
  if (!res.ok && res.status !== 204) {
    await parseApiResponse(res, safeParseWith(z.object({})), "Password change");
  }
}

/** List sessions owned by the signed-in user. */
export async function mySessionsApi(
  token: string,
  signal?: AbortSignal,
): Promise<ListMySessionsResponse> {
  const res = await request("/api/v1/users/me/sessions", { token, signal });
  return parseApiResponse(res, safeParseWith(listMySessionsResponseSchema), "Sessions load");
}

/** Recent persisted events across the signed-in user's sessions. */
export async function myActivityApi(
  token: string,
  signal?: AbortSignal,
): Promise<ListActivityResponse> {
  const res = await request("/api/v1/users/me/activity", { token, signal });
  return parseApiResponse(res, safeParseWith(listActivityResponseSchema), "Activity load");
}

/** Account notifications: owned rows plus global announcements. */
export async function myNotificationsApi(
  token: string,
  signal?: AbortSignal,
): Promise<ListMyNotificationsResponse> {
  const res = await request("/api/v1/users/me/notifications", { token, signal });
  return parseApiResponse(res, safeParseWith(listMyNotificationsResponseSchema), "Notifications load");
}

export async function markNotificationReadApi(
  token: string,
  id: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await request(`/api/v1/users/me/notifications/${id}/read`, {
    token,
    signal,
    method: "PATCH",
  });
  await parseApiResponse(res, safeParseWith(z.object({ ok: z.boolean() })), "Mark read");
}

export async function markAllNotificationsReadApi(
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await request("/api/v1/users/me/notifications/read-all", {
    token,
    signal,
    method: "POST",
  });
  await parseApiResponse(res, safeParseWith(z.object({ ok: z.boolean() })), "Mark all read");
}

/** List reports across the signed-in user's sessions. */
export async function myReportsApi(
  token: string,
  signal?: AbortSignal,
): Promise<ListOwnedReportsResponse> {
  const res = await request("/api/v1/users/me/reports", { token, signal });
  return parseApiResponse(res, safeParseWith(listOwnedReportsResponseSchema), "Reports load");
}

/** Search approved technical documents; returns real excerpts with references. */
export async function knowledgeSearchApi(
  input: KnowledgeSearch,
  signal?: AbortSignal,
): Promise<KnowledgeSearchResponse> {
  const res = await request("/api/v1/knowledge/search", { method: "POST", body: input, signal });
  return parseApiResponse(
    res,
    safeParseWith(knowledgeSearchResponseSchema),
    "Knowledge search",
  );
}

/* Voice-guided diagnostics (Phase 1). Transcription uploads WAV
 * only — the server rejects other audio, never transcodes. Speech
 * output stays browser-side: /speak returns a synthesis policy
 * (text + voice + rate), never audio bytes. */

export interface TranscribeVoiceOptions {
  mode?: TranscribeMode;
  languageBias?: string;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

/**
 * Transcribe one WAV clip (XHR — fetch has no upload progress).
 * Accepts the session access token or the owning user's login token.
 * Open during a safety stop: returns transcript + warnings with
 * blocked:true while loop actions stay gated server-side.
 */
export function transcribeVoiceApi(
  sessionId: string,
  token: string,
  audio: Blob,
  options: TranscribeVoiceOptions = {},
): Promise<TranscribeResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("audio", audio, "clip.wav");
    form.append("session_id", sessionId);
    if (options.mode) {
      form.append("mode", options.mode);
    }
    if (options.languageBias?.trim()) {
      form.append("languageBias", options.languageBias.trim());
    }

    const onAbort = () => xhr.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    xhr.upload.onprogress = (event: ProgressEvent) => {
      options.onProgress?.({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : null,
      });
    };
    xhr.onerror = () => {
      options.signal?.removeEventListener("abort", onAbort);
      reject(new ApiError(0, "network_error", "Transcription failed: network error."));
    };
    xhr.onabort = () => {
      options.signal?.removeEventListener("abort", onAbort);
      reject(new ApiError(0, "upload_aborted", "Transcription cancelled."));
    };
    xhr.onload = () => {
      options.signal?.removeEventListener("abort", onAbort);
      const payload = (): Promise<unknown> =>
        Promise.resolve().then(() => JSON.parse(xhr.responseText || "null"));
      void parseApiResponse(
        { status: xhr.status, json: payload },
        safeParseWith(transcribeResponseSchema),
        "Voice transcription",
      ).then(resolve, reject);
    };

    xhr.open("POST", `${getApiBaseUrl()}/api/v1/voice/transcribe`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(form);
  });
}

/** Spoken-response preferences for the signed-in user. */
export async function getVoicePreferencesApi(
  token: string,
  signal?: AbortSignal,
): Promise<VoicePreferencesResponse> {
  const res = await request("/api/v1/voice/preferences", { token, signal });
  return parseApiResponse(
    res,
    safeParseWith(voicePreferencesResponseSchema),
    "Voice preferences load",
  );
}

/** Update spoken-response preferences for the signed-in user. */
export async function updateVoicePreferencesApi(
  token: string,
  input: UpdateVoicePreferences,
  signal?: AbortSignal,
): Promise<VoicePreferencesResponse> {
  const res = await request("/api/v1/voice/preferences", {
    method: "PUT",
    token,
    body: input,
    signal,
  });
  return parseApiResponse(
    res,
    safeParseWith(voicePreferencesResponseSchema),
    "Voice preferences update",
  );
}

/** Log one voice turn; user text is safety-screened server-side. */
export async function logVoiceInteractionApi(
  sessionId: string,
  token: string,
  input: { role: VoiceRole; text: string },
  signal?: AbortSignal,
): Promise<LogVoiceInteractionResponse> {
  const res = await request("/api/v1/voice/interactions/log", {
    method: "POST",
    token,
    body: { session_id: sessionId, ...input },
    signal,
  });
  return parseApiResponse(
    res,
    safeParseWith(logVoiceInteractionResponseSchema),
    "Voice interaction log",
  );
}

/** STT/TTS availability (booleans only, never secrets). */
export async function getVoiceCapabilitiesApi(
  token: string,
  signal?: AbortSignal,
): Promise<VoiceCapabilities> {
  const res = await request("/api/v1/voice/capabilities", { token, signal });
  return parseApiResponse(
    res,
    safeParseWith(voiceCapabilitiesSchema),
    "Voice capabilities load",
  );
}

/**
 * Speak policy for browser speechSynthesis. In a loop-blocked session
 * the server substitutes the safety guidance for the requested text.
 */
export async function requestSpeakPolicyApi(
  token: string,
  input: SpeakRequest,
  signal?: AbortSignal,
): Promise<SpeakPolicyResponse> {
  const res = await request("/api/v1/voice/speak", {
    method: "POST",
    token,
    body: input,
    signal,
  });
  return parseApiResponse(
    res,
    safeParseWith(speakPolicyResponseSchema),
    "Speak policy",
  );
}

/* Parts and tools advisor (Phase 2, deterministic v1). Advisory
 * only: part and tool suggestions with verbatim manual excerpts.
 * The API carries no prices, stock, or suppliers. */

/** List suggested replacement parts for a session. */
export async function listPartRecommendationsApi(
  sessionId: string,
  token: string,
  signal?: AbortSignal,
): Promise<ListPartRecommendationsResponse> {
  const res = await request(`/api/v1/sessions/${sessionId}/parts/recommendations`, {
    token,
    signal,
  });
  return parseApiResponse(
    res,
    safeParseWith(listPartRecommendationsResponseSchema),
    "Parts load",
  );
}

/** Suggest a replacement part, linked to one hypothesis or test. */
export async function createPartRecommendationApi(
  sessionId: string,
  token: string,
  input: CreatePartRecommendation,
  signal?: AbortSignal,
): Promise<PartRecommendation> {
  const res = await request(`/api/v1/sessions/${sessionId}/parts/recommendations`, {
    method: "POST",
    token,
    body: input,
    signal,
  });
  const parsed = await parseApiResponse(
    res,
    safeParseWith(partRecommendationResponseSchema),
    "Part suggestion",
  );
  return parsed.recommendation;
}

/** Accept or dismiss a suggested part. */
export async function updatePartRecommendationApi(
  sessionId: string,
  recId: string,
  token: string,
  input: UpdateRecommendationStatus,
  signal?: AbortSignal,
): Promise<PartRecommendation> {
  const res = await request(
    `/api/v1/sessions/${sessionId}/parts/recommendations/${recId}`,
    { method: "PATCH", token, body: input, signal },
  );
  const parsed = await parseApiResponse(
    res,
    safeParseWith(partRecommendationResponseSchema),
    "Part update",
  );
  return parsed.recommendation;
}

/** List suggested tools for a session. */
export async function listToolRecommendationsApi(
  sessionId: string,
  token: string,
  signal?: AbortSignal,
): Promise<ListToolRecommendationsResponse> {
  const res = await request(`/api/v1/sessions/${sessionId}/tools/recommendations`, {
    token,
    signal,
  });
  return parseApiResponse(
    res,
    safeParseWith(listToolRecommendationsResponseSchema),
    "Tools load",
  );
}

/** Suggest a tool, optionally linked to a diagnostic test. */
export async function createToolRecommendationApi(
  sessionId: string,
  token: string,
  input: CreateToolRecommendation,
  signal?: AbortSignal,
): Promise<ToolRecommendation> {
  const res = await request(`/api/v1/sessions/${sessionId}/tools/recommendations`, {
    method: "POST",
    token,
    body: input,
    signal,
  });
  const parsed = await parseApiResponse(
    res,
    safeParseWith(toolRecommendationResponseSchema),
    "Tool suggestion",
  );
  return parsed.recommendation;
}

/** Live supplier offers matched to one part recommendation. */
export async function partOffersApi(
  sessionId: string,
  recId: string,
  token: string,
  signal?: AbortSignal,
): Promise<PartOffersResponse> {
  const res = await request(
    `/api/v1/sessions/${sessionId}/parts/recommendations/${recId}/offers`,
    { token, signal },
  );
  return parseApiResponse(res, safeParseWith(partOffersResponseSchema), "Offers load");
}

/** Accept or dismiss a suggested tool. */
export async function updateToolRecommendationApi(
  sessionId: string,
  recId: string,
  token: string,
  input: UpdateRecommendationStatus,
  signal?: AbortSignal,
): Promise<ToolRecommendation> {
  const res = await request(
    `/api/v1/sessions/${sessionId}/tools/recommendations/${recId}`,
    { method: "PATCH", token, body: input, signal },
  );
  const parsed = await parseApiResponse(
    res,
    safeParseWith(toolRecommendationResponseSchema),
    "Tool update",
  );
  return parsed.recommendation;
}

/* Technicians directory (Phase 3). Search and cards are public;
 * contact, inbox, and handoffs need the login token. Coordinates
 * are query params only — never stored server-side. */

export interface SearchTechniciansInput {
  city?: string;
  region?: string;
  specialty?: string;
  device_type?: string;
  lat?: number;
  lng?: number;
  radius_km?: number;
  limit?: number;
}

/** Public directory search; contact PII never appears in results. */
export async function searchTechniciansApi(
  input: SearchTechniciansInput = {},
  options: { token?: string; signal?: AbortSignal } = {},
): Promise<ListTechniciansResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && String(value).length > 0) {
      params.set(key, String(value));
    }
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const res = await request(`/api/v1/technicians${query}`, {
    signal: options.signal,
    ...(options.token ? { token: options.token } : {}),
  });
  return parseApiResponse(
    res,
    safeParseWith(listTechniciansResponseSchema),
    "Technician search",
  );
}

/** Public profile card; contact details only when the tech exposes them. */
export async function getTechnicianCardApi(
  userId: string,
  options: { token?: string; signal?: AbortSignal } = {},
): Promise<TechnicianCard> {
  const res = await request(`/api/v1/technicians/${userId}`, {
    signal: options.signal,
    ...(options.token ? { token: options.token } : {}),
  });
  const parsed = await parseApiResponse(
    res,
    safeParseWith(technicianResponseSchema),
    "Technician load",
  );
  return parsed.technician;
}

/** Own technician listing, or null when the user has none yet (404). */
export async function getOwnTechnicianProfileApi(
  token: string,
  signal?: AbortSignal,
): Promise<TechnicianCard | null> {
  const res = await request("/api/v1/technicians/me", { token, signal });
  if (res.status === 404) {
    return null;
  }
  const parsed = await parseApiResponse(
    res,
    safeParseWith(technicianResponseSchema),
    "Technician profile load",
  );
  return parsed.technician;
}

/** Create or replace the caller's technician listing (verified stays admin-only). */
export async function upsertOwnTechnicianProfileApi(
  token: string,
  input: UpsertOwnTechnicianProfile,
  signal?: AbortSignal,
): Promise<TechnicianCard> {
  const res = await request("/api/v1/technicians/me", {
    method: "PUT",
    token,
    body: input,
    signal,
  });
  const parsed = await parseApiResponse(
    res,
    safeParseWith(technicianResponseSchema),
    "Technician profile save",
  );
  return parsed.technician;
}

/** Send a contact request to a technician (login; own rate-limit scope). */
export async function createContactRequestApi(
  technicianUserId: string,
  token: string,
  input: CreateContactRequest,
  signal?: AbortSignal,
): Promise<ContactRequest> {
  const res = await request(`/api/v1/technicians/${technicianUserId}/contact`, {
    method: "POST",
    token,
    body: input,
    signal,
  });
  const parsed = await parseApiResponse(
    res,
    safeParseWith(contactRequestResponseSchema),
    "Contact request",
  );
  return parsed.request;
}

/** Inbox: requests the caller sent or received (defaults to received). */
export async function listContactRequestsApi(
  token: string,
  role?: "sent" | "received",
  signal?: AbortSignal,
): Promise<ListContactRequestsResponse> {
  const query = role ? `?role=${role}` : "";
  const res = await request(`/api/v1/technicians/requests${query}`, {
    token,
    signal,
  });
  return parseApiResponse(
    res,
    safeParseWith(listContactRequestsResponseSchema),
    "Requests load",
  );
}

/** Move a request along its lifecycle (side + transition enforced server-side). */
export async function updateContactRequestApi(
  reqId: string,
  token: string,
  status: ContactRequestStatus,
  signal?: AbortSignal,
): Promise<ContactRequest> {
  const res = await request(`/api/v1/technicians/requests/${reqId}`, {
    method: "PATCH",
    token,
    body: { status },
    signal,
  });
  const parsed = await parseApiResponse(
    res,
    safeParseWith(contactRequestResponseSchema),
    "Request update",
  );
  return parsed.request;
}

/** Share a consented diagnostic summary on a request (requester only). */
export async function createHandoffApi(
  reqId: string,
  token: string,
  input: CreateHandoff,
  signal?: AbortSignal,
): Promise<DiagnosticHandoff> {
  const res = await request(`/api/v1/technicians/requests/${reqId}/handoff`, {
    method: "POST",
    token,
    body: input,
    signal,
  });
  const parsed = await parseApiResponse(
    res,
    safeParseWith(handoffResponseSchema),
    "Diagnostic share",
  );
  return parsed.handoff;
}

/** Read the consented handoff on a request (contacted technician only). */
export async function getHandoffApi(
  reqId: string,
  token: string,
  signal?: AbortSignal,
): Promise<HandoffDetailResponse> {
  const res = await request(`/api/v1/technicians/requests/${reqId}/handoff`, {
    token,
    signal,
  });
  return parseApiResponse(
    res,
    safeParseWith(handoffDetailResponseSchema),
    "Shared diagnostics load",
  );
}

/**
 * True for cancellations (unmount, navigation, StrictMode remount).
 * Callers must ignore these instead of showing an error.
 */
export function isAbortError(err: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      err instanceof DOMException &&
      err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

/** List ingested documents, newest first (admin token). */
export async function adminDocumentsApi(
  token: string,
  signal?: AbortSignal,
): Promise<AdminDocumentListResponse> {
  const res = await request("/api/v1/admin/documents?limit=100", { token, signal });
  return parseApiResponse(
    res,
    safeParseWith(adminDocumentListResponseSchema),
    "Documents load",
  );
}

/** Upload + ingest a document file with JSON metadata (admin token). */
export async function adminUploadDocumentApi(
  token: string,
  file: File,
  metadata: Record<string, unknown>,
  source: string,
  signal?: AbortSignal,
): Promise<AdminDocumentResponse> {
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
}

/** Re-parse a document from its retained bytes (admin token). */
export async function adminReingestApi(
  token: string,
  documentId: string,
  signal?: AbortSignal,
): Promise<AdminDocumentResponse> {
  const res = await request("/api/v1/admin/ingestion-jobs", {
    method: "POST",
    token,
    body: { document_id: documentId },
    signal,
  });
  return parseApiResponse(res, safeParseWith(adminDocumentResponseSchema), "Re-ingestion");
}

/** Fetch one ingestion job with its document (admin token). */
export async function adminJobApi(
  token: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<IngestionJobDetailResponse> {
  const res = await request(`/api/v1/admin/ingestion-jobs/${jobId}`, { token, signal });
  return parseApiResponse(res, safeParseWith(ingestionJobDetailResponseSchema), "Job load");
}

/* Repair-shop workspace (Phase 4). Every route is membership-gated
 * server-side and scoped by shop_id; all clients take the login token. */

function shopQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value.length > 0) {
      search.set(key, value);
    }
  }
  return search.size > 0 ? `?${search.toString()}` : "";
}

/** Shops the signed-in user belongs to. */
export async function listShopsApi(
  token: string,
  signal?: AbortSignal,
): Promise<ListShopsResponse> {
  const res = await request("/api/v1/shops", { token, signal });
  return parseApiResponse(res, safeParseWith(listShopsResponseSchema), "Shops load");
}

/** Create a shop; the caller becomes its owner. */
export async function createShopApi(
  token: string,
  input: CreateShop,
  signal?: AbortSignal,
): Promise<ShopResponse> {
  const res = await request("/api/v1/shops", { method: "POST", token, body: input, signal });
  return parseApiResponse(res, safeParseWith(shopResponseSchema), "Shop creation");
}

/** One shop plus the caller's own role in it. */
export async function getShopApi(
  shopId: string,
  token: string,
  signal?: AbortSignal,
): Promise<ShopResponse> {
  const res = await request(`/api/v1/shops/${shopId}`, { token, signal });
  return parseApiResponse(res, safeParseWith(shopResponseSchema), "Shop load");
}

/** Update shop profile fields (owner/admin). */
export async function updateShopApi(
  shopId: string,
  token: string,
  input: UpdateShop,
  signal?: AbortSignal,
): Promise<Shop> {
  const res = await request(`/api/v1/shops/${shopId}`, {
    method: "PATCH",
    token,
    body: input,
    signal,
  });
  const parsed = await parseApiResponse(res, safeParseWith(shopResponseSchema), "Shop update");
  return parsed.shop;
}

/** List shop members (any member). */
export async function listShopMembersApi(
  shopId: string,
  token: string,
  signal?: AbortSignal,
): Promise<ListShopMembersResponse> {
  const res = await request(`/api/v1/shops/${shopId}/members`, { token, signal });
  return parseApiResponse(res, safeParseWith(listShopMembersResponseSchema), "Members load");
}

/** Add a member by user id or email (owner/admin; owner role by owners only). */
export async function addShopMemberApi(
  shopId: string,
  token: string,
  input: AddShopMember,
  signal?: AbortSignal,
): Promise<ShopMember> {
  const res = await request(`/api/v1/shops/${shopId}/members`, {
    method: "POST",
    token,
    body: input,
    signal,
  });
  const parsed = await parseApiResponse(
    res,
    safeParseWith(shopMemberResponseSchema),
    "Member add",
  );
  return parsed.member;
}

/** Change a member's role (owner/admin). */
export async function updateShopMemberApi(
  shopId: string,
  userId: string,
  token: string,
  input: UpdateShopMember,
  signal?: AbortSignal,
): Promise<ShopMember> {
  const res = await request(`/api/v1/shops/${shopId}/members/${userId}`, {
    method: "PATCH",
    token,
    body: input,
    signal,
  });
  const parsed = await parseApiResponse(
    res,
    safeParseWith(shopMemberResponseSchema),
    "Member update",
  );
  return parsed.member;
}

/** Remove a member (owner/admin; never the last owner). */
export async function removeShopMemberApi(
  shopId: string,
  userId: string,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await request(`/api/v1/shops/${shopId}/members/${userId}`, {
    method: "DELETE",
    token,
    signal,
  });
  if (!res.ok && res.status !== 204) {
    await parseApiResponse(res, safeParseWith(z.object({})), "Member removal");
  }
}

/** Add a customer; the C- reference is generated server-side. */
export async function createShopCustomerApi(
  shopId: string,
  token: string,
  input: CreateShopCustomer,
  signal?: AbortSignal,
): Promise<ShopCustomer> {
  const res = await request(`/api/v1/shops/${shopId}/customers`, {
    method: "POST",
    token,
    body: input,
    signal,
  });
  const parsed = await parseApiResponse(
    res,
    safeParseWith(shopCustomerResponseSchema),
    "Customer creation",
  );
  return parsed.customer;
}

/** List customers, optionally filtered by a name search. */
export async function listShopCustomersApi(
  shopId: string,
  token: string,
  search?: string,
  signal?: AbortSignal,
): Promise<ListShopCustomersResponse> {
  const res = await request(
    `/api/v1/shops/${shopId}/customers${shopQuery({ search: search?.trim() || undefined })}`,
    { token, signal },
  );
  return parseApiResponse(
    res,
    safeParseWith(listShopCustomersResponseSchema),
    "Customers load",
  );
}

/** Update customer fields. */
export async function updateShopCustomerApi(
  shopId: string,
  customerId: string,
  token: string,
  input: UpdateShopCustomer,
  signal?: AbortSignal,
): Promise<ShopCustomer> {
  const res = await request(`/api/v1/shops/${shopId}/customers/${customerId}`, {
    method: "PATCH",
    token,
    body: input,
    signal,
  });
  const parsed = await parseApiResponse(
    res,
    safeParseWith(shopCustomerResponseSchema),
    "Customer update",
  );
  return parsed.customer;
}

/** Register a device under a customer. */
export async function createCustomerDeviceApi(
  shopId: string,
  customerId: string,
  token: string,
  input: CreateCustomerDevice,
  signal?: AbortSignal,
): Promise<CustomerDevice> {
  const res = await request(`/api/v1/shops/${shopId}/customers/${customerId}/devices`, {
    method: "POST",
    token,
    body: input,
    signal,
  });
  const parsed = await parseApiResponse(
    res,
    safeParseWith(customerDeviceResponseSchema),
    "Device registration",
  );
  return parsed.device;
}

/** List a customer's devices. */
export async function listCustomerDevicesApi(
  shopId: string,
  customerId: string,
  token: string,
  signal?: AbortSignal,
): Promise<ListCustomerDevicesResponse> {
  const res = await request(`/api/v1/shops/${shopId}/customers/${customerId}/devices`, {
    token,
    signal,
  });
  return parseApiResponse(
    res,
    safeParseWith(listCustomerDevicesResponseSchema),
    "Devices load",
  );
}

export interface ListRepairJobsInput {
  status?: JobStatus;
  priority?: JobPriority;
  assignee?: string;
  customer?: string;
  from?: string;
  to?: string;
}

/** Create a repair job; the J- reference is generated server-side. */
export async function createRepairJobApi(
  shopId: string,
  token: string,
  input: CreateRepairJob,
  signal?: AbortSignal,
): Promise<RepairJob> {
  const res = await request(`/api/v1/shops/${shopId}/jobs`, {
    method: "POST",
    token,
    body: input,
    signal,
  });
  const parsed = await parseApiResponse(res, safeParseWith(repairJobResponseSchema), "Job creation");
  return parsed.job;
}

/** List jobs with optional status/priority/assignee/customer/date filters. */
export async function listRepairJobsApi(
  shopId: string,
  token: string,
  filters: ListRepairJobsInput = {},
  signal?: AbortSignal,
): Promise<ListRepairJobsResponse> {
  const res = await request(
    `/api/v1/shops/${shopId}/jobs${shopQuery({ ...filters })}`,
    { token, signal },
  );
  return parseApiResponse(res, safeParseWith(listRepairJobsResponseSchema), "Jobs load");
}

/** Job detail plus the linked session's safety state (read-only hazard display). */
export async function getRepairJobDetailApi(
  shopId: string,
  jobId: string,
  token: string,
  signal?: AbortSignal,
): Promise<RepairJobDetailResponse> {
  const res = await request(`/api/v1/shops/${shopId}/jobs/${jobId}`, { token, signal });
  return parseApiResponse(res, safeParseWith(repairJobDetailResponseSchema), "Job load");
}

/** Update job fields; a status change appends a timeline entry server-side. */
export async function updateRepairJobApi(
  shopId: string,
  jobId: string,
  token: string,
  input: UpdateRepairJob,
  signal?: AbortSignal,
): Promise<RepairJob> {
  const res = await request(`/api/v1/shops/${shopId}/jobs/${jobId}`, {
    method: "PATCH",
    token,
    body: input,
    signal,
  });
  const parsed = await parseApiResponse(res, safeParseWith(repairJobResponseSchema), "Job update");
  return parsed.job;
}

/** Append a note (or other entry) to a job's timeline. */
export async function createJobEventApi(
  shopId: string,
  jobId: string,
  token: string,
  input: CreateRepairJobEvent,
  signal?: AbortSignal,
): Promise<RepairJobEvent> {
  const res = await request(`/api/v1/shops/${shopId}/jobs/${jobId}/events`, {
    method: "POST",
    token,
    body: input,
    signal,
  });
  const parsed: RepairJobEventResponse = await parseApiResponse(
    res,
    safeParseWith(repairJobEventResponseSchema),
    "Note add",
  );
  return parsed.event;
}

/** A job's timeline, oldest first. */
export async function listJobEventsApi(
  shopId: string,
  jobId: string,
  token: string,
  signal?: AbortSignal,
): Promise<ListRepairJobEventsResponse> {
  const res = await request(`/api/v1/shops/${shopId}/jobs/${jobId}/events`, { token, signal });
  return parseApiResponse(res, safeParseWith(listRepairJobEventsResponseSchema), "Timeline load");
}

/** Link a diagnostic session the requester owns (D12 ownership check server-side). */
export async function attachJobSessionApi(
  shopId: string,
  jobId: string,
  token: string,
  input: AttachJobSession,
  signal?: AbortSignal,
): Promise<RepairJob> {
  const res = await request(`/api/v1/shops/${shopId}/jobs/${jobId}/session`, {
    method: "POST",
    token,
    body: input,
    signal,
  });
  const parsed = await parseApiResponse(res, safeParseWith(repairJobResponseSchema), "Session link");
  return parsed.job;
}

/** Unlink the diagnostic session from a job. */
export async function detachJobSessionApi(
  shopId: string,
  jobId: string,
  token: string,
  signal?: AbortSignal,
): Promise<RepairJob> {
  const res = await request(`/api/v1/shops/${shopId}/jobs/${jobId}/session`, {
    method: "DELETE",
    token,
    signal,
  });
  const parsed = await parseApiResponse(res, safeParseWith(repairJobResponseSchema), "Session unlink");
  return parsed.job;
}

/** Draft an estimate under a job. */
export async function createEstimateApi(
  shopId: string,
  jobId: string,
  token: string,
  input: CreateRepairEstimate,
  signal?: AbortSignal,
): Promise<RepairEstimateResponse> {
  const res = await request(`/api/v1/shops/${shopId}/jobs/${jobId}/estimates`, {
    method: "POST",
    token,
    body: input,
    signal,
  });
  return parseApiResponse(res, safeParseWith(repairEstimateResponseSchema), "Estimate creation");
}

/** A job's estimates with their line items. */
export async function listEstimatesApi(
  shopId: string,
  jobId: string,
  token: string,
  signal?: AbortSignal,
): Promise<ListRepairEstimatesResponse> {
  const res = await request(`/api/v1/shops/${shopId}/jobs/${jobId}/estimates`, { token, signal });
  return parseApiResponse(res, safeParseWith(listRepairEstimatesResponseSchema), "Estimates load");
}

/** Update an estimate (line-item replacement on drafts only). */
export async function updateEstimateApi(
  shopId: string,
  jobId: string,
  estId: string,
  token: string,
  input: UpdateRepairEstimate,
  signal?: AbortSignal,
): Promise<RepairEstimateResponse> {
  const res = await request(`/api/v1/shops/${shopId}/jobs/${jobId}/estimates/${estId}`, {
    method: "PATCH",
    token,
    body: input,
    signal,
  });
  return parseApiResponse(res, safeParseWith(repairEstimateResponseSchema), "Estimate update");
}

/** Convert an approved estimate; may move the job into repair server-side. */
export async function convertEstimateApi(
  shopId: string,
  jobId: string,
  estId: string,
  token: string,
  signal?: AbortSignal,
): Promise<RepairEstimateResponse> {
  const res = await request(`/api/v1/shops/${shopId}/jobs/${jobId}/estimates/${estId}/convert`, {
    method: "POST",
    token,
    signal,
  });
  return parseApiResponse(res, safeParseWith(repairEstimateResponseSchema), "Estimate conversion");
}

/** Add an inventory item. */
export async function createInventoryItemApi(
  shopId: string,
  token: string,
  input: CreateInventoryItem,
  signal?: AbortSignal,
): Promise<InventoryItem> {
  const res = await request(`/api/v1/shops/${shopId}/inventory`, {
    method: "POST",
    token,
    body: input,
    signal,
  });
  const parsed = await parseApiResponse(
    res,
    safeParseWith(inventoryItemResponseSchema),
    "Item creation",
  );
  return parsed.item;
}

/** List inventory, optionally low-stock only or by search. */
export async function listInventoryApi(
  shopId: string,
  token: string,
  filters: { low_stock?: boolean; search?: string } = {},
  signal?: AbortSignal,
): Promise<ListInventoryResponse> {
  const res = await request(
    `/api/v1/shops/${shopId}/inventory${shopQuery({
      ...(filters.low_stock ? { low_stock: "true" } : {}),
      ...(filters.search?.trim() ? { search: filters.search.trim() } : {}),
    })}`,
    { token, signal },
  );
  return parseApiResponse(res, safeParseWith(listInventoryResponseSchema), "Inventory load");
}

/** Update inventory item fields (quantity moves via movements). */
export async function updateInventoryItemApi(
  shopId: string,
  itemId: string,
  token: string,
  input: UpdateInventoryItem,
  signal?: AbortSignal,
): Promise<InventoryItem> {
  const res = await request(`/api/v1/shops/${shopId}/inventory/${itemId}`, {
    method: "PATCH",
    token,
    body: input,
    signal,
  });
  const parsed = await parseApiResponse(
    res,
    safeParseWith(inventoryItemResponseSchema),
    "Item update",
  );
  return parsed.item;
}

/** Record a stock movement (transactional server-side; never drives stock negative). */
export async function createInventoryMovementApi(
  shopId: string,
  itemId: string,
  token: string,
  input: CreateInventoryMovement,
  signal?: AbortSignal,
): Promise<InventoryMovementResponse> {
  const res = await request(`/api/v1/shops/${shopId}/inventory/${itemId}/movements`, {
    method: "POST",
    token,
    body: input,
    signal,
  });
  return parseApiResponse(
    res,
    safeParseWith(inventoryMovementResponseSchema),
    "Stock movement",
  );
}

/** An item's movement history. */
export async function listInventoryMovementsApi(
  shopId: string,
  itemId: string,
  token: string,
  signal?: AbortSignal,
): Promise<ListInventoryMovementsResponse> {
  const res = await request(`/api/v1/shops/${shopId}/inventory/${itemId}/movements`, {
    token,
    signal,
  });
  return parseApiResponse(
    res,
    safeParseWith(listInventoryMovementsResponseSchema),
    "Movements load",
  );
}

/** Actuals-only shop summary: counts, turnaround, parts use, workload. No revenue. */
export async function getShopReportApi(
  shopId: string,
  token: string,
  range: { from?: string; to?: string } = {},
  signal?: AbortSignal,
): Promise<ShopReportSummaryResponse> {
  const res = await request(
    `/api/v1/shops/${shopId}/reports/summary${shopQuery({ ...range })}`,
    { token, signal },
  );
  return parseApiResponse(res, safeParseWith(shopReportSummaryResponseSchema), "Report load");
}

/** Human-readable message for anything the API layer throws. */
export function describeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  if (err instanceof TypeError) {
    return "Cannot reach the API. Is it running (npm run dev:api)?";
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Something went wrong.";
}
