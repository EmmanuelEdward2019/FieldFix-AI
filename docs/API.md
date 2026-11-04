# API reference

Base URL: `http://localhost:3001` (see `NEXT_PUBLIC_API_URL` /
`apps/api/.env.example`). All routes live under `/api/v1` and return
JSON, except the report PDF export and evidence downloads. Failures
use the shared error envelope:

```json
{ "error": { "code": "forbidden", "message": "..." } }
```

- `GET /health` (no `/api/v1` prefix, no auth) — liveness probe:
  `{ status: "ok", service, version, uptimeSeconds, timestamp }`.
- Unknown routes return `404 not_found` in the same envelope.
- Malformed JSON bodies return `400 invalid_request`; bodies over
  the 1 MB cap return `413 payload_too_large`.
- `/api/*` is rate-limited (300 req/min per IP, PostgreSQL-backed shared counters);
  over-budget callers get `429 rate_limited` with a `Retry-After`
  header. The limiter is skipped when `NODE_ENV=test`.

## Authentication

Two bearer-token schemes, both SHA-256 hashed at rest and sent as:

```text
Authorization: Bearer <token>
```

**User accounts** (`/api/v1/auth/*`, `/api/v1/users/*`). Passwords
are scrypt-hashed (per-user salt, `node:crypto` only). Login issues
a 30-day token; logout invalidates it server-side. `POST
/api/v1/sessions` accepts an optional user token and links the new
session to that account (`user_id`); anonymous creation still works
and stays unowned. A user token grants access to that user's own
sessions only — swapping in another user's session id returns `403`.
Missing or wrong credentials return uniform `401
invalid_credentials` (unknown emails are hashed against a dummy
record to avoid enumeration timing). `/api/v1/auth/*` is further
rate-limited (60 req/15 min per IP, PostgreSQL-backed, skipped in tests).

**Session tokens.** `POST /api/v1/sessions` issues an `accessToken`
(revealed once). Every other session route accepts it, or the
owning user's login token. Unknown or malformed session ids return
`404 session_not_found`; missing or wrong tokens return `403
forbidden`.

Admin routes (`/api/v1/admin/*`) require a user login session whose
role grants the matching capability (see Roles). Bootstrap the
first Super Admin via `SUPER_ADMIN_EMAILS`, then assign roles from
Admin > Users. Knowledge
search is open but serves only `approved` + `indexed` excerpts.

## Endpoints

### POST /api/v1/sessions

Create a session. Body follows `createSessionSchema`
(`device_type`, `symptoms`, `user_mode` required; manufacturer, model,
OS, onset notes, recent events optional).

- `201` — `{ session, accessToken }` (`createSessionResponseSchema`).
- `400 invalid_request` — body failed validation.
- `503 database_unavailable` — server runs without `DATABASE_URL`.

### GET /api/v1/sessions/:id

Full dashboard snapshot (`sessionDetailResponseSchema`): `session`,
`evidence`, `observations`, plus `hypotheses`, `tests` (each with
its latest `result` or `null`), `events` (workflow timeline),
`citations` (resolved with document title/page), `safety_events`,
and `model_runs` (provider, model, task, status, latency — no
prompts or keys). Secrets are never serialized.

- `200`, `403`, `404` as above.

### GET /api/v1/sessions/:id/evidence

List evidence metadata: `{ evidence }` (`listEvidenceResponseSchema`).
Storage keys are internal and never returned.

- `200`, `403`, `404` as above.

### POST /api/v1/sessions/:id/evidence

Multipart upload. Fields: `file` (required, single), `observation`
(optional user note, ≤ 8000 chars).

Server-side validation, in order:

1. File present and non-empty (`400 file_missing` / `file_empty`).
2. Size within `MAX_UPLOAD_MB` (`413 file_too_large`).
3. Media type allowlisted — JPEG, PNG, WebP, GIF (`415
   unsupported_media_type`; video is rejected as unsupported for now).
4. Magic bytes match the declared type (`415 file_content_mismatch`).

