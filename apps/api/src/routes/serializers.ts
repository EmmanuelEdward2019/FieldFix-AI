import {
  adminDocumentListResponseSchema,
  adminDocumentResponseSchema,
  adminEvidenceItemSchema,
  adminModelRunSchema,
  adminReportItemSchema,
  adminSafetyEventSchema,
  adminSessionItemSchema,
  adminUserSchema,
  auditLogSchema,
  notificationSchema,
  activityItemSchema,
  mySessionItemSchema,
  analyzeResponseSchema,
  authResponseSchema,
  bulkImportResponseSchema,
  createSessionResponseSchema,
  diagnosticEventResponseSchema,
  diagnosticTestResponseSchema,
  documentResponseSchema,
  hypothesisResponseSchema,
  identificationResponseSchema,
  identifyResponseSchema,
  evidenceFileResponseSchema,
  ingestionJobDetailResponseSchema,
  ingestionJobResponseSchema,
  knowledgeSearchResponseSchema,
  listEvidenceResponseSchema,
  mfaStatusResponseSchema,
  annotationResponseSchema,
  listSegmentationsResponseSchema,
  modelRunResponseSchema,
  observationResponseSchema,
  ownedReportSchema,
  partRecommendationSchema,
  recordResultResponseSchema,
  registerResponseSchema,
  reportResponseSchema,
  safetyEventResponseSchema,
  segmentResponseSchema,
  sessionCitationResponseSchema,
  sessionDetailResponseSchema,
  sessionResponseSchema,
  supplierProductSchema,
  supplierSchema,
  testResultResponseSchema,
  testWithResultResponseSchema,
  technicianCardSchema,
  technicianListItemSchema,
  contactRequestSchema,
  customerDeviceSchema,
  diagnosticHandoffSchema,
  inventoryItemSchema,
  inventoryMovementSchema,
  repairEstimateItemSchema,
  repairEstimateSchema,
  repairJobEventSchema,
  repairJobSchema,
  shopCustomerSchema,
  shopMemberSchema,
  shopReportSummarySchema,
  shopSchema,
  toolRecommendationSchema,
  uploadEvidenceResponseSchema,
  userResponseSchema,
  type AdminDocumentListResponse,
  type AdminDocumentResponse,
  type AdminEvidenceItem,
  type AdminModelRun,
  type ActivityItem,
  type AdminNotification,
  type MySessionItem,
  type AdminReportItem,
  type AdminSafetyEvent,
  type AdminSessionItem,
  type AdminUser,
  type AnalyzeResponse,
  type AuditLog,
  type AuthResponse,
  type AnnotationResponse,
  type BulkImportResponse,
  type CreateSessionResponse,
  type DiagnosticEventResponse,
  type DiagnosticTestResponse,
  type DocumentResponse,
  type EvidenceFileResponse,
  type HypothesisResponse,
  type IdentificationResponse as IdentificationResponseShape,
  type IdentifyResponse,
  type ModelRunResponse,
  type SessionCitationResponse,
  type IngestionJobDetailResponse,
  type IngestionJobResponse,
  type KnowledgeSearchHit,
  type KnowledgeSearchResponse,
  type ListEvidenceResponse,
  type ListSegmentationsResponse,
  type ObservationResponse,
  type OwnedReport,
  type PartRecommendation as PartRecommendationShape,
  type ToolRecommendation as ToolRecommendationShape,
  type RecordResultResponse,
  type RegisterResponse,
  type ReportResponse,
  type SafetyEventResponse,
  type SegmentResponse,
  type SessionDetailResponse,
  type SessionResponse,
  type Supplier as SupplierShape,
  type SupplierProduct as SupplierProductShape,
  type TechnicianCard,
  type TechnicianListItem,
  type ContactRequest as ContactRequestShape,
  type CustomerDevice as CustomerDeviceShape,
  type DiagnosticHandoff as DiagnosticHandoffShape,
  type InventoryItem as InventoryItemShape,
  type InventoryMovement as InventoryMovementShape,
  type RepairEstimate as RepairEstimateShape,
  type RepairEstimateItem as RepairEstimateItemShape,
  type RepairJob as RepairJobShape,
  type RepairJobEvent as RepairJobEventShape,
  type Shop as ShopShape,
  type ShopCustomer as ShopCustomerShape,
  type ShopMember as ShopMemberShape,
  type ShopReportSummary,
  type TestResultResponse,
  type TestWithResultResponse,
  type UploadEvidenceResponse,
  type UserResponse,
  type DiagnosticAssessment,
  logVoiceInteractionResponseSchema,
  speakPolicyResponseSchema,
  transcribeResponseSchema,
  voiceCapabilitiesSchema,
  voiceInteractionSchema,
  voicePreferencesResponseSchema,
  voicePreferencesSchema,
  type LogVoiceInteractionResponse,
  type SpeakPolicyResponse,
  type TranscribeResponse,
  type VoiceCapabilities,
  type VoiceInteraction as VoiceInteractionShape,
  type VoicePreferences,
  type VoicePreferencesResponse,
} from "@fieldfix/contracts";
import type {
  AdminAuditLog,
  CustomerDevice,
  DiagnosticEvent,
  DiagnosticHypothesis,
  DiagnosticSession,
  DiagnosticTest,
  EvidenceAnnotation,
  EvidenceFile,
  EvidenceIdentification,
  EvidenceObservation,
  IngestionJob,
  InventoryItem,
  InventoryMovement,
  ModelRun,
  NotificationRecord,
  PartRecommendation,
  RepairEstimate,
  RepairEstimateItem,
  RepairJob,
  RepairJobEvent,
  RepairReport,
  Shop,
  ShopCustomer,
  ShopMember,
  Supplier,
  SupplierProduct,
  ToolRecommendation,
  SafetyEvent,
  SharedDiagnosticHandoff,
  TechnicalDocument,
  TechnicianContactRequest,
  TechnicianProfile,
  TestResult,
  Timestamp,
  User,
  VoiceInteraction,
  VoicePreference,
} from "../db/database.js";
import type { ResolvedCitation } from "../knowledge/citations.js";
import { maskAnnotationToSvgPath } from "../vision/service.js";

