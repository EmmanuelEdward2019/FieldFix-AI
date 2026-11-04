# Meta Model API integration

Status: adapter implemented against officially documented behavior. No live
API calls have been made from this repo — there is no account access yet.

All "verified" claims below come from the official Meta Model API docs at
https://dev.meta.ai/docs (fetched 2026-10-30). Anything else is marked
explicitly as unverified.

## Verified: platform

- Base URL: `https://api.meta.ai/v1` (OpenAI-SDK compatible).
- Auth: `Authorization: Bearer MODEL_API_KEY`; key from the team
  dashboard, passed via the `MODEL_API_KEY` env var. Never logged.
- Recommended protocol: Responses API, `POST /v1/responses`.
  FieldFix uses it exclusively (no Chat Completions / Messages code).
- Multi-turn: `previous_response_id` chains with server-managed state;
  FieldFix instead rebuilds full context per call (manual context) and
  sets `store: false` so diagnostic data is not persisted server-side.
- `output_text` is an SDK-only helper. Over raw HTTP the client must
  walk `output[]` → message items → `output_text` parts. The adapter
  does this.
- Refusals arrive as `refusal` content parts; incomplete responses carry
  `incomplete_details`. Both are treated as failures, never as findings.

## Verified: models (from /docs/models)

| Model ID | Notes for FieldFix |
|---|---|
| `muse-spark-1.3` | Recommended flagship; text+image in, reasoning. Default `META_MODEL_ID`. 1M context. |
| `muse-spark-1.2`, `muse-spark-1.1` | Older majors, same API shape. Selectable via config. |
| `muse-spark-1.3-contributor`, `muse-spark-1.2-contributor` | Lower rate limits (150 RPM). |
| `muse-wonder-1.0` | Fast/cheap; same API shape. Selectable via config. |
| `sam-3.1` | Image segmentation (component localization). Default `SAM_MODEL_ID`. See "Verified: SAM 3.1 segmentation" below. |
| `muse-image-1.0`, `muse-voice-transcribe-1.0` | Out of scope for this phase. |

Per-model availability for our account is unverified (no key yet).
The adapter never substitutes another model: an unknown/unavailable
configured model fails the call with `not_found`.

## Verified: multimodal inputs

- Images: URL or base64 data URI in `input_image` parts, `detail`
  auto/low/high; formats jpg/jpeg/png/webp/gif; ≥32px per side, long
  edge ≤32,768px, ≤50MB per URL fetch, ≤100 images/request.
  FieldFix submits evidence photos as base64 data URIs (`detail:
  "auto"`), capped by `META_MAX_IMAGES_PER_REQUEST` (8) and
  `META_MAX_IMAGE_BYTES` (10MB) — FieldFix-side guards, stricter than
  the documented limits.
- Video: Muse Spark reads mp4 directly (Files API upload with
  `purpose: "user_data"`, then `input_file` by `file_id`; embedded
  audio is read too). No frame extraction needed. Implemented in a
  later phase — it needs the Files multipart upload plus a retention
  decision, so the adapter currently sends images + text only and
  reports video evidence as `unsupported_modality` (skipped, logged).
- Reasoning effort enum: none/minimal/low/medium/high/xhigh/max.
  Default `medium` via `META_REASONING_EFFORT`.

## Verified: structured output

- Responses parameter is `text.format` with `type: "json_schema"`.
  Decoding is schema-constrained, not post-processing.
- Strict-subset rules (enforced when `strict: true`, which FieldFix
  sets): root is a plain object; every object sets
  `additionalProperties: false`; every `required` lists all keys; no
  `oneOf`/`allOf`; no recursive `$ref`s. The FieldFix assessment
  schema complies; a unit test asserts these properties.
- Schema limits (depth 10, 5,000 properties, …) are far above our
  schema. Zod validates every response again client-side regardless.

## Verified: errors and retries

- Failure envelope: `{error: {message, type, param, code}}`. `type` is
  one of `invalid_request_error`, `authentication_error`,
  `rate_limit_error`, `server_error`. `code` is often null — the
  adapter branches on status + type + code, in that order.
- Unknown paths return 404 with an **empty body** (no envelope).
- 429 means team RPM/TPM exceeded (`muse-spark-1.3`: 3,000 RPM /
  4,000,000 TPM). Responses carry `Retry-After`, honored by the
  adapter. Rate-limit headers (`x-ratelimit-*`) exist on success.
- Retry only 429/500/503 (plus own-timeout/connection failure):
  exponential backoff with jitter, 2^attempt + random(0–1)s per docs,
  max attempts configurable (`META_MAX_RETRIES`, default 3 retries).
  Never retry 400/401/402/403/404/413.
- 500 explicitly includes "model output parsing failure — safe to
  retry".

## Verified: response fields used

`id`, `object: "response"`, `status` (completed/failed/incomplete/…),
`model`, `output[]`, `usage` (input/output token counts), `created_at`.
`output_text` concatenation is reimplemented (SDK-only upstream).