On success the bytes go to private object storage, metadata (media
type, size, checksum, processing status) goes to PostgreSQL, and the
optional note becomes a user observation. Returns `201`
(`uploadEvidenceResponseSchema`). If storage fails, no metadata row is
written (`500 storage_error`).

### GET /api/v1/sessions/:id/evidence/:fileId/download

Streams the stored bytes with the recorded content type
(`Content-Disposition: inline`, private cache). The file must belong to
the session or the route returns `404 file_not_found`. There is no
public URL for stored objects.

## User accounts

- `POST /api/v1/auth/register` — create an account
  (`registerSchema`: name, email, password ≥ 8 chars). `201`
  (`registerResponseSchema`: `{ user, confirmation_required: true }`
  — registration never signs in); `409` email taken; `400` bad body.
  Queues a confirmation email (Resend, or API-console log without
  `RESEND_API_KEY`).
- `POST /api/v1/auth/login` — email + password. `200`
  (`loginResponseSchema`: either `authResponseSchema`, or
  `{ mfa_required: true, mfa_token }` for TOTP-enrolled accounts —
  complete with `POST /api/v1/auth/mfa/challenge`);
  `401 invalid_credentials` either way; `403 email_unconfirmed`
  until the emailed link is clicked.
- `GET /api/v1/auth/mfa/status` — `{ enabled, verified_at }` for
  the caller.
- `POST /api/v1/auth/mfa/enroll` — start TOTP enrollment
  (`{ otpauth_url, secret }`, pending until verified); `409` when
  already enabled; `503 mfa_unavailable` without
  `MFA_ENCRYPTION_KEY` (64 hex chars).
- `POST /api/v1/auth/mfa/verify` — `{ code }` activates a pending
  enrollment (returns 10 single-use backup codes, shown once) or
  confirms an active one. `401 invalid_code` on mismatch.
- `POST /api/v1/auth/mfa/challenge` — `{ mfa_token, code }` (TOTP
  or backup code) completes an MFA login. Tokens are 5-minute,
  single-use. `200 authResponseSchema`.
- `POST /api/v1/auth/mfa/disable` — `{ code }` removes MFA.
  Super Admin console access requires verified MFA (`403
  mfa_required` otherwise).
- `POST /api/v1/auth/verify-email` — `{ token }` from the emailed
  link (24h, single-use). `200` (`authResponseSchema`: verification
  signs the user in); `400 invalid_or_expired`.
- `POST /api/v1/auth/verify-email/resend` — `{ email }`, always
  `200 { ok: true }` (uniform; only unconfirmed accounts get mail,
  and older links are revoked).
- `POST /api/v1/auth/password/forgot` — `{ email }`, always `200
  { ok: true }` (uniform; 1h single-use reset link).
- `POST /api/v1/auth/password/reset` — `{ token, new_password }`.
  `204`, signs out everywhere; `400 invalid_or_expired`.
- `POST /api/v1/auth/logout` — invalidate the current token. `204`.
- `POST /api/v1/auth/logout-all` — invalidate every token for the
  account (also runs on password change). `204`.
- `GET /api/v1/auth/me` — `{ user }` (`userResponseSchema`).
- `PATCH /api/v1/auth/me` — rename (`updateProfileSchema`). `200`
  `{ user }`.
- `POST /api/v1/auth/password` — change password
  (`changePasswordSchema`), signs out all tokens. `204`; `401`
  wrong current password.
- `GET /api/v1/users/me/sessions` — sessions owned by the caller,
  newest first (`listOwnedSessionsResponseSchema`).
- `GET /api/v1/users/me/reports` — `ready` reports across the
  caller's sessions, newest first (`listOwnedReportsResponseSchema`).

All except register/login require the user Bearer [REDACTED] never
serialized (register/login responses carry only the token).

## Segmentation (component localization — never a diagnosis)

Optional per-image region marking, backed by SAM 3.1 server-side.
Original evidence bytes are never modified; geometry persists as
`annotations` rows with the source image dimensions and renders as an
overlay. Both routes require the session token.

