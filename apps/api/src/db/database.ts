import { Kysely, PostgresDialect, sql } from "kysely";
import type {
  ColumnType,
  Generated,
  Insertable,
  RawBuilder,
  Selectable,
  Transaction,
  Updateable,
} from "kysely";
import { Pool } from "pg";
import type {
  AnnotationCoordinates,
  AnnotationKind,
  ConfidenceLabel,
  DeviceCategory,
  DeviceType,
  DiagnosticTestStatus,
  DocumentType,
  EstimateItemKind,
  EstimateStatus,
  EvidenceKind,
  HypothesisStatus,
  IdentifiedComponent,
  JobEventKind,
  JobPriority,
  JobStatus,
  IngestionJobDetail,
  IngestionJobStatus,
  IngestionStatus,
  ModelRunOrigin,
  ModelRunStatus,
  ModelTaskType,
  ContactRequestStatus,
  ObservationRef,
  ObservationSource,
  PermissionStatus,
  ProcessingStatus,
  RecommendationStatus,
  ReportData,
  ReportStatus,
  SafetyClassification,
  SafetyState,
  SessionStatus,
  ShopMemberRole,
  SkillLevel,
  SupplierFeedType,
  SupplierStockStatus,
  SupplierSyncStatus,
  SuspectedFaultArea,
  TestInstruction,
  TestResultOption,
  TriggerType,
  UserMode,
  ValidationStatus,
  VoiceRole,
} from "@fieldfix/contracts";

/** timestamptz columns: read as Date, accept Date or ISO string on write. */
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

/*
 * Table row shapes. Column order and nullability mirror the migrations.
 * Every column with a SQL DEFAULT is Generated so inserts may omit it.
 */

