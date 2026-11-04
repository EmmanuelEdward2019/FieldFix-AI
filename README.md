# FieldFix AI

Evidence-driven multimodal troubleshooting for **laptops, desktop
computers, and mobile phones**. Users describe symptoms and upload
photos or videos; the platform analyses evidence with Meta's models,
proposes fault hypotheses, guides safe diagnostic tests, cites real
technical documents, enforces a deterministic safety policy, and
compiles a shareable repair report.

Around that core loop, FieldFix AI is a complete repair product:
voice-guided diagnostics, a parts advisor with live supplier feeds, a
repair-shop workspace, nearby-technician discovery with a map view,
and visual component identification.

Executable source of truth: the zod contracts in
[`packages/contracts`](./packages/contracts), validated by both ends
at runtime. Design notes live in [`docs/`](./docs).

## Problem statement

Everyday device owners and repair shops troubleshoot blind: forum
guesses, no evidence trail, no provenance, and no safety guardrails
for hazards like swollen batteries. FieldFix AI makes each step
explicit — observed evidence, AI inference, user-reported results,
and technician-verified findings stay labelled from intake to the
final report, and dangerous sessions stop before anyone gets hurt.

## Key features

- **Guided diagnostic loop** — analyze evidence, form hypotheses,
  run safe distinguishing tests, record results, reassess, report.
  Reassessments never overwrite history.
- **Multimodal AI analysis** (Muse Spark) with a strict
  structured-output contract; malformed or empty assessments are
  rejected, never stored.
- **Visual component identification** — names the device and visible
  parts with confidence levels, nominates one suspected fault area as
  a visual hypothesis, and localizes components on the photo with
  SAM 3.1 boxes and masks. Additive only: it never changes the
  diagnosis.
- **Component localization** (SAM 3.1) — per-photo region marking
  rendered as an overlay; the original evidence is untouched.
- **Voice-guided diagnostics** — speech-to-text symptom reports and
  test results, spoken instructions with playback controls, and
  step-by-step hands-free guidance inside the same session workflow.
- **Parts and tools advisor** — evidence-grounded recommendations
  with confidence levels, compatibility checks, live supplier
  listings (prices, stock, "verified … ago"), and outbound links to
  stores without price claims where no feed exists.
- **Repair shop workspace** — shops with roles and invites, customer
  directory, device intake, kanban job cards linked to diagnostic
  sessions, estimates with approval history, and transactional
  inventory.
- **Find a technician** — location-based (haversine) and manual
  city/region search over opt-in public profiles, OpenStreetMap
  result view, contact actions, service requests, and
  consent-based diagnostic handover.
- **Technical-document pipeline** — ingest PDF/JSON/CSV/Markdown and
  licensed connectors, full-text search, and citations that must
  resolve verbatim to real passages (fabrications are refused).
- **Deterministic safety controller** — hazard text escalates
  automatically; `critical_stop` blocks the loop across every mode;
  recovery needs a technician path. The AI can only raise suspicion,
  never clear.
- **Accounts, RBAC, and MFA** — email confirmation, TOTP
  two-factor, capability-based roles (technician → operator →
  admin → super-admin), audited admin console, transactional email.
- **Repair reports** — JSON snapshots plus PDF export, with
  provenance labels, citations, timeline, and safety summary.
- **Engineering workstation UI** — responsive dark dashboard with
  live API sessions alongside clearly labelled demo fixtures.

## Meta models in use

| Model | Used for |
|---|---|
| `muse-spark-1.3` | Diagnosis, safety screening, visual identification |
| `sam-3.1` | Component boxes + masks on evidence photos |
| `muse-voice-transcribe-1.0` | Speech-to-text for voice diagnostics |

All three are called live through the Meta Model API and verified
against real inference. Spoken responses use the browser's built-in
speech synthesis, not a Meta TTS model. See
[docs/META_API_INTEGRATION.md](./docs/META_API_INTEGRATION.md).

## Supported devices and faults

| Device | Fault coverage |
|---|---|
| Laptop | Power, battery/charging, display, keyboard, overheating, storage/memory/OS, network/audio |
| Desktop | Power, PSU/motherboard/GPU/RAM/cooler, storage/OS, network/audio |
| Mobile phone | Power, battery/charging, screen/touch, camera/speaker/mic/sensors, network, software, physical damage |

The engine is scenario-driven, not hard-coded per fault: the same
analyze → test → reassess loop serves every category. See
[docs/FEATURE_STATUS.md](./docs/FEATURE_STATUS.md) for the
per-feature implementation status.

## Technology stack

- **Frontend**: Next.js 15 + React 19 + Tailwind CSS + shadcn/ui
  (Radix), TypeScript, Leaflet maps, Vitest, Playwright smoke.
- **Backend**: Express + TypeScript, Kysely + PostgreSQL (48 tables
  across 21 migrations), private object storage (local driver;
  S3-compatible later), pdfkit reports, Resend email.
- **Contracts**: shared zod schemas (`packages/contracts`) used by
  both ends at runtime.
- **AI**: Meta Model API — Muse Spark (reasoning), SAM 3.1
  (segmentation), Muse Voice Transcribe (speech-to-text); see
  [docs/META_API_INTEGRATION.md](./docs/META_API_INTEGRATION.md).

## System architecture