### POST /api/v1/sessions/:id/evidence/:fileId/segmentations

Body follows `segmentRequestSchema`: optional `concepts` (1–8 plain
noun phrases, no `<|>`, max 80 chars each). Omitted concepts default
to the device vocabulary (laptop, desktop, and smartphone: 8 parts
each), one provider call per concept. Returns `201` with
`segmentResponseSchema`: persisted `annotations` (box + mask rows with
`image_width`/`image_height` and server-rendered `svg_path` for
masks), per-concept `runs`, `concepts_used`, and `warnings`.
All-or-nothing: a failed call persists nothing. `400 invalid_request`
on a bad body, `404` on unknown ids, `502 provider_failed` when the
model call fails, `503 segmentation_unavailable` when no provider is
configured.

### GET /api/v1/sessions/:id/evidence/:fileId/segmentations

Returns `listSegmentationsResponseSchema`: persisted `annotations`
plus the image dimensions (`null` when nothing was segmented yet).
Mask reads degrade honestly: an undecodable mask keeps its row with
`svg_path: null` instead of failing the request.

## Knowledge

### POST /api/v1/knowledge/search

Full-text search over `approved` + `indexed` documents only. Body
follows `knowledgeSearchSchema` (`query` required; optional
`manufacturer` / `model` filters; `limit` 1–50, default 10).
Returns `{ hits }` (`knowledgeSearchResponseSchema`): chunk id,
document id + title, page, heading, a real `ts_headline` excerpt,
and rank. `400 invalid_request` on a bad body.

## Diagnostics (the loop)

Session-token routes under `/api/v1/sessions/:id`, implemented by
`DiagnosticEngineService` (`apps/api/src/diagnostics/`):

- `POST /:id/analyze` — run one reasoning pass and persist it:
  new/updated hypotheses with linked evidence, proposed tests with
  screened safety classifications, and a workflow event. Body:
  `analyzeRequestSchema` (`stage`, `question`, `provider_id`, all
  optional). `200` (`analyzeResponseSchema`); model failures return
  `429`/`502`/`504` with nothing persisted; `422 safety_block` in
  critical stop.
- `GET /:id/hypotheses` — `{ hypotheses }`, creation order.
- `POST /:id/hypotheses/:hypothesisId/verify` — the only path to
  `verified`: technician sessions only (`403` otherwise), with a
  rationale body, recorded as a `hypothesis_verified` event. `422`
  for ruled-out hypotheses.
- `GET /:id/tests` — `{ tests: [{ test, result }] }` with the latest
  user-reported result per test (or `null`).