export interface DiagnosticSessionsTable {
  id: Generated<string>;
  device_type: DeviceType;
  manufacturer: string | null;
  model: string | null;
  operating_system: string | null;
  symptoms: string;
  problem_started_at: Timestamp | null;
  problem_started_note: string | null;
  recent_events: string | null;
  user_mode: UserMode;
  status: Generated<SessionStatus>;
  safety_state: Generated<SafetyState>;
  access_token_hash: string;
  is_demo: Generated<boolean>;
  user_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface UsersTable {
  id: Generated<string>;
  email: string;
  name: string;
  password_hash: string;
  email_confirmed_at: Timestamp | null;
  role: Generated<UserRole>;
  status: Generated<UserStatus>;
  last_login_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export type UserRole = "super_admin" | "admin" | "operator" | "technician";
export type UserStatus = "active" | "suspended" | "deactivated";

export interface AdminAuditLogsTable {
  id: Generated<string>;
  actor_type: "user" | "token";
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: "success" | "denied" | "failed";
  metadata: unknown;
  ip: string | null;
  created_at: Generated<Timestamp>;
}

export interface PlatformSettingsTable {
  key: string;
  value: unknown;
  updated_by: string | null;
  updated_at: Generated<Timestamp>;
}

export interface SafetyIncidentReviewsTable {
  id: Generated<string>;
  safety_event_id: string;
  reviewed_by: string | null;
  note: string;
  created_at: Generated<Timestamp>;
}

export interface NotificationRecordsTable {
  id: Generated<string>;
  user_id: string | null;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  is_read: Generated<boolean>;
  created_at: Generated<Timestamp>;
}

export interface UserEmailTokensTable {
  id: Generated<string>;
  user_id: string;
  kind: "email_confirmation" | "password_reset";
  token_hash: string;
  expires_at: Timestamp;
  used_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface UserSessionsTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  expires_at: Timestamp;
  created_at: Generated<Timestamp>;
}

export interface UserMfaTable {
  user_id: string;
  secret_enc: string;
  verified_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface UserMfaBackupCodesTable {
  id: Generated<string>;
  user_id: string;
  code_hash: string;
  used_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface UserMfaChallengesTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  expires_at: Timestamp;
  used_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface RateLimitWindowsTable {
  route_key: string;
  window_start: Timestamp;
  count: number;
}

export interface VoicePreferencesTable {
  user_id: string;
  spoken_responses: Generated<boolean>;
  voice_id: string | null;
  rate: Generated<number>;
  language: Generated<string>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface VoiceInteractionsTable {
  id: Generated<string>;
  session_id: string;
  user_id: string | null;
  role: VoiceRole;
  text: string;
  audio_storage_key: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface SpeechTranscriptionsTable {
  id: Generated<string>;
  session_id: string;
  provider: string;
  model_id: string;
  transcript: string;
  confidence: number | null;
  audio_duration_ms: number | null;
  model_run_id: string | null;
  created_at: Generated<Timestamp>;
}

export interface PartRecommendationsTable {
  id: Generated<string>;
  session_id: string;
  hypothesis_id: string | null;
  test_id: string | null;
  part_name: string;
  part_number: string | null;
  manufacturer: string | null;
  model_compat: string | null;
  chunk_id: string | null;
  excerpt: string | null;
  status: Generated<RecommendationStatus>;
  created_at: Generated<Timestamp>;
}

export interface ToolRecommendationsTable {
  id: Generated<string>;
  session_id: string;
  test_id: string | null;
  tool_name: string;
  spec: string | null;
  chunk_id: string | null;
  status: Generated<RecommendationStatus>;
  created_at: Generated<Timestamp>;
}

export interface TechnicianProfilesTable {
  user_id: string;
  display_name: string;
  city: string;
  region: string;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  specialties: string[];
  device_types: string[];
  phone: string | null;
  contact_email: string | null;
  whatsapp: string | null;
  about: string | null;
  accepting_requests: Generated<boolean>;
  verified: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface TechnicianContactRequestsTable {
  id: Generated<string>;
  session_id: string | null;
  requester_user_id: string | null;
  technician_user_id: string;
  message: string;
  contact_method: string | null;
  preferred_time: string | null;
  status: Generated<ContactRequestStatus>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface SharedDiagnosticHandoffsTable {
  id: Generated<string>;
  request_id: string;
  session_id: string;
  shared_evidence_ids: string[];
  shared_report: Generated<boolean>;
  created_by_user_id: string;
  created_at: Generated<Timestamp>;
}

export interface ShopsTable {
  id: Generated<string>;
  owner_user_id: string | null;
  name: string;
  description: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface ShopMembersTable {
  shop_id: string;
  user_id: string;
  role: ShopMemberRole;
}

export interface ShopCustomersTable {
  id: Generated<string>;
  shop_id: string;
  reference: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface CustomerDevicesTable {
  id: Generated<string>;
  customer_id: string;
  category: DeviceCategory;
  manufacturer: string | null;
  model: string | null;
  serial_imei: string | null;
  created_at: Generated<Timestamp>;
}

export interface RepairJobsTable {
  id: Generated<string>;
  shop_id: string;
  customer_id: string;
  device_id: string | null;
  session_id: string | null;
  job_reference: string;
  reported_fault: string;
  device_condition: string | null;
  accessories: string | null;
  assignee_user_id: string | null;
  priority: Generated<JobPriority>;
  status: Generated<JobStatus>;
  received_at: Generated<Timestamp>;
  expected_at: Timestamp | null;
  completed_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface RepairJobEventsTable {
  id: Generated<string>;
  job_id: string;
  actor_user_id: string | null;
  kind: JobEventKind;
  body: string | null;
  from_status: JobStatus | null;
  to_status: JobStatus | null;
  created_at: Generated<Timestamp>;
}

export interface RepairEstimatesTable {
  id: Generated<string>;
  job_id: string;
  status: Generated<EstimateStatus>;
  diagnosis_summary: string | null;
  recommended_repair: string | null;
  labor_cents: Generated<number>;
  other_cents: Generated<number>;
  currency: Generated<string>;
  validity_days: number | null;
  terms: string | null;
  created_by_user_id: string | null;
  decided_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface RepairEstimateItemsTable {
  id: Generated<string>;
  estimate_id: string;
  kind: EstimateItemKind;
  description: string;
  part_number: string | null;
  quantity: Generated<number>;
  unit_cents: Generated<number>;
  source_part_rec_id: string | null;
}

export interface InventoryItemsTable {
  id: Generated<string>;
  shop_id: string;
  name: string;
  part_number: string | null;
  supplier: string | null;
  cost_cents: number | null;
  price_cents: number | null;
  quantity: Generated<number>;
  low_threshold: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface InventoryMovementsTable {
  id: Generated<string>;
  item_id: string;
  job_id: string | null;
  delta: number;
  reason: string;
  created_by_user_id: string | null;
  created_at: Generated<Timestamp>;
}

export interface SuppliersTable {
  id: Generated<string>;
  name: string;
  website_url: string;
  feed_type: SupplierFeedType;
  feed_base_url: string | null;
  search_url_template: string | null;
  sync_enabled: Generated<boolean>;
  last_sync_at: Timestamp | null;
  last_sync_status: SupplierSyncStatus | null;
  last_sync_error: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface SupplierProductsTable {
  id: Generated<string>;
  supplier_id: string;
  external_id: string;
  name: string;
  part_number: string | null;
  price_cents: number | null;
  currency: string | null;
  stock_status: Generated<SupplierStockStatus>;
  product_url: string;
  image_url: string | null;
  last_seen_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface EvidenceFilesTable {
  id: Generated<string>;
  session_id: string;
  storage_key: string;
  media_type: string;
  byte_size: number;
  original_filename: string | null;
  kind: EvidenceKind;
  processing_status: Generated<ProcessingStatus>;
  processing_error: string | null;
  checksum_sha256: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface EvidenceObservationsTable {
  id: Generated<string>;
  session_id: string;
  evidence_file_id: string | null;
  source: ObservationSource;
  body: string;
  created_at: Generated<Timestamp>;
}

export interface EvidenceAnnotationsTable {
  id: Generated<string>;
  evidence_file_id: string;
  kind: AnnotationKind;
  coordinates: AnnotationCoordinates;
  label: string | null;
  producer: string;
  image_width: number;
  image_height: number;
  model_run_id: string | null;
  created_at: Generated<Timestamp>;
}

export interface EvidenceIdentificationsTable {
  id: Generated<string>;
  session_id: string;
  evidence_file_id: string;
  device_name: string | null;
  components: IdentifiedComponent[];
  suspected_fault_area: SuspectedFaultArea | null;
  unidentifiable: string[];
  model_run_id: string | null;
  created_at: Generated<Timestamp>;
}

export interface DiagnosticHypothesesTable {
  id: Generated<string>;
  session_id: string;
  title: string;
  description: string | null;
  supporting_observations: ObservationRef[];
  contradicting_observations: ObservationRef[];
  confidence_label: ConfidenceLabel;
  confidence_rationale: string | null;
  status: Generated<HypothesisStatus>;
  suggested_next_test_id: string | null;
  verified_by_test_result_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface HypothesisEvidenceTable {
  id: Generated<string>;
  hypothesis_id: string;
  evidence_file_id: string | null;
  observation_id: string | null;
  created_at: Generated<Timestamp>;
}

export interface DiagnosticTestsTable {
  id: Generated<string>;
  session_id: string;
  name: string;
  objective: string;
  rationale: string | null;
  required_tools: string[];
  skill_level: SkillLevel;
  safety_classification: SafetyClassification;
  instructions: TestInstruction[];
  expected_outcomes: string | null;
  result_options: TestResultOption[];
  status: Generated<DiagnosticTestStatus>;
  position: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface TestResultsTable {
  id: Generated<string>;
  test_id: string;
  session_id: string;
  selected_option: string;
  observation: string | null;
  reported_at: Generated<Timestamp>;
  created_at: Generated<Timestamp>;
}

export interface DiagnosticEventsTable {
  id: Generated<string>;
  session_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Generated<Timestamp>;
}

export interface TechnicalDocumentsTable {
  id: Generated<string>;
  title: string;
  manufacturer: string | null;
  device_family: string | null;
  model_numbers: string[];
  document_type: DocumentType;
  source_name: string;
  source_url: string | null;
  version: string | null;
  language: Generated<string>;
  licence_name: string | null;
  permission_status: Generated<PermissionStatus>;
  storage_key: string | null;
  ingestion_status: Generated<IngestionStatus>;
  ingestion_error: string | null;
  checksum_sha256: string | null;
  is_demo: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface DocumentChunksTable {
  id: Generated<string>;
  document_id: string;
  chunk_index: number;
  page_number: number | null;
  heading: string | null;
  content: string;
  safety_tags: string[];
  component_tags: string[];
  model_applicability: string[];
  search_vector: Generated<string>;
  created_at: Generated<Timestamp>;
}

export interface SourceCitationsTable {
  id: Generated<string>;
  session_id: string;
  hypothesis_id: string | null;
  test_id: string | null;
  chunk_id: string;
  excerpt: string;
  note: string | null;
  created_at: Generated<Timestamp>;
}

export interface IngestionJobsTable {
  id: Generated<string>;
  document_id: string | null;
  source_name: string;
  status: Generated<IngestionJobStatus>;
  error: string | null;
  chunks_created: Generated<number>;
  detail: IngestionJobDetail | null;
  created_at: Generated<Timestamp>;
  finished_at: Timestamp | null;
}

export interface SafetyEventsTable {
  id: Generated<string>;
  session_id: string;
  previous_state: SafetyState;
  new_state: SafetyState;
  trigger_type: TriggerType;
  trigger_detail: string | null;
  evidence_file_id: string | null;
  blocked_action: string | null;
  safe_next_steps: string;
  created_at: Generated<Timestamp>;
}

export interface RepairReportsTable {
  id: Generated<string>;
  session_id: string;
  status: Generated<ReportStatus>;
  report_data: ReportData;
  error_message: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface ModelRunsTable {
  id: Generated<string>;
  session_id: string | null;
  provider: string;
  model_id: string;
  task_type: ModelTaskType;
  status: Generated<ModelRunStatus>;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  request_id: string | null;
  error_category: string | null;
  error_message: string | null;
  diagnostic_stage: string | null;
  input_modality: Generated<string[]>;
  validation_status: Generated<ValidationStatus>;
  provider_response_id: string | null;
  origin: Generated<ModelRunOrigin>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface Database {
  diagnostic_sessions: DiagnosticSessionsTable;
  evidence_files: EvidenceFilesTable;
  evidence_observations: EvidenceObservationsTable;
  evidence_annotations: EvidenceAnnotationsTable;
  evidence_identifications: EvidenceIdentificationsTable;
  diagnostic_hypotheses: DiagnosticHypothesesTable;
  hypothesis_evidence: HypothesisEvidenceTable;
  diagnostic_tests: DiagnosticTestsTable;
  test_results: TestResultsTable;
  diagnostic_events: DiagnosticEventsTable;
  technical_documents: TechnicalDocumentsTable;
  document_chunks: DocumentChunksTable;
  source_citations: SourceCitationsTable;
  ingestion_jobs: IngestionJobsTable;
  safety_events: SafetyEventsTable;
  repair_reports: RepairReportsTable;
  model_runs: ModelRunsTable;
  users: UsersTable;
  user_sessions: UserSessionsTable;
  user_email_tokens: UserEmailTokensTable;
  user_mfa: UserMfaTable;
  user_mfa_backup_codes: UserMfaBackupCodesTable;
  user_mfa_challenges: UserMfaChallengesTable;
  rate_limit_windows: RateLimitWindowsTable;
  admin_audit_logs: AdminAuditLogsTable;
  platform_settings: PlatformSettingsTable;
  safety_incident_reviews: SafetyIncidentReviewsTable;
  notification_records: NotificationRecordsTable;
  voice_preferences: VoicePreferencesTable;
  voice_interactions: VoiceInteractionsTable;
  speech_transcriptions: SpeechTranscriptionsTable;
  part_recommendations: PartRecommendationsTable;
  tool_recommendations: ToolRecommendationsTable;
  technician_profiles: TechnicianProfilesTable;
  technician_contact_requests: TechnicianContactRequestsTable;
  shared_diagnostic_handoffs: SharedDiagnosticHandoffsTable;
  shops: ShopsTable;
  shop_members: ShopMembersTable;
  shop_customers: ShopCustomersTable;
  customer_devices: CustomerDevicesTable;
  repair_jobs: RepairJobsTable;
  repair_job_events: RepairJobEventsTable;
  repair_estimates: RepairEstimatesTable;
  repair_estimate_items: RepairEstimateItemsTable;
  inventory_items: InventoryItemsTable;
  inventory_movements: InventoryMovementsTable;
  suppliers: SuppliersTable;
  supplier_products: SupplierProductsTable;
}

/* Row / insert / update helpers per table. */

export type DiagnosticSession = Selectable<DiagnosticSessionsTable>;
export type NewDiagnosticSession = Insertable<DiagnosticSessionsTable>;
export type DiagnosticSessionUpdate = Updateable<DiagnosticSessionsTable>;

export type EvidenceFile = Selectable<EvidenceFilesTable>;
export type NewEvidenceFile = Insertable<EvidenceFilesTable>;
export type EvidenceFileUpdate = Updateable<EvidenceFilesTable>;

export type EvidenceObservation = Selectable<EvidenceObservationsTable>;
export type NewEvidenceObservation = Insertable<EvidenceObservationsTable>;

export type EvidenceAnnotation = Selectable<EvidenceAnnotationsTable>;
export type NewEvidenceAnnotation = Insertable<EvidenceAnnotationsTable>;

export type EvidenceIdentification = Selectable<EvidenceIdentificationsTable>;
export type NewEvidenceIdentification = Insertable<EvidenceIdentificationsTable>;

export type DiagnosticHypothesis = Selectable<DiagnosticHypothesesTable>;
export type NewDiagnosticHypothesis = Insertable<DiagnosticHypothesesTable>;
export type DiagnosticHypothesisUpdate =
  Updateable<DiagnosticHypothesesTable>;

export type HypothesisEvidenceLink = Selectable<HypothesisEvidenceTable>;
export type NewHypothesisEvidenceLink = Insertable<HypothesisEvidenceTable>;

export type DiagnosticTest = Selectable<DiagnosticTestsTable>;
export type NewDiagnosticTest = Insertable<DiagnosticTestsTable>;
export type DiagnosticTestUpdate = Updateable<DiagnosticTestsTable>;

export type TestResult = Selectable<TestResultsTable>;
export type NewTestResult = Insertable<TestResultsTable>;

export type DiagnosticEvent = Selectable<DiagnosticEventsTable>;
export type NewDiagnosticEvent = Insertable<DiagnosticEventsTable>;

export type TechnicalDocument = Selectable<TechnicalDocumentsTable>;
export type NewTechnicalDocument = Insertable<TechnicalDocumentsTable>;
export type TechnicalDocumentUpdate = Updateable<TechnicalDocumentsTable>;

export type DocumentChunk = Selectable<DocumentChunksTable>;
export type NewDocumentChunk = Insertable<DocumentChunksTable>;

export type SourceCitation = Selectable<SourceCitationsTable>;
export type NewSourceCitation = Insertable<SourceCitationsTable>;

export type IngestionJob = Selectable<IngestionJobsTable>;
export type NewIngestionJob = Insertable<IngestionJobsTable>;

export type SafetyEvent = Selectable<SafetyEventsTable>;
export type NewSafetyEvent = Insertable<SafetyEventsTable>;

export type RepairReport = Selectable<RepairReportsTable>;
export type NewRepairReport = Insertable<RepairReportsTable>;
export type RepairReportUpdate = Updateable<RepairReportsTable>;

export type ModelRun = Selectable<ModelRunsTable>;
export type NewModelRun = Insertable<ModelRunsTable>;
export type ModelRunUpdate = Updateable<ModelRunsTable>;

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;

export type UserSession = Selectable<UserSessionsTable>;
export type NewUserSession = Insertable<UserSessionsTable>;

export type UserEmailToken = Selectable<UserEmailTokensTable>;
export type NewUserEmailToken = Insertable<UserEmailTokensTable>;

export type UserMfa = Selectable<UserMfaTable>;
export type NewUserMfa = Insertable<UserMfaTable>;

export type UserMfaBackupCode = Selectable<UserMfaBackupCodesTable>;
export type NewUserMfaBackupCode = Insertable<UserMfaBackupCodesTable>;

export type UserMfaChallenge = Selectable<UserMfaChallengesTable>;
export type NewUserMfaChallenge = Insertable<UserMfaChallengesTable>;

export type AdminAuditLog = Selectable<AdminAuditLogsTable>;
export type NewAdminAuditLog = Insertable<AdminAuditLogsTable>;

export type PlatformSetting = Selectable<PlatformSettingsTable>;

export type SafetyIncidentReview = Selectable<SafetyIncidentReviewsTable>;
export type NewSafetyIncidentReview = Insertable<SafetyIncidentReviewsTable>;

export type NotificationRecord = Selectable<NotificationRecordsTable>;
export type NewNotificationRecord = Insertable<NotificationRecordsTable>;

export type VoicePreference = Selectable<VoicePreferencesTable>;
export type NewVoicePreference = Insertable<VoicePreferencesTable>;
export type VoicePreferenceUpdate = Updateable<VoicePreferencesTable>;

export type VoiceInteraction = Selectable<VoiceInteractionsTable>;
export type NewVoiceInteraction = Insertable<VoiceInteractionsTable>;

export type SpeechTranscription = Selectable<SpeechTranscriptionsTable>;
export type NewSpeechTranscription = Insertable<SpeechTranscriptionsTable>;

export type PartRecommendation = Selectable<PartRecommendationsTable>;
export type NewPartRecommendation = Insertable<PartRecommendationsTable>;

export type ToolRecommendation = Selectable<ToolRecommendationsTable>;
export type NewToolRecommendation = Insertable<ToolRecommendationsTable>;

export type TechnicianProfile = Selectable<TechnicianProfilesTable>;
export type NewTechnicianProfile = Insertable<TechnicianProfilesTable>;
export type TechnicianProfileUpdate = Updateable<TechnicianProfilesTable>;

export type TechnicianContactRequest = Selectable<TechnicianContactRequestsTable>;
export type NewTechnicianContactRequest = Insertable<TechnicianContactRequestsTable>;

export type SharedDiagnosticHandoff = Selectable<SharedDiagnosticHandoffsTable>;
export type NewSharedDiagnosticHandoff = Insertable<SharedDiagnosticHandoffsTable>;

export type Shop = Selectable<ShopsTable>;
export type NewShop = Insertable<ShopsTable>;
export type ShopUpdate = Updateable<ShopsTable>;

export type ShopMember = Selectable<ShopMembersTable>;
export type NewShopMember = Insertable<ShopMembersTable>;

export type ShopCustomer = Selectable<ShopCustomersTable>;
export type NewShopCustomer = Insertable<ShopCustomersTable>;
export type ShopCustomerUpdate = Updateable<ShopCustomersTable>;

export type CustomerDevice = Selectable<CustomerDevicesTable>;
export type NewCustomerDevice = Insertable<CustomerDevicesTable>;

export type RepairJob = Selectable<RepairJobsTable>;
export type NewRepairJob = Insertable<RepairJobsTable>;
export type RepairJobUpdate = Updateable<RepairJobsTable>;

export type RepairJobEvent = Selectable<RepairJobEventsTable>;
export type NewRepairJobEvent = Insertable<RepairJobEventsTable>;

export type RepairEstimate = Selectable<RepairEstimatesTable>;
export type NewRepairEstimate = Insertable<RepairEstimatesTable>;
export type RepairEstimateUpdate = Updateable<RepairEstimatesTable>;

export type RepairEstimateItem = Selectable<RepairEstimateItemsTable>;
export type NewRepairEstimateItem = Insertable<RepairEstimateItemsTable>;

export type InventoryItem = Selectable<InventoryItemsTable>;
export type NewInventoryItem = Insertable<InventoryItemsTable>;
export type InventoryItemUpdate = Updateable<InventoryItemsTable>;

export type InventoryMovement = Selectable<InventoryMovementsTable>;
export type NewInventoryMovement = Insertable<InventoryMovementsTable>;

export type Supplier = Selectable<SuppliersTable>;
export type NewSupplier = Insertable<SuppliersTable>;
export type SupplierUpdate = Updateable<SuppliersTable>;

export type SupplierProduct = Selectable<SupplierProductsTable>;
export type NewSupplierProduct = Insertable<SupplierProductsTable>;
export type SupplierProductUpdate = Updateable<SupplierProductsTable>;

/** A root connection or an in-progress transaction — repositories take either. */
export type Db = Kysely<Database> | Transaction<Database>;

/**
 * Wrap a value for a JSONB column. node-pg serializes top-level arrays
 * as PostgreSQL array literals (rejected by jsonb), so all JSONB writes
 * go through an explicitly cast parameter.
 */
export function jsonb<T>(value: T): RawBuilder<T> {
  return sql<T>`${JSON.stringify(value)}::jsonb`;
}

/** Open a pooled Kysely connection. Call closeDb when done. */
export function createDb(
  connectionString: string,
  maxConnections = 10,
): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString, max: maxConnections }),
    }),
  });
}

export async function closeDb(db: Kysely<Database>): Promise<void> {
  await db.destroy();
}