/**
 * pg returns timestamptz columns as Date; the Kysely Timestamp wrapper
 * (double-wrapped by Generated) needs an explicit unwrap for output.
 */
function iso(value: Timestamp | Date): string {
  return (value as unknown as Date).toISOString();
}

/** Serialize DB rows to contract-validated API shapes (no secrets). */
export function toSessionResponse(row: DiagnosticSession): SessionResponse {
  return sessionResponseSchema.parse({
    id: row.id,
    device_type: row.device_type,
    manufacturer: row.manufacturer,
    model: row.model,
    operating_system: row.operating_system,
    symptoms: row.symptoms,
    problem_started_at: row.problem_started_at
      ? iso(row.problem_started_at)
      : null,
    problem_started_note: row.problem_started_note,
    recent_events: row.recent_events,
    user_mode: row.user_mode,
    status: row.status,
    safety_state: row.safety_state,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

export function toCreateSessionResponse(
  row: DiagnosticSession,
  accessToken: string,
): CreateSessionResponse {
  return createSessionResponseSchema.parse({
    session: toSessionResponse(row),
    accessToken,
  });
}

export function toUserResponse(row: User): UserResponse {
  return userResponseSchema.parse({
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: iso(row.created_at),
  });
}

export function toAuthResponse(row: User, token: string, expiresAt: Timestamp | Date): AuthResponse {
  return authResponseSchema.parse({
    user: toUserResponse(row),
    token,
    expires_at: iso(expiresAt),
  });
}

export function toMfaStatusResponse(row: { verified_at: Timestamp | Date | null } | undefined) {
  return mfaStatusResponseSchema.parse({
    enabled: row?.verified_at != null,
    verified_at: row?.verified_at == null ? null : iso(row.verified_at),
  });
}

export function toRegisterResponse(row: User): RegisterResponse {
  return registerResponseSchema.parse({
    user: toUserResponse(row),
    confirmation_required: true,
  });
}

export function toOwnedReportResponse(row: {
  id: string;
  session_id: string;
  status: RepairReport["status"];
  device_type: DiagnosticSession["device_type"];
  manufacturer: string | null;
  model: string | null;
  symptoms: string;
  created_at: RepairReport["created_at"];
}): OwnedReport {
  return ownedReportSchema.parse({
    id: row.id,
    session_id: row.session_id,
    status: row.status,
    device_type: row.device_type,
    manufacturer: row.manufacturer,
    model: row.model,
    symptoms: row.symptoms,
    created_at: iso(row.created_at),
  });
}

export function toEvidenceFileResponse(row: EvidenceFile): EvidenceFileResponse {
  return evidenceFileResponseSchema.parse({
    id: row.id,
    session_id: row.session_id,
    media_type: row.media_type,
    // pg returns bigint columns as strings; byte sizes fit in a double.
    byte_size:
      typeof row.byte_size === "string"
        ? Number.parseInt(row.byte_size, 10)
        : row.byte_size,
    original_filename: row.original_filename,
    kind: row.kind,
    processing_status: row.processing_status,
    processing_error: row.processing_error,
    checksum_sha256: row.checksum_sha256,
    created_at: iso(row.created_at),
  });
}

export function toObservationResponse(
  row: EvidenceObservation,
): ObservationResponse {
  return observationResponseSchema.parse({
    id: row.id,
    session_id: row.session_id,
    evidence_file_id: row.evidence_file_id,
    source: row.source,
    body: row.body,
    created_at: iso(row.created_at),
  });
}

export interface SessionDetailInput {
  session: DiagnosticSession;
  evidence: EvidenceFile[];
  observations: EvidenceObservation[];
  hypotheses?: DiagnosticHypothesis[];
  tests?: { test: DiagnosticTest; result: TestResult | null }[];
  events?: DiagnosticEvent[];
  citations?: ResolvedCitation[];
  safetyEvents?: SafetyEvent[];
  modelRuns?: ModelRun[];
}

export function toSessionDetailResponse(
  session: DiagnosticSession,
  evidence: EvidenceFile[],
  observations: EvidenceObservation[],
  extra: Omit<SessionDetailInput, "session" | "evidence" | "observations"> = {},
): SessionDetailResponse {
  return sessionDetailResponseSchema.parse({
    session: toSessionResponse(session),
    evidence: evidence.map(toEvidenceFileResponse),
    observations: observations.map(toObservationResponse),
    hypotheses: (extra.hypotheses ?? []).map(toHypothesisResponse),
    tests: (extra.tests ?? []).map(({ test, result }) =>
      toTestWithResultResponse(test, result),
    ),
    events: (extra.events ?? []).map(toEventResponse),
    citations: (extra.citations ?? []).map(toSessionCitationResponse),
    safety_events: (extra.safetyEvents ?? []).map(toSafetyEventResponse),
    model_runs: (extra.modelRuns ?? []).map(toModelRunResponse),
  });
}

export function toEventResponse(row: DiagnosticEvent): DiagnosticEventResponse {
  return diagnosticEventResponseSchema.parse({
    id: row.id,
    session_id: row.session_id,
    event_type: row.event_type,
    payload: row.payload,
    created_at: iso(row.created_at),
  });
}

export function toSessionCitationResponse(resolved: ResolvedCitation): SessionCitationResponse {
  return sessionCitationResponseSchema.parse({
    id: resolved.citation.id,
    chunk_id: resolved.citation.chunk_id,
    hypothesis_id: resolved.citation.hypothesis_id,
    test_id: resolved.citation.test_id,
    excerpt: resolved.citation.excerpt,
    note: resolved.citation.note,
    document_id: resolved.document.id,
    document_title: resolved.document.title,
    page_number: resolved.chunk.page_number,
    heading: resolved.chunk.heading,
    created_at: iso(resolved.citation.created_at),
  });
}

export function toModelRunResponse(row: ModelRun): ModelRunResponse {
  return modelRunResponseSchema.parse({
    id: row.id,
    provider: row.provider,
    model_id: row.model_id,
    task_type: row.task_type,
    status: row.status,
    latency_ms: row.latency_ms,
    created_at: iso(row.created_at),
  });
}

export function toUploadEvidenceResponse(
  file: EvidenceFile,
  observation: EvidenceObservation | null,
): UploadEvidenceResponse {
  return uploadEvidenceResponseSchema.parse({
    file: toEvidenceFileResponse(file),
    observation: observation ? toObservationResponse(observation) : null,
  });
}

export function toListEvidenceResponse(
  evidence: EvidenceFile[],
): ListEvidenceResponse {
  return listEvidenceResponseSchema.parse({
    evidence: evidence.map(toEvidenceFileResponse),
  });
}

export function toDocumentResponse(
  row: TechnicalDocument,
  chunkCount: number,
): DocumentResponse {
  return documentResponseSchema.parse({
    id: row.id,
    title: row.title,
    manufacturer: row.manufacturer,
    device_family: row.device_family,
    model_numbers: row.model_numbers,
    document_type: row.document_type,
    source_name: row.source_name,
    source_url: row.source_url,
    version: row.version,
    language: row.language,
    licence_name: row.licence_name,
    permission_status: row.permission_status,
    ingestion_status: row.ingestion_status,
    ingestion_error: row.ingestion_error,
    chunk_count: chunkCount,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

export function toIngestionJobResponse(row: IngestionJob): IngestionJobResponse {
  return ingestionJobResponseSchema.parse({
    id: row.id,
    document_id: row.document_id,
    source_name: row.source_name,
    status: row.status,
    error: row.error,
    chunks_created:
      typeof row.chunks_created === "string"
        ? Number.parseInt(row.chunks_created, 10)
        : row.chunks_created,
    detail: row.detail,
    created_at: iso(row.created_at),
    finished_at: row.finished_at ? iso(row.finished_at) : null,
  });
}

export function toAdminDocumentResponse(input: {
  document: { row: TechnicalDocument; chunkCount: number } | null;
  job: IngestionJob;
  duplicateOf: string | null;
}): AdminDocumentResponse {
  return adminDocumentResponseSchema.parse({
    document: input.document
      ? toDocumentResponse(input.document.row, input.document.chunkCount)
      : null,
    job: toIngestionJobResponse(input.job),
    duplicate_of: input.duplicateOf,
  });
}

export function toAdminDocumentListResponse(
  rows: { row: TechnicalDocument; chunkCount: number }[],
): AdminDocumentListResponse {
  return adminDocumentListResponseSchema.parse({
    documents: rows.map(({ row, chunkCount }) => toDocumentResponse(row, chunkCount)),
  });
}

export function toIngestionJobDetailResponse(input: {
  job: IngestionJob;
  document: { row: TechnicalDocument; chunkCount: number } | null;
}): IngestionJobDetailResponse {
  return ingestionJobDetailResponseSchema.parse({
    job: toIngestionJobResponse(input.job),
    document: input.document
      ? toDocumentResponse(input.document.row, input.document.chunkCount)
      : null,
  });
}

export function toBulkImportResponse(input: {
  file: string;
  recordsSeen: number;
  attempted: number;
  items: BulkImportResponse["items"];
}): BulkImportResponse {
  return bulkImportResponseSchema.parse({
    file: input.file,
    records_seen: input.recordsSeen,
    attempted: input.attempted,
    items: input.items,
  });
}

export function toKnowledgeSearchResponse(
  hits: KnowledgeSearchHit[],
): KnowledgeSearchResponse {
  return knowledgeSearchResponseSchema.parse({ hits });
}

export function toHypothesisResponse(row: DiagnosticHypothesis): HypothesisResponse {
  return hypothesisResponseSchema.parse({
    id: row.id,
    session_id: row.session_id,
    title: row.title,
    description: row.description,
    supporting_observations: row.supporting_observations,
    contradicting_observations: row.contradicting_observations,
    confidence_label: row.confidence_label,
    confidence_rationale: row.confidence_rationale,
    status: row.status,
    suggested_next_test_id: row.suggested_next_test_id,
    verified_by_test_result_id: row.verified_by_test_result_id,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

export function toDiagnosticTestResponse(row: DiagnosticTest): DiagnosticTestResponse {
  return diagnosticTestResponseSchema.parse({
    id: row.id,
    session_id: row.session_id,
    name: row.name,
    objective: row.objective,
    rationale: row.rationale,
    required_tools: row.required_tools,
    skill_level: row.skill_level,
    safety_classification: row.safety_classification,
    instructions: row.instructions,
    expected_outcomes: row.expected_outcomes,
    result_options: row.result_options,
    position: row.position,
    status: row.status,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

export function toTestResultResponse(row: TestResult): TestResultResponse {
  return testResultResponseSchema.parse({
    id: row.id,
    test_id: row.test_id,
    session_id: row.session_id,
    selected_option: row.selected_option,
    observation: row.observation,
    source: "user_reported",
    created_at: iso(row.created_at),
  });
}

export function toTestWithResultResponse(
  test: DiagnosticTest,
  result: TestResult | null,
): TestWithResultResponse {
  return testWithResultResponseSchema.parse({
    test: toDiagnosticTestResponse(test),
    result: result ? toTestResultResponse(result) : null,
  });
}

export function toAnalyzeResponse(input: {
  assessment: DiagnosticAssessment;
  hypotheses: DiagnosticHypothesis[];
  tests: DiagnosticTest[];
  run: ModelRun;
  warnings: string[];
}): AnalyzeResponse {
  return analyzeResponseSchema.parse({
    assessment: input.assessment,
    hypotheses: input.hypotheses.map(toHypothesisResponse),
    tests: input.tests.map(toDiagnosticTestResponse),
    run: {
      id: input.run.id,
      status: input.run.status,
      model_id: input.run.model_id,
    },
    warnings: input.warnings,
  });
}

export function toRecordResultResponse(input: {
  result: TestResult;
  test: DiagnosticTest;
  reassessmentApplied: boolean;
  reassessmentError: string | null;
  hypotheses: DiagnosticHypothesis[];
}): RecordResultResponse {
  return recordResultResponseSchema.parse({
    result: toTestResultResponse(input.result),
    test: toDiagnosticTestResponse(input.test),
    reassessment_applied: input.reassessmentApplied,
    reassessment_error: input.reassessmentError,
    hypotheses: input.hypotheses.map(toHypothesisResponse),
  });
}

export function toReportResponse(row: RepairReport): ReportResponse {
  return reportResponseSchema.parse({
    id: row.id,
    session_id: row.session_id,
    status: row.status,
    report_data: row.report_data,
    error_message: row.error_message,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

export function toAnnotationResponse(row: EvidenceAnnotation): AnnotationResponse {
  return annotationResponseSchema.parse({
    id: row.id,
    evidence_file_id: row.evidence_file_id,
    kind: row.kind,
    coordinates: row.coordinates,
    label: row.label,
    producer: row.producer,
    image_width: row.image_width,
    image_height: row.image_height,
    model_run_id: row.model_run_id,
    svg_path: row.kind === "mask" ? maskAnnotationToSvgPath(row.coordinates) : null,
    created_at: iso(row.created_at),
  });
}

export function toSegmentResponse(input: {
  annotations: EvidenceAnnotation[];
  runs: Array<{ run: ModelRun; concept: string }>;
  conceptsUsed: string[];
  warnings: string[];
}): SegmentResponse {
  return segmentResponseSchema.parse({
    annotations: input.annotations.map(toAnnotationResponse),
    runs: input.runs.map(({ run, concept }) => ({
      id: run.id,
      concept,
      status: run.status,
      model_id: run.model_id,
    })),
    concepts_used: input.conceptsUsed,
    warnings: input.warnings,
  });
}

export function toListSegmentationsResponse(input: {
  annotations: AnnotationResponse[];
  imageWidth: number | null;
  imageHeight: number | null;
}): ListSegmentationsResponse {
  return listSegmentationsResponseSchema.parse({
    annotations: input.annotations,
    image_width: input.imageWidth,
    image_height: input.imageHeight,
  });
}

export function toIdentificationResponse(row: EvidenceIdentification): IdentificationResponseShape {
  return identificationResponseSchema.parse({
    id: row.id,
    session_id: row.session_id,
    evidence_file_id: row.evidence_file_id,
    device_name: row.device_name,
    components: row.components,
    suspected_fault_area: row.suspected_fault_area,
    unidentifiable: row.unidentifiable,
    model_run_id: row.model_run_id,
    created_at: iso(row.created_at),
  });
}

export function toIdentifyResponse(input: {
  identification: EvidenceIdentification;
  annotations: EvidenceAnnotation[];
  conceptsUsed: string[];
  warnings: string[];
}): IdentifyResponse {
  return identifyResponseSchema.parse({
    identification: toIdentificationResponse(input.identification),
    annotations: input.annotations.map(toAnnotationResponse),
    concepts_used: input.conceptsUsed,
    warnings: input.warnings,
  });
}

export function toSafetyEventResponse(row: SafetyEvent): SafetyEventResponse {
  return safetyEventResponseSchema.parse({
    id: row.id,
    session_id: row.session_id,
    previous_state: row.previous_state,
    new_state: row.new_state,
    trigger_type: row.trigger_type,
    trigger_detail: row.trigger_detail,
    evidence_file_id: row.evidence_file_id,
    blocked_action: row.blocked_action,
    safe_next_steps: row.safe_next_steps,
    created_at: iso(row.created_at),
  });
}

/* Admin console shapes (no secrets, no private bytes). */

export function toAdminUser(row: User, sessionCount: number): AdminUser {
  return adminUserSchema.parse({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    email_confirmed: row.email_confirmed_at != null,
    session_count: Number(sessionCount),
    created_at: iso(row.created_at),
    last_login_at: row.last_login_at ? iso(row.last_login_at) : null,
  });
}

export function toAdminSessionItem(row: {
  id: string;
  user_email: string | null;
  device_type: DiagnosticSession["device_type"];
  manufacturer: string | null;
  model: string | null;
  symptoms: string;
  status: DiagnosticSession["status"];
  safety_state: DiagnosticSession["safety_state"];
  evidence_count: number | string | bigint | null;
  hypothesis_count: number | string | bigint | null;
  test_count: number | string | bigint | null;
  model_run_count: number | string | bigint | null;
  last_model_status: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}): AdminSessionItem {
  return adminSessionItemSchema.parse({
    ...row,
    evidence_count: Number(row.evidence_count ?? 0),
    hypothesis_count: Number(row.hypothesis_count ?? 0),
    test_count: Number(row.test_count ?? 0),
    model_run_count: Number(row.model_run_count ?? 0),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

export function toAdminReportItem(row: {
  id: string;
  session_id: string;
  user_email: string | null;
  device_type: string;
  manufacturer: string | null;
  model: string | null;
  status: string;
  verified_findings: number;
  total_findings: number;
  created_at: Timestamp;
}): AdminReportItem {
  return adminReportItemSchema.parse({ ...row, created_at: iso(row.created_at) });
}

export function toAdminEvidenceItem(row: {
  id: string;
  session_id: string;
  device_type: DiagnosticSession["device_type"];
  media_type: string;
  byte_size: number | string | bigint;
  original_filename: string | null;
  processing_status: EvidenceFile["processing_status"];
  created_at: Timestamp;
}): AdminEvidenceItem {
  return adminEvidenceItemSchema.parse({
    ...row,
    byte_size: Number(row.byte_size),
    created_at: iso(row.created_at),
  });
}

export function toAdminModelRun(row: ModelRun): AdminModelRun {
  return adminModelRunSchema.parse({
    id: row.id,
    provider: row.provider,
    model_id: row.model_id,
    task_type: row.task_type,
    status: row.status,
    latency_ms: row.latency_ms,
    session_id: row.session_id,
    error_category: row.error_category,
    validation_status: row.validation_status,
    prompt_tokens: row.prompt_tokens,
    completion_tokens: row.completion_tokens,
    created_at: iso(row.created_at),
  });
}

export function toAdminSafetyEvent(row: {
  id: string;
  session_id: string;
  device_type: DiagnosticSession["device_type"];
  previous_state: SafetyEvent["previous_state"];
  new_state: SafetyEvent["new_state"];
  trigger_type: SafetyEvent["trigger_type"];
  trigger_detail: string | null;
  blocked_action: string | null;
  reviewed: boolean;
  review_note: string | null;
  created_at: Timestamp;
}): AdminSafetyEvent {
  return adminSafetyEventSchema.parse({ ...row, created_at: iso(row.created_at) });
}

export function toAuditLog(row: AdminAuditLog): AuditLog {
  return auditLogSchema.parse({
    ...row,
    metadata:
      row.metadata != null && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    created_at: iso(row.created_at),
  });
}

export function toNotification(row: NotificationRecord): AdminNotification {
  return notificationSchema.parse({ ...row, created_at: iso(row.created_at) });
}

export function toMySessionItem(
  row: DiagnosticSession & { test_count: number; tests_recorded: number; evidence_count: number },
): MySessionItem {
  return mySessionItemSchema.parse({
    ...toSessionResponse(row),
    test_count: row.test_count,
    tests_recorded: row.tests_recorded,
    evidence_count: row.evidence_count,
  });
}

export function toActivityItem(row: {
  id: string;
  session_id: string;
  event_type: string;
  device_type: string;
  model: string | null;
  created_at: Timestamp | Date;
}): ActivityItem {
  return activityItemSchema.parse({
    id: row.id,
    session_id: row.session_id,
    event_type: row.event_type,
    device_type: row.device_type,
    model: row.model,
    created_at: iso(row.created_at),
  });
}

export function toVoicePreferences(row: VoicePreference): VoicePreferences {
  return voicePreferencesSchema.parse({
    user_id: row.user_id,
    spoken_responses: row.spoken_responses,
    voice_id: row.voice_id,
    rate: row.rate,
    language: row.language,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

export function toVoicePreferencesResponse(
  row: VoicePreference,
): VoicePreferencesResponse {
  return voicePreferencesResponseSchema.parse({
    preferences: toVoicePreferences(row),
  });
}

/** Defaults served when the user never saved preferences (not persisted). */
export function toDefaultVoicePreferencesResponse(
  userId: string,
): VoicePreferencesResponse {
  const now = new Date().toISOString();
  return voicePreferencesResponseSchema.parse({
    preferences: {
      user_id: userId,
      spoken_responses: true,
      voice_id: null,
      rate: 1,
      language: "en",
      created_at: now,
      updated_at: now,
    },
  });
}

export function toVoiceInteractionShape(row: VoiceInteraction): VoiceInteractionShape {
  return voiceInteractionSchema.parse({
    id: row.id,
    session_id: row.session_id,
    user_id: row.user_id,
    role: row.role,
    text: row.text,
    audio_storage_key: row.audio_storage_key,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

export function toLogVoiceInteractionResponse(input: {
  interaction: VoiceInteraction;
  safetyState: string;
  warnings: string[];
  blocked: boolean;
}): LogVoiceInteractionResponse {
  return logVoiceInteractionResponseSchema.parse({
    interaction: toVoiceInteractionShape(input.interaction),
    safety_state: input.safetyState,
    warnings: input.warnings,
    blocked: input.blocked,
  });
}

export function toTranscribeResponse(input: {
  transcript: string;
  audioDurationMs: number | undefined;
  turns: Array<{
    turnId: string;
    startMs: number;
    endMs: number;
    transcript: string;
    speaker?: string;
  }>;
  provider: string;
  modelId: string;
  transcriptionId: string;
  interactionId: string;
  modelRunId: string;
  safetyState: string;
  warnings: string[];
  blocked: boolean;
}): TranscribeResponse {
  return transcribeResponseSchema.parse({
    transcript: input.transcript,
    audio_duration_ms: input.audioDurationMs ?? null,
    turns: input.turns.map((turn) => ({
      turn_id: turn.turnId,
      start_ms: turn.startMs,
      end_ms: turn.endMs,
      transcript: turn.transcript,
      speaker: turn.speaker ?? null,
    })),
    provider: input.provider,
    model_id: input.modelId,
    transcription_id: input.transcriptionId,
    interaction_id: input.interactionId,
    model_run_id: input.modelRunId,
    safety_state: input.safetyState,
    warnings: input.warnings,
    blocked: input.blocked,
  });
}

export function toVoiceCapabilitiesResponse(input: {
  stt: {
    provider: string;
    modelId: string;
    configured: boolean;
    enabled: boolean;
    available: boolean;
    accepts: string[];
    maxAudioMb: number;
    maxAudioBytes: number;
  };
  tts: {
    provider: string;
    mode: "browser-speech-synthesis";
    serverAudio: false;
    configured: boolean;
  };
}): VoiceCapabilities {
  return voiceCapabilitiesSchema.parse({
    stt: {
      provider: input.stt.provider,
      model_id: input.stt.modelId,
      configured: input.stt.configured,
      enabled: input.stt.enabled,
      available: input.stt.available,
      accepts: input.stt.accepts,
      max_audio_mb: input.stt.maxAudioMb,
      max_audio_bytes: input.stt.maxAudioBytes,
    },
    tts: {
      provider: input.tts.provider,
      mode: input.tts.mode,
      server_audio: input.tts.serverAudio,
      configured: input.tts.configured,
    },
  });
}

export function toPartRecommendationResponse(
  row: PartRecommendation,
): PartRecommendationShape {
  return partRecommendationSchema.parse({
    id: row.id,
    session_id: row.session_id,
    hypothesis_id: row.hypothesis_id,
    test_id: row.test_id,
    part_name: row.part_name,
    part_number: row.part_number,
    manufacturer: row.manufacturer,
    model_compat: row.model_compat,
    chunk_id: row.chunk_id,
    excerpt: row.excerpt,
    status: row.status,
    created_at: iso(row.created_at),
  });
}

export function toToolRecommendationResponse(
  row: ToolRecommendation,
): ToolRecommendationShape {
  return toolRecommendationSchema.parse({
    id: row.id,
    session_id: row.session_id,
    test_id: row.test_id,
    tool_name: row.tool_name,
    spec: row.spec,
    chunk_id: row.chunk_id,
    status: row.status,
    created_at: iso(row.created_at),
  });
}

/** Public directory row: never carries contact PII (by construction). */
export function toTechnicianListItem(
  row: TechnicianProfile,
  distanceKm: number | null,
): TechnicianListItem {
  return technicianListItemSchema.parse({
    user_id: row.user_id,
    display_name: row.display_name,
    city: row.city,
    region: row.region,
    postal_code: row.postal_code,
    latitude: row.latitude,
    longitude: row.longitude,
    specialties: row.specialties,
    device_types: row.device_types,
    about: row.about,
    accepting_requests: row.accepting_requests,
    verified: row.verified,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    distance_km: distanceKm,
  });
}

/** Public card: contact details appear only when the profile sets them. */
export function toTechnicianCard(row: TechnicianProfile): TechnicianCard {
  return technicianCardSchema.parse({
    user_id: row.user_id,
    display_name: row.display_name,
    city: row.city,
    region: row.region,
    postal_code: row.postal_code,
    latitude: row.latitude,
    longitude: row.longitude,
    specialties: row.specialties,
    device_types: row.device_types,
    about: row.about,
    accepting_requests: row.accepting_requests,
    verified: row.verified,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    phone: row.phone,
    contact_email: row.contact_email,
    whatsapp: row.whatsapp,
  });
}

export function toContactRequestResponse(
  row: TechnicianContactRequest,
): ContactRequestShape {
  return contactRequestSchema.parse({
    id: row.id,
    session_id: row.session_id,
    requester_user_id: row.requester_user_id,
    technician_user_id: row.technician_user_id,
    message: row.message,
    contact_method: row.contact_method,
    preferred_time: row.preferred_time,
    status: row.status,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

export function toDiagnosticHandoffResponse(
  row: SharedDiagnosticHandoff,
): DiagnosticHandoffShape {
  return diagnosticHandoffSchema.parse({
    id: row.id,
    request_id: row.request_id,
    session_id: row.session_id,
    shared_evidence_ids: row.shared_evidence_ids ?? [],
    shared_report: row.shared_report,
    created_by_user_id: row.created_by_user_id,
    created_at: iso(row.created_at),
  });
}

/* Repair-shop workspace shapes (Phase 4). */

export function toShopShape(row: Shop): ShopShape {
  return shopSchema.parse({
    id: row.id,
    owner_user_id: row.owner_user_id,
    name: row.name,
    description: row.description,
    phone: row.phone,
    email: row.email,
    address: row.address,
    city: row.city,
    region: row.region,
    country: row.country,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

export function toShopMemberShape(row: ShopMember): ShopMemberShape {
  return shopMemberSchema.parse({
    shop_id: row.shop_id,
    user_id: row.user_id,
    role: row.role,
  });
}

export function toShopCustomerShape(row: ShopCustomer): ShopCustomerShape {
  return shopCustomerSchema.parse({
    id: row.id,
    shop_id: row.shop_id,
    reference: row.reference,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

export function toCustomerDeviceShape(row: CustomerDevice): CustomerDeviceShape {
  return customerDeviceSchema.parse({
    id: row.id,
    customer_id: row.customer_id,
    category: row.category,
    manufacturer: row.manufacturer,
    model: row.model,
    serial_imei: row.serial_imei,
    created_at: iso(row.created_at),
  });
}

export function toRepairJobShape(row: RepairJob): RepairJobShape {
  return repairJobSchema.parse({
    id: row.id,
    shop_id: row.shop_id,
    customer_id: row.customer_id,
    device_id: row.device_id,
    session_id: row.session_id,
    job_reference: row.job_reference,
    reported_fault: row.reported_fault,
    device_condition: row.device_condition,
    accessories: row.accessories,
    assignee_user_id: row.assignee_user_id,
    priority: row.priority,
    status: row.status,
    received_at: iso(row.received_at),
    expected_at: row.expected_at ? iso(row.expected_at) : null,
    completed_at: row.completed_at ? iso(row.completed_at) : null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

export function toRepairJobEventShape(row: RepairJobEvent): RepairJobEventShape {
  return repairJobEventSchema.parse({
    id: row.id,
    job_id: row.job_id,
    actor_user_id: row.actor_user_id,
    kind: row.kind,
    body: row.body,
    from_status: row.from_status,
    to_status: row.to_status,
    created_at: iso(row.created_at),
  });
}

export function toRepairEstimateShape(row: RepairEstimate): RepairEstimateShape {
  return repairEstimateSchema.parse({
    id: row.id,
    job_id: row.job_id,
    status: row.status,
    diagnosis_summary: row.diagnosis_summary,
    recommended_repair: row.recommended_repair,
    labor_cents: row.labor_cents,
    other_cents: row.other_cents,
    currency: row.currency,
    validity_days: row.validity_days,
    terms: row.terms,
    created_by_user_id: row.created_by_user_id,
    decided_at: row.decided_at ? iso(row.decided_at) : null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

export function toRepairEstimateItemShape(row: RepairEstimateItem): RepairEstimateItemShape {
  return repairEstimateItemSchema.parse({
    id: row.id,
    estimate_id: row.estimate_id,
    kind: row.kind,
    description: row.description,
    part_number: row.part_number,
    quantity: row.quantity,
    unit_cents: row.unit_cents,
    source_part_rec_id: row.source_part_rec_id,
  });
}

export function toInventoryItemShape(row: InventoryItem): InventoryItemShape {
  return inventoryItemSchema.parse({
    id: row.id,
    shop_id: row.shop_id,
    name: row.name,
    part_number: row.part_number,
    supplier: row.supplier,
    cost_cents: row.cost_cents,
    price_cents: row.price_cents,
    quantity: row.quantity,
    low_threshold: row.low_threshold,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

export function toInventoryMovementShape(row: InventoryMovement): InventoryMovementShape {
  return inventoryMovementSchema.parse({
    id: row.id,
    item_id: row.item_id,
    job_id: row.job_id,
    delta: row.delta,
    reason: row.reason,
    created_by_user_id: row.created_by_user_id,
    created_at: iso(row.created_at),
  });
}

export function toShopReportSummaryShape(input: {
  from: string | null;
  to: string | null;
  jobsTotal: number;
  jobsByStatus: Record<string, number>;
  inProgress: number;
  avgTurnaroundHours: number | null;
  partsConsumption: ShopReportSummary["parts_consumption"];
  workload: ShopReportSummary["workload"];
}): ShopReportSummary {
  return shopReportSummarySchema.parse({
    from: input.from,
    to: input.to,
    jobs_total: input.jobsTotal,
    jobs_by_status: input.jobsByStatus,
    in_progress: input.inProgress,
    avg_turnaround_hours: input.avgTurnaroundHours,
    parts_consumption: input.partsConsumption,
    workload: input.workload,
  });
}

export function toSpeakPolicyResponse(input: {
  text: string;
  ssml: string;
  language: string;
  rate: number;
  voiceId: string | null;
  substituted: boolean;
  safetyState: string | null;
  warnings: string[];
}): SpeakPolicyResponse {
  return speakPolicyResponseSchema.parse({
    text: input.text,
    ssml: input.ssml,
    language: input.language,
    rate: input.rate,
    voice_id: input.voiceId,
    mode: "browser-speech-synthesis",
    audio_base64: null,
    substituted: input.substituted,
    safety_state: input.safetyState,
    warnings: input.warnings,
  });
}

export function toSupplierResponse(
  row: Supplier,
  productCount: number,
): SupplierShape {
  return supplierSchema.parse({
    id: row.id,
    name: row.name,
    website_url: row.website_url,
    feed_type: row.feed_type,
    feed_base_url: row.feed_base_url,
    search_url_template: row.search_url_template,
    sync_enabled: row.sync_enabled,
    last_sync_at: row.last_sync_at ? iso(row.last_sync_at) : null,
    last_sync_status: row.last_sync_status,
    last_sync_error: row.last_sync_error,
    product_count: productCount,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

export function toSupplierProductResponse(row: SupplierProduct): SupplierProductShape {
  return supplierProductSchema.parse({
    id: row.id,
    supplier_id: row.supplier_id,
    external_id: row.external_id,
    name: row.name,
    part_number: row.part_number,
    price_cents: row.price_cents,
    currency: row.currency,
    stock_status: row.stock_status,
    product_url: row.product_url,
    image_url: row.image_url,
    last_seen_at: row.last_seen_at ? iso(row.last_seen_at) : null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}