- `POST /:id/tests/:testId/results` — record a user-reported result
  (`recordTestResultSchema`; the option must be one of the test's),
  then reassess automatically. `201`
  (`recordResultResponseSchema`); `400` bad option, `404` unknown
  test, `409` result already recorded, `422` blocked test. When
  reassessment fails the result still stands
  (`reassessment_applied: false`) and analysis can be retried.
- `POST /:id/citations` — attach a verified citation
  (`createCitationSchema`: `chunk_id` + `excerpt` plus a
  `hypothesis_id` and/or `test_id` link). The excerpt must occur
  verbatim in a real chunk of an approved, indexed document, or the
  attach is refused — fabricated citations cannot be stored. `201`
  `{ citation }`; `400` bad body, `404` unknown chunk/link, `422`
  excerpt not found or document not citable.
- `GET /:id/report` — compile the current durable state into a
  `ready` report snapshot (`reportResponseSchema`): device,
  symptoms, evidence, observations, hypotheses (with
  supporting/contradicting refs), user-reported results (always
  labeled `user_reported`), resolved citations, remaining
  uncertainty, next steps, safety events, a deterministic
  `assessment` summary, and the session `timeline`.
  `GET /:id/report?format=pdf` returns the same snapshot as a
  `application/pdf` attachment (`fieldfix-report-<id>.pdf`); render
  failures return `500 report_failed`.

Provenance is structural: results captured through the API carry
`source: "user_reported"` in every response and report; no loop
transition sets `verified` except explicit technician confirmation.

## Parts and tools advisor

Deterministic v1: technician-entered part/tool suggestions with
optional manual provenance. Session-token routes under
`/api/v1/sessions/:id`, implemented by `PartsAdvisorService`
(`apps/api/src/parts/`). There are deliberately no price, stock,
availability, image, or supplier fields anywhere in the contracts,
tables, or responses — supplier catalogues are a later integration,
and what the schema cannot express cannot be fabricated.

- `POST /:id/parts/recommendations` — suggest a part
  (`createPartRecommendationSchema`: `part_name` plus optional
  `part_number`/`manufacturer`/`model_compat`, exactly one of
  `hypothesis_id`/`test_id`, optional `chunk_id` + `excerpt`
  pair). The excerpt must occur verbatim in a real chunk of an
  approved, indexed document or the write is refused. `201`
  `{ recommendation }`; `400` bad body (including zero or two
  links), `404` unknown session/link/chunk, `422` excerpt not
  found or document not citable.
- `GET /:id/parts/recommendations` — `{ recommendations }`,
  creation order (`[]` when none).
- `PATCH /:id/parts/recommendations/:recId` — accept or dismiss
  (`updateRecommendationStatusSchema`: `accepted`|`dismissed`
  only). `200`; `404` unknown recommendation, `400` bad status.
- `POST /:id/tools/recommendations` — suggest a tool
  (`createToolRecommendationSchema`: `tool_name`, optional `spec`,
  optional `test_id` link, optional `chunk_id` pointer — no
  excerpt: tools cite a passage by reference). The chunk's document
  must still be approved and indexed. Same statuses as parts.
- `GET /:id/tools/recommendations` — `{ recommendations }`,
  creation order.
- `PATCH /:id/tools/recommendations/:recId` — accept or dismiss.

Recommendations are not citations: creating one never inserts a
`source_citations` row. Auth follows the session pattern: `404`
unknown session, `403` missing or wrong token.

## Technicians (contact technicians near me)

Public directory of opt-in technician profiles plus login-gated
profile self-service, contact requests, and consent-scoped
diagnostic handoffs. Search and cards are public (no login);
managing your own profile and everything that writes or reads a
request needs the user login token. There are deliberately no
rating/review fields anywhere — the only trust signal is the
admin-managed `verified` boolean (default false).

- `GET /api/v1/technicians` — public search
  (`searchTechniciansQuerySchema`: optional `city`/`region`/
  `specialty`/`device_type`, optional `lat`+`lng` with
  `radius_km` 1..200 default 10, `limit` 1..50 default 20).
  Accepting profiles only, verified and unverified alike (the
  badge is a label, not a filter). With `lat`+`lng`, only
  geo-opted-in profiles within the radius return, nearest first
  with `distance_km`; without, every accepting profile returns
  with `distance_km: null`. The searcher's coordinates are query
  params only — never stored. `200`
  (`listTechniciansResponseSchema`, no contact PII); `400` bad
  query (including half-specified lat/lng).
- `GET /api/v1/technicians/:userId` — public card
  (`technicianResponseSchema`): profile plus phone/email/whatsapp
  only when the profile exposes them. `200`; `404` unknown id or
  user without a profile.
- `GET /api/v1/technicians/me` — own full profile (login,
  `technicianResponseSchema`): the same card shape including the
  caller's own contacts. `200`; `401` anonymous, `404` no
  profile yet.
- `PUT /api/v1/technicians/me` — create or replace the own
  profile (login, `upsertOwnTechnicianProfileSchema`:
  `display_name`/`city`/`region`, optional `postal_code`,
  `latitude`+`longitude` (nullable, together-or-neither —
  geo-discovery opt-in), `specialties`/`device_types` default
  `[]`, optional `phone`/`contact_email`/`whatsapp`/`about`,
  `accepting_requests` default true). `verified` is not part
  of the schema and is silently ignored, so the admin badge
  can neither be set nor cleared here. Audited
  (`technician.profile.upsert`). `201` created, `200`
  updated; `401` anonymous, `400` bad payload.
- `POST /api/v1/technicians/:userId/contact` — login required
  (`createContactRequestSchema`: `message` 1..2000 chars, optional
  `session_id`, `contact_method`, `preferred_time`). A linked
  session must exist and be owned by the caller. Creates the
  request, a `contact_request` notification for the technician,
  and an audit entry. Own `contact` rate-limit scope (never
  shared with auth). `201`; `401` anonymous, `404` unknown
  technician/session, `403` linking someone else's session, `422`
  not accepting or contacting yourself.
- `GET /api/v1/technicians/requests` — inbox (login,
  owner-only rows). `?role=sent` for requests the caller made,
  `?role=received` (default) for requests addressed to them.
  `200`; `401` anonymous, `400` bad role.
- `PATCH /api/v1/technicians/requests/:reqId` — status
  (`updateContactRequestStatusSchema`). The technician side may
  set `awaiting_response`/`accepted`/`declined`/
  `customer_contacted`/`in_progress`/`completed`; the requester
  side may only set `cancelled`. Forward-only lifecycle:
  `declined`/`completed`/`cancelled` are terminal.
  Same-status writes are idempotent. `200`; `404` unknown,
  `403` wrong side or stranger, `422` illegal transition.
- `POST /api/v1/technicians/requests/:reqId/handoff` — requester
  only (`createHandoffSchema`: own `session_id`, an explicit
  `shared_evidence_ids` allowlist, `shared_report` default
  false). Every evidence id must be a file on that session.
  `201`; `403` non-requester or foreign session, `422`
  evidence outside the session.
- `GET /api/v1/technicians/requests/:reqId/handoff` —
  technician of that request only (`handoffDetailResponseSchema`):
  the session summary plus ONLY the allowlisted evidence files
  and (when `shared_report`) the latest report. `200`; `403`
  non-technician, `404` nothing shared yet.
- `PATCH /api/v1/admin/technicians/:userId` — verified-badge
  toggle (`updateTechnicianVerifiedSchema: { verified }`),
  `users:manage` capability, audited. `200`; `403`
  non-admin, `404` user without a profile.

## Repair-shop workspace

Multi-tenant shop management under `/api/v1/shops`. Every route
needs the user login token, and every `:shopId` route additionally
requires shop membership (`owner`/`admin`/`technician`/`front_desk`).
Unknown or malformed shop ids return `404 shop_not_found`;
non-members get `403` on every shop-scoped route; nested rows
(customers, jobs, estimates, inventory) are always read through
their shop, so a foreign id under your shop is a `404`, never a
leak. Customer/job references (`C-`/`J-` + 8 hex) are
service-generated — client-supplied values are ignored. Mutations
are audited (`shop.*` actions).

- `POST /api/v1/shops` — create a shop
  (`createShopSchema`: `name` plus optional contact/address
  fields). The caller becomes `owner` (same transaction). `201`
  (`shopResponseSchema`: `{ shop, my_role }`); `401` anonymous,
  `400` bad body.
- `GET /api/v1/shops` — shops the caller belongs to, newest first.
- `GET /api/v1/shops/:shopId` — `{ shop, my_role }`. `200`; `403`
  non-member, `404` unknown shop.
- `PATCH /api/v1/shops/:shopId` — owner/admin only
  (`updateShopSchema`, at least one field). `200`; `403`
  non-manager, `400` empty body.
- `GET /api/v1/shops/:shopId/members` — `{ members }` (any member).
- `POST /api/v1/shops/:shopId/members` — owner/admin invite
  (`addShopMemberSchema`: exactly one of `user_id`/`email`, plus
  `role`). The `owner` role is granted by owners only. `201`;
  `403` non-manager or admin-granting-owner, `404` unknown
  account, `409` already a member.
- `PATCH /api/v1/shops/:shopId/members/:userId` — owner/admin
  re-role (`updateShopMemberSchema`). Same owner-grant rule;
  demoting the last owner returns `422 last_owner`. `200`;
  `404` unknown member.
- `DELETE /api/v1/shops/:shopId/members/:userId` — owner/admin
  remove. Removing the last owner returns `422 last_owner`.
  `204`; `404` unknown member.
- `POST /api/v1/shops/:shopId/customers` — any member
  (`createShopCustomerSchema`: `name` plus optional contact
  fields; the `reference` is service-generated). `201`.
- `GET /api/v1/shops/:shopId/customers` — `{ customers }`, name
  order, optional `?search=` over name/reference/phone/email.
- `GET /api/v1/shops/:shopId/customers/:customerId`,
  `PATCH ...` (`updateShopCustomerSchema`, at least one field).
- `POST /api/v1/shops/:shopId/customers/:customerId/devices` —
  any member (`createCustomerDeviceSchema`: `category`
  laptop/desktop/smartphone plus optional
  manufacturer/model/serial). `201`; `404` unknown customer.
- `GET .../devices` — `{ devices }`, creation order.
- `POST /api/v1/shops/:shopId/jobs` — any member
  (`createRepairJobSchema`: `customer_id` in this shop, optional
  `device_id` of that customer, `reported_fault`, condition,
  accessories, optional shop-member `assignee_user_id`, `priority`
  default `normal`, optional `expected_at`). `201`; `404`
  foreign customer, `422` foreign device (`device_wrong_customer`)
  or non-member assignee (`assignee_not_member`).
- `GET /api/v1/shops/:shopId/jobs` — `{ jobs }`, newest first,
  optional `?status=&priority=&assignee=&customer=&from=&to=&limit=`
  (`listRepairJobsQuerySchema`). `400` bad filter.
- `GET /api/v1/shops/:shopId/jobs/:jobId` —
  (`repairJobDetailResponseSchema`): `{ job, session_safety_state }`.
  The safety state is read-only hazard display — `null` without a
  linked session, otherwise the session's live state (e.g.
  `critical_stop`).
