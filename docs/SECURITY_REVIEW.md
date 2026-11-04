# Security review (Phase 10 + redesign follow-up)

Reviewed 2026-10-31 against the live codebase. Each item names the
mechanism and where it lives; residual risks are listed at the end
with severity. The redesign follow-up (same day) added user accounts
with email confirmation, an admin console, and web security headers —
covered below.

## Authentication and authorization — pass

- Session access uses 256-bit random tokens (`crypto.randomBytes`),
  stored as SHA-256 hashes, compared with `timingSafeEqual`
  (`apps/api/src/auth/session-access.ts`). Tokens travel in the
  `Authorization: Bearer` header only — never in URLs or responses
  (asserted by `sessions.test.ts`: no `access_token_hash` leak).
- Unknown/malformed session ids return 404 and bad tokens 403, so
  session existence does not leak through auth errors.
- Every session, diagnostics, segmentation, evidence-download, and
  safety route is behind `requireSessionAccess`. The evidence
  download additionally checks file ownership (`file_not_found`).
- Admin routes are behind role-based capability checks on the
  caller's user login session (`apps/api/src/auth/admin-access.ts`).
  No shared credential exists; bootstrap is `SUPER_ADMIN_EMAILS`
  auto-promotion on login, then Admin > Users role assignment.
  transitions) are enforced server-side by `user_mode` checks, not by
  hiding buttons. The UI also gates them, but the server decides.
- User accounts: scrypt-hashed passwords (`node:crypto`, per-user
  salt), 30-day login tokens (SHA-256 at rest), ownership checks on
  every session/evidence/report route — cross-user ID swaps return
  403 (`apps/api/src/auth/user-access.ts`). Registration never signs
  in: login is 403 `email_unconfirmed` until the emailed link is
  clicked. Confirmation (24h) and reset (1h) tokens are single-use,
  hashed at rest, and consumed atomically; resend/forgot endpoints
  answer uniformly to block account enumeration
  (`apps/api/src/routes/auth.ts`, `010_email_verification`).
- The `/admin` console uses the signed-in user's session; visitors
  without an admin-capable role land on a sign-in gate. There is no
  separate console credential.

## Input validation — pass

- All JSON request bodies validate with zod at the route boundary;
  failures return the `invalid_request` envelope (400), never a
  stack trace. Malformed JSON returns 400 and oversized bodies 413
  via the central error handler (`apps/api/src/app.ts`).
- UUID route params validate before any DB lookup. Uploads are
  capped by multer (`fileSize`, single file, 8 fields) and re-checked
  in `validateUpload` (presence, size, MIME allowlist, magic-byte
  sniffing, filename sanitization). Stored bytes are checksummed and
  orphaned on DB failure (upload handler deletes the object if the
  insert fails).

## Injection protection — pass

- SQL: Kysely query builder throughout; the only `sql` fragments are
  full-text-search expressions with bound parameters
  (`db/repositories/documents.ts`). No string-concatenated queries.
- XSS: exactly one `dangerouslySetInnerHTML` in the frontend — the
  static pre-paint theme script (`apps/web/app/layout.tsx`), which
  contains no user data and cannot reflect any. All session content
  renders through React escaping. The API serves JSON only, with
  helmet's default security headers. PDF export renders text via
  pdfkit (no embedded scripts).
- Web hardening (`apps/web/next.config.ts`): `poweredByHeader`
  off; `X-Frame-Options: DENY`, `nosniff`, strict referrer policy,
  empty `Permissions-Policy`, and HSTS on every route. No
  `script-src` CSP yet — it would break Next dev/HMR inline
  bootstraps (documented in the config); revisit with nonces for a
  locked-down production deployment.
- CSRF: not applicable — no cookie auth; all credentials are explicit
  `Authorization` headers, and CORS allows exactly one configured
  origin.

## Rate limiting — pass

- `apps/api/src/http/rate-limit.ts`: fixed-window counters in
  PostgreSQL (`rate_limit_windows`, migration 014), shared across
  all API processes — 300 req/min per IP on `/api/*`, 60 req/15 min
  on `/auth/*` — with the standard 429 envelope and `Retry-After`.
  In-memory store remains as the no-database fallback. Skipped when
  `NODE_ENV=test` so suites run unthrottled (both stores are
  covered by `tests/rate-limit.test.ts`, including a multi-instance
  shared-budget test).

## Secrets and logging — pass

- `META_API_KEY` and `RESEND_API_KEY` live
  server-side only (env/secrets manager). No frontend bundle, log,
  error-envelope, or `model_runs` row carries keys, login tokens,
  prompts, or image bytes; the only `NEXT_PUBLIC_*` value is the API
  base URL. Server logs hold operational lines only
  (listen/shutdown/migrate); the error handler logs details solely
  outside production and clients always get the safe envelope.
  Exception: with no `RESEND_API_KEY` the API runs in log-only mode
  and prints confirmation/reset links to its own console — intended
  for local development only.

## Untrusted content and model authority — pass

- Document excerpts are labelled untrusted in the prompt and the
  system instructions explicitly direct the model to ignore embedded
  instructions (`models/meta/request-builder.ts`). The response
  validator rejects citations to documents that were not supplied.
- The deterministic safety controller is authoritative: automatic
  escalation only moves upward; the advisory model screen can only
  raise `review_required`, never clear or de-escalate; leaving
  `critical_stop`/`review_required` requires a technician transition
  with a recorded rationale. The diagnostic loop refuses to run while
  blocked (`isLoopBlocked`), tested by bypass-attempt cases.

## Dependency vulnerabilities — known issues, mitigated

`npm audit --omit=dev` (2026-10-31): 3 findings (1 moderate, 2 high).

- `postcss <= 8.5.22` via `next` (high): CSS-phase XSS/file-read
  vectors. FieldFix accepts no user CSS, so there is no reachable
  vector; fix requires a Next major upgrade — scheduled, not forced,
  for this phase.
- `zod < 4.6.6` (high, GHSA-mrhx-c7xc-m3w5): assessed
  not-affected — the advisory targets the zod 4 `.check()` code path
  while the repo pins zod 3.25.76 (npm matches the range textually).
  Defence in depth regardless: 1 MB JSON body cap, multer limits,
  and `.max()` constraints on every validated collection.

## Residual risks

| # | Risk | Severity | Note |
|---|------|----------|------|
| 1 | Login tokens in browser `localStorage` | Medium | Standard SPA trade-off; an XSS flaw would expose tokens. One static inline script (theme), no reflective sinks; framing/MIME/referrer headers now set — add a `script-src` CSP with nonces before a locked-down production deployment. |
| 2 | PostCSS advisory unfixed (breaking major) | Medium | No reachable vector (no user CSS); upgrade the Next major on the next maintenance pass and re-audit. |
| 3 | Super Admin bootstrap email | Low | `SUPER_ADMIN_EMAILS` auto-promotes on login; keep it to owner addresses. All Super Admins must enroll TOTP (enforced) before console access. |
| 4 | Knowledge search is intentionally public | Low | By design: approved/indexed documents only. Revisit if restricted corpora are added. |
| 5 | Register returns 409 for taken emails | Low | Minor enumeration signal on signup (standard trade-off so users learn they already have an account); login/forgot/resend stay uniform. |
| 6 | TLS termination | Low | Must be enforced by the host/load balancer; the app itself serves plain HTTP. See `docs/DEPLOYMENT.md`. |
