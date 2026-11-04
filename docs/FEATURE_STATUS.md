# Feature status

Honest implementation ledger as of Phase 10. Anything not listed
under "implemented and tested" must not be presented as done.

## Implemented and tested

- Session creation/retrieval with bearer-token access control.
- Evidence upload/list/download (private storage, server validation).
- Diagnostic loop: analyze → hypotheses → tests → user-reported
  results → automatic reassessment → report (JSON + PDF).
- Knowledge ingestion (PDF/JSON/CSV/text/Markdown, licensed
  connectors), full-text search, verbatim citation attach/resolution.
- Deterministic safety controller: intake/upload screening,
  `critical_stop` loop block, technician recovery path, advisory
  model screen that can only raise review.
- Image segmentation (SAM 3.1): box+mask annotations persisted with
  image dims, SVG overlay, honest degradation without a provider.
- Desktop, laptop, and smartphone device categories end to end.
- Workstation UI: live sessions for every panel (evidence, analysis,
  hypotheses, checklist, references, safety, activity, report),
  responsive desktop/tablet/mobile layouts, loading/error/empty
  states, demo fixtures kept clearly labelled.
- User accounts (scrypt passwords, login tokens, profile, rate
  limits) with backend ownership checks on sessions, evidence, and
  reports; per-user session/report lists; restricted synthetic demo
  (`/demo`) that cannot touch the API; rate limiting, error
  envelopes, PDF export, health checks.
- TOTP two-factor auth (otplib, encrypted secrets, single-use
  backup codes, 5-minute login challenges), enforced for Super
  Admin console access; enrollment/verify/disable UI on Profile.
- PostgreSQL-backed shared rate limiting (fixed windows, one
  budget across API processes; in-memory fallback without a DB).
- Headless-browser suite (`npm run test:browser -w @fieldfix/web`):
  landing, full guest demo flow, auth/admin gates, theme toggle,
  mobile overflow — zero console errors, screenshots archived.
- Technician directory ("Contact Technicians Near Me"): public
  search (text + opt-in geo radius, no contact PII in lists)
  and public cards, login-gated contact requests with a
  side-enforced status lifecycle, consent-scoped diagnostic
  handoffs (evidence allowlist + optional report), and
  self-service profile management (`PUT`/`GET
  `/api/v1/technicians/me`, audited; the `verified` badge
  stays admin-only via `/api/v1/admin/technicians/:userId`).

## Implemented but not fully tested

- Live Meta provider calls (mocked in tests; no `META_API_KEY` has
  been used from this repo — first live call still pending).
- Multi-revision segmentation lanes (`[0]` vs `[1]` object ids).
- OOM-scale PDFs and very large knowledge corpora (unit-tested
  parsers only).

## Partially implemented

- Video evidence: contract kind exists; uploads reject video until
  frame extraction exists.
- Production hardening follow-ups: Next CSP
  headers, retention/deletion rules (see `SECURITY_REVIEW.md`).

## Demonstration-only or simulated

- Frontend demo sessions and demo knowledge docs (fictional,
  labelled `Demo` in the UI, `is_demo` in the DB).
- Scripted model providers in tests and E2E — never presented as
  live AI.

## Planned future development (not started)

- Voice-guided diagnostics.
- Parts and tools advisor.
- Repair-shop workspace.
- Parts marketplace.
- Advanced technician collaboration.
- Additional AI model providers and diagnostic capabilities.