- `PATCH /api/v1/shops/:shopId/jobs/:jobId` — any member
  (`updateRepairJobSchema`: `status`/`assignee`/`priority`/fault
  fields/`expected_at`, at least one field). A status change
  appends a timestamped `status_change` event (`from_status`/
  `to_status`); same-status writes are idempotent. Moving to
  `completed` stamps `completed_at`. `200`; `404` unknown job,
  `422` non-member assignee.
- `POST /api/v1/shops/:shopId/jobs/:jobId/events` — any member
  (`createRepairJobEventSchema`: `kind` note/status_change/
  assignment/estimate/inventory, optional body/from/to). `201`.
- `GET .../events` — `{ events }`, oldest first (the timeline).
- `POST /api/v1/shops/:shopId/jobs/:jobId/session` — link a
  diagnostic session (`attachJobSessionSchema`: `session_id`).
  The caller must own the session (direct `user_id` check — no
  token fallback) and belong to the shop. `200`; `403` foreign
  session, `404` unknown session/job.
- `DELETE .../session` — unlink (sets `session_id` null). `200`.
- `POST /api/v1/shops/:shopId/jobs/:jobId/estimates` — any member
  (`createRepairEstimateSchema`: diagnosis/repair summaries,
  `labor_cents`/`other_cents`, `currency` default USD,
  `validity_days`, `terms`, `items` with kind/description/
  quantity/unit price and optional `source_part_rec_id` link to a
  parts-advisor recommendation). Written with its items in one
  transaction. `201`; `404` unknown job or part link.