## Verified: SAM 3.1 segmentation

From the official SAM docs at https://dev.meta.ai/docs/sam (fetched
2026-10-31). Image segmentation only — FieldFix evidence is stills, so
video tracking is out of scope.

- Same platform: `POST https://api.meta.ai/v1/responses`, Bearer auth,
  `store: false`.
- Model ID `sam-3.1` (configurable via `SAM_MODEL_ID`).
- Streaming SSE is required (`stream: true`); the adapter rejects
  non-SSE responses. Text arrives in `output_text` parts of the
  streamed events.
- One concept prompt per request (e.g. "battery"); FieldFix issues one
  call per concept (max 8 per segmentation request).
- Geometry arrives as token-grammar text: records start with the
  `<0f>` lane marker, each record carrying `<|box;…|>` and/or
  `<|mask;…|>` spans. Request sets
  `metadata: { mask_encoding: "one_bit" }`.
- Mask wire payload: `data=H,W,payload` with H/W in source pixels;
  boxes are half-open source-pixel bounds.
- The adapter parses with the official `@meta-sam/parser` package
  (v0.1.0, pinned) and adds FieldFix-side guards on top: wire w/h echo
  must match the submitted image, boxes must be in-range half-open,
  mask rasters are capped (4096px per side, ~16M px total —
  FieldFix-chosen, not provider-documented), records must decode, and
  unpaired box/mask spans are rejected.
- Labels come from the request prompts only — never from model text —
  so segmentation stays localization, never fault diagnosis.

## Unverified — do not build on these

- Which models our team/account can actually call (needs `MODEL_API_KEY`
  + a live call; there is no verified list-models endpoint to probe —
  do not invent one).
- Llama Guard 4 as an API product (mentioned in the PRD; no Model API
  docs found — no integration written).
- SAM 3.1 live behavior for our account (docs verified; no live call
  made yet — needs `META_API_KEY`). Mask raster caps above are
  FieldFix-chosen guards, not provider-documented limits.
- Exact TPM/RPM for our team (docs give per-model defaults; headers
  are read at runtime).
- Tokenizer/token estimation behavior (we cap inputs by bytes/chars,
  never by estimated tokens).
- Zero-data-retention terms (hence `store: false` + no sensitive
  duplication in `model_runs`).
- Nullable union types (`["string", "null"]`) in strict-mode schemas:
  assumed from the OpenAI-compatible subset; confirm on the first live
  call (a rejection there is a loud, safe HTTP 400).

## Implementation decisions

- One provider interface (`ModelProvider`) + registry; `MetaModelAdapter`
  is the only implementation. New providers plug in without touching
  the reasoning service.
- The diagnostic response contract (`diagnosticAssessmentSchema`)
  deliberately has no "verified" flag: verification lives only in
  FieldFix data (`test_results`, technician review). Validator rejects
  citations to documents not supplied and empty assessments.
- Model runs persist to `model_runs` (migration 006 adds stage,
  modalities, validation status, provider response id). Rows store
  metadata only — no prompts, images, or keys.
- Iterative workflow: each call rebuilds context from DB state
  (session, evidence, observations, hypotheses, tests + results,
  safety). History is append-only; assessments are returned, never
  auto-written over stored hypotheses.
- Timeouts: configurable per-request (`META_REQUEST_TIMEOUT_MS`,
  default 60s). Failures return `{ok: false}` with a safe category —
  the workflow stays recoverable.
- Segmentation mirrors the same shape: `SegmentationProvider`
  interface + `SamSegmentationAdapter` (auth, timeout, retry, SSE
  parsing, validation) + `SegmentationService` (device vocabularies,
  all-or-nothing persistence of box+mask annotations with image dims,
  per-concept `segmentation` run rows). Responses validate against the
  shared contract schemas; the frontend renders them as an SVG overlay
  over the untouched original photo.

## Owner configuration checklist (go-live)

1. Create a team key at the Meta dashboard; set `META_API_KEY`
   (secret manager in production; never in the repo or frontend).
2. Confirm `META_MODEL_ID` (default `muse-spark-1.3`) is enabled for
   the team with a minimal manual call first:
   `curl https://api.meta.ai/v1/responses -H "Authorization: Bearer $MODEL_API_KEY" -d '{"model":"muse-spark-1.3","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"Reply with: ok"}]}],"max_output_tokens":16,"store":false}'`
3. Confirm `SAM_MODEL_ID` (default `sam-3.1`) the same way before
   enabling "Locate components" for real photos (segmentation degrades
   honestly to `provider_failed`/`segmentation_unavailable` until then).
4. Review `META_MAX_OUTPUT_TOKENS`, timeout, and retry env values for
   production traffic.
5. Decide the video-evidence policy (direct mp4 upload vs. exclusion)
   before enabling video modalities.
6. Revisit `store: false` only after confirming retention terms.