```text
Browser (Next.js workstation + console)
    │  REST + Bearer [REDACTED] user tokens
    ▼
Express API ──┬── PostgreSQL (users, sessions, evidence metadata,
    │          │   hypotheses, tests, chunks, citations, voice,
    │          │   parts, suppliers, shops, technicians,
    │          │   identifications, safety events, reports,
    │          │   model runs, audit logs)
    │          └── Private object storage (media bytes)
    │
    ├── Meta Model API: Muse Spark (diagnosis, safety screen,
    │                          visual identification)
    ├── Meta Model API: SAM 3.1 (component segmentation)
    ├── Meta Model API: Muse Voice (transcription)
    ├── Supplier Store APIs (live parts feeds)
    └── Resend (transactional email)
```

Full diagram and component notes:
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Installation

Prerequisites: Node 22+, npm, PostgreSQL 15+ with `fieldfix_dev`
and `fieldfix_test` databases (see
[docs/DATABASE.md](./docs/DATABASE.md)).

```sh
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
# Edit both files: database URLs, ports, Meta key, email, admins.
npm run db:migrate -w @fieldfix/api
npm run db:seed -w @fieldfix/api      # fictional demo data (dev only)
npm run dev                            # API :3001 + web :3000
```

Then open [http://localhost:3000](http://localhost:3000) and check
[http://localhost:3001/health](http://localhost:3001/health).
Full instructions: [docs/LOCAL_STARTUP.md](./docs/LOCAL_STARTUP.md).

## Environment configuration

- API: `apps/api/.env.example` (complete reference — database,
  storage, CORS, Meta models, Resend, MFA, super-admin bootstrap,
  upload caps).
- Web: `apps/web/.env.example` (`NEXT_PUBLIC_API_URL` only).
- Never commit real secrets. `META_API_KEY`, `RESEND_API_KEY`, and
  `MFA_ENCRYPTION_KEY` stay server-side. Without a Meta key, AI
  actions fail with clear provider errors; everything else works.
- Admin access is role-based (user login + capabilities), bootstrapped
  via `SUPER_ADMIN_EMAILS`. There is no admin token.

## Database setup and migrations

```sh
npm run db:migrate -w @fieldfix/api       # apply pending (001–021)
npm run db:migrate:down -w @fieldfix/api  # revert one
npm run db:seed -w @fieldfix/api          # fictional demo sessions + docs
```

Schema, constraints, indexes, and seed contents:
[docs/DATABASE.md](./docs/DATABASE.md). No binaries in PostgreSQL —
files live in private object storage.

## Object storage configuration

`STORAGE_DRIVER=local` keeps bytes under `STORAGE_DIR` (default
`apps/api/.storage/`). Nothing is web-served; downloads go through
an authorized API route that checks session + file ownership.
Uploaded bytes are never committed to git.

## Meta API configuration

1. Create a team key in the Meta dashboard; set `META_API_KEY`.
2. Confirm `META_MODEL_ID` (`muse-spark-1.3`), `SAM_MODEL_ID`
   (`sam-3.1`), and `VOICE_MODEL_ID`
   (`muse-voice-transcribe-1.0`); the admin console Providers tab
   has a live connection test.
3. Live calls are verified from this repo: vision diagnosis,
   segmentation, transcription, and identification have all been
   exercised against real inference. Details in
   [docs/META_API_INTEGRATION.md](./docs/META_API_INTEGRATION.md).

## Local development commands

| Script | What it runs |
|---|---|
| `npm run dev` | API + web dev servers together |
| `npm run dev:api` / `npm run dev:web` | Either server alone |
| `npm run build` | Build contracts, API, and web |
| `npm run lint` | ESLint over the whole repo |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm run test` | Test suites in every workspace |
| `npm run test:browser -w @fieldfix/web` | Headless-Chrome smoke (8 checks) |

## Testing instructions

```sh
npm run typecheck && npm run lint && npm run build
DATABASE_URL_TEST=postgresql://127.0.0.1:5432/fieldfix_test npm test
npm run test:browser -w @fieldfix/web
```

Suites: unit + contract + HTTP integration per workspace (API 433,
web 270, contracts 136), plus `apps/api/tests/e2e/` — full laptop,
mobile, swollen-battery safety, and regression journeys against real
Postgres with scripted (mocked) model providers — plus an 8-check
Playwright smoke suite (landing, demo wizard, auth gates, theme,
forms, mobile overflow) that fails on any console or page error.

## Deployment instructions

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md): environment
reference, build/migrate/start sequence, health checks, TLS/CORS,
storage backup, and verification steps.

## API documentation reference

[docs/API.md](./docs/API.md) documents the endpoints (method, auth,
schemas, errors, DB effects) across sessions, diagnostics, voice,
parts, suppliers, shops, technicians, users, auth, knowledge, and
the admin console. The zod contracts in `packages/contracts` are
the executable source of truth.

## Future development roadmap

Video frame extraction for identification, additional supplier
feeds and CSV import, technician ratings/reviews, a server-side TTS
provider, retention/deletion rules for sessions and evidence, and
an S3-compatible storage driver. Status of each:
[docs/FEATURE_STATUS.md](./docs/FEATURE_STATUS.md).

---

Emmanuel Edward - Meta Global AI Developer Hackathon