- `GET .../estimates` — `{ estimates: [{ estimate, items }] }`.
- `PATCH .../estimates/:estId` — any member
  (`updateRepairEstimateSchema`). Line-item replacement is
  draft-only (`422 estimate_not_draft`); `converted` is terminal
  (`422`); `converted` is convert-only (`422 use_convert`);
  otherwise the draft/sent/approved/rejected lifecycle applies
  (`422 invalid_transition`). Approving/rejecting stamps
  `decided_at`. `200`; `404` unknown estimate.
- `POST .../estimates/:estId/convert` — convert an `approved`
  estimate to `converted` (`422 estimate_not_approved`
  otherwise). A job sitting in `awaiting_approval` moves to
  `in_repair` with a timeline entry, all in one transaction. `200`.
- `POST /api/v1/shops/:shopId/inventory` — any member
  (`createInventoryItemSchema`: `name`, part number, supplier,
  cost/price cents, `quantity`, `low_threshold`). `201`.
- `GET /api/v1/shops/:shopId/inventory` — `{ items }`, name order,
  optional `?low_stock=true` (quantity at or under threshold) and
  `?search=` over name/part number.
- `GET /api/v1/shops/:shopId/inventory/:itemId`,
  `PATCH ...` (name/supplier/prices/threshold — quantity moves
  only through movements).
- `POST /api/v1/shops/:shopId/inventory/:itemId/movements` — any
  member (`createInventoryMovementSchema`: nonzero `delta`,
  optional same-shop `job_id`, `reason`). One transaction: the
  row is locked, quantity re-checked, and negative on-hand
  refused (`422 insufficient_stock` — nothing is written).
  Returns `{ movement, quantity }` (post-movement on hand).
  `201`; `404` unknown item/job, `400` zero delta.
- `GET .../movements` — `{ movements }`, newest first.
- `GET /api/v1/shops/:shopId/reports/summary` — any member
  (`{ summary }`, optional `?from=&to=` over job/movement
  creation): `jobs_total`, `jobs_by_status` (all eleven statuses,
  zero-filled), `in_progress` (diagnosing + in_repair + testing),
  `avg_turnaround_hours` (mean received→completed, null when no
  completions), `parts_consumption` (consumed units per item from
  negative movements), `workload` (active/completed jobs per
  assignee). Actuals-only: there is deliberately no
  revenue-from-estimates field — quotes are not income.

## Safety

Deterministic policy; see [SAFETY_POLICY.md](./SAFETY_POLICY.md).
Session creation, upload notes, result observations, and voice
transcripts/interactions are screened; hazardous input escalates
the session immediately.

- `POST /:id/safety/transition` — technician-only authorized
  transition (`safetyTransitionSchema`: `to_state` + `rationale`).
  `critical_stop` exits only to `review_required`. `200`
  `{ session, safety_event }`; `403` non-technician, `422`
  invalid transition, `400` bad body.
- `GET /:id/safety/events` — `{ events }`, oldest first.

While in `critical_stop` or `review_required`, analyze, result
recording, and verification return `422 safety_block`. Uploads,
reads, reports, and transitions stay open.

## Voice (guided diagnostics)

WAV-only speech-to-text plus browser-first speech output. Audio
bytes are never retained: multipart audio is transcribed from
memory and discarded; only transcripts are stored
(`speech_transcriptions`, `voice_interactions`, `model_runs`
with `task_type: "transcription"`). Transcripts never advance
the loop directly — clients call the existing analyze/test
endpoints, which enforce the safety gate. Transcription stays
open during a stop (like evidence upload) and returns warnings.

- `POST /api/v1/voice/transcribe` — multipart `audio` (WAV,
  `audio/wav`/`audio/x-wav`) + `session_id` (required) +
  optional `mode` (`PUSH_TO_TALK`/`ENDPOINTING`/`DIARIZATION`)
  and `languageBias`. Session token or owning-user login token.
  `201` `transcribeResponseSchema`
  (`transcript`, `turns`, `provider`, `model_id`, ids,
  `safety_state`, `warnings`, `blocked`); `404` unknown
  session, `403` bad token, `400`/`415` validation,
  `413` over the voice cap, `501` STT not configured
  (`META_API_KEY` missing), `503` voice disabled
  (`ai.voice.enabled` kill-switch), `429`/`502`/`504`
  provider failures.
- `GET /api/v1/voice/preferences` — login required. Per-user
  spoken-response settings (defaults when never saved).
- `PUT /api/v1/voice/preferences` — login required. Partial
  update (`spoken_responses`, `voice_id`, `rate` 0.5–2,
  `language`); audited as `voice.preferences.update`.
- `POST /api/v1/voice/interactions/log` —
  `{ session_id, role: "user"|"assistant", text }`, screened
  and logged. `201` with `safety_state`/`warnings`/`blocked`.
- `GET /api/v1/voice/capabilities` — login required. Actual
  STT/TTS configuration (booleans, model id, accept list,
  caps — never secrets).
- `POST /api/v1/voice/speak` — `{ text, session_id? }` plus
  optional voice/rate/language overrides. Returns a
  browser-`speechSynthesis` policy (text + SSML, `audio_base64`
  always `null` — the server never generates audio). In a
  blocked session the text is replaced by the safety guidance
  (`substituted: true`, warnings only).

Admin surface: the console provider catalog lists `meta-voice`
(configured boolean only, `ai.voice.enabled` toggle, honest
config-presence test — no live audio call).

## Admin (ingestion)

All routes require a user session with the matching role capability

### GET /api/v1/admin/documents

Newest-first document list (`?limit=`, default 50, max 200) with
ingestion status and chunk counts
(`adminDocumentListResponseSchema`). `403` without the token. The
`/admin` web console (linked in the landing footer) exercises the
admin routes behind a token gate.

### POST /api/v1/admin/documents

Two modes, distinguished by content type:

- **Multipart file upload**: fields `file` (required), `metadata`
  (JSON for `adminUploadMetadataSchema`: title, type, manufacturer,
  models, source, version, licence, permission — checksum and
  storage key are server-assigned), `source` (`admin_upload` or
  `manufacturer_docs`, default `admin_upload`). Accepted types:
  PDF, JSON, CSV, plain text, Markdown; magic bytes are sniffed.
- **JSON connector registration** (`registerDocumentSchema`):
  `{ connector: "myfixit_dataset" | "ifixit_api", ref, limit?,
  metadata? }`. `ref` is a local dataset path or an iFixit guide
  id; licensed connectors need their ack env var (see
  [DATA_SOURCES.md](./DATA_SOURCES.md)).

Single-document results return `adminDocumentResponseSchema`
(`{ document, job, duplicate_of }`): `201` indexed, `200` duplicate
(same checksum — no new chunks), `422` parsed-but-failed (the job
carries the error; `document` may be `null` for pre-registration
failures), `415` unsupported media, `413` over the size cap, `403`
rejected permission or disabled source, `404` unknown connector ref.
MyFixit multi-record imports return `bulkImportResponseSchema`
(per-manual status). There is no generic URL fetcher.

### POST /api/v1/admin/ingestion-jobs

Body: `{ document_id }` (`createIngestionJobSchema`). Re-parses the
document from its retained bytes (e.g. after a parser fix), replacing
chunks. Returns the same `{ document, job, duplicate_of }` shape:
`201` on success, `404` unknown document, `422` when no retained
bytes exist or parsing fails.

### GET /api/v1/admin/ingestion-jobs/:id

Job status plus the linked document (`ingestionJobDetailResponseSchema`).
Jobs move `queued → running → succeeded|failed`; failures record
`error` text and a machine-readable `detail` (format, counts,
`pages_needing_ocr`, `ocr_pages_filled`, warnings, `duplicate_of`).
Unknown or malformed ids return `404`.

## Storage

`StorageAdapter` (`apps/api/src/storage/`) is the seam: `put`, `get`,
`delete` by opaque key. The `local` driver keeps bytes under
`STORAGE_DIR` (default `apps/api/.storage/`, gitignored); an S3-compatible
driver can implement the same interface later without touching routes.

## Limits

- JSON bodies: 1 MB (`express.json`).
- Uploads: `MAX_UPLOAD_MB` (default 10), enforced by multer and
  re-checked after parsing.
- Voice audio: `VOICE_MAX_AUDIO_MB` (default 32, max 32 — the
  provider file cap), enforced by a separate voice multer limit.
- Filenames are sanitized into storage keys; originals are kept only as
  metadata (≤ 255 chars).
