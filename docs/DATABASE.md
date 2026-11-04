# Database

FieldFix API persists the diagnostic process in PostgreSQL 16: sessions,
evidence metadata, hypotheses, tests and results, workflow events,
technical documents and chunks, citations, safety events, reports, and
model runs (PRD §8).

Access goes through **Kysely** (typed query builder) plus `pg`, with
**explicit versioned migrations** in `apps/api/src/db/migrations/` and
typed repositories in `apps/api/src/db/repositories/`.

## Prerequisites

- PostgreSQL 16 running locally (this repo was built against Homebrew's
  `postgresql@16`: `brew install postgresql@16 && brew services start postgresql@16`)
- Two databases:

```sh
createdb fieldfix_dev
createdb fieldfix_test
```

## Configure

```sh
cp apps/api/.env.example apps/api/.env
```

| Variable           | Used by                  | Example                                  |
| ------------------ | ------------------------ | ---------------------------------------- |
| `DATABASE_URL`     | `db:migrate`, `db:seed`  | `postgresql://127.0.0.1:5432/fieldfix_dev` |
| `DATABASE_URL_TEST`| integration tests        | `postgresql://127.0.0.1:5432/fieldfix_test` |

Both are validated at startup (`apps/api/src/env.ts`): they must be
`postgres://` / `postgresql://` URLs when set. The API server itself does
not require a database yet — only the commands below and the DB tests do.

## Commands (run from the repo root)

| Command                                            | What it does                                  |
| -------------------------------------------------- | --------------------------------------------- |
| `npm run db:migrate -w @fieldfix/api`              | Apply all pending migrations to `DATABASE_URL` |
| `npm run db:migrate:down -w @fieldfix/api`         | Revert the most recent migration (one step)    |
| `npm run db:seed -w @fieldfix/api`                 | Reset + insert demo scenarios (see below)      |

Migration status is tracked in `kysely_migration` / `kysely_migration_lock`,
so concurrent `db:migrate` runs are safe.

## Schema overview

Migrations:

| Migration                     | Contents                                              |
| ----------------------------- | ----------------------------------------------------- |
| `001_sessions_evidence`       | `diagnostic_sessions`, `evidence_files`, `evidence_observations`, `evidence_annotations`, trigger helpers |
| `002_hypotheses_tests`        | `diagnostic_hypotheses`, `hypothesis_evidence`, `diagnostic_tests`, `test_results`, `diagnostic_events` |
| `003_knowledge`               | `technical_documents`, `document_chunks` (FTS), `source_citations` |
| `004_safety_reports_runs`     | `safety_events`, `repair_reports`, `model_runs`, annotation→run FK |
| `005_append_only_cascade_fix` | Lets append-only tables participate in FK cascades    |
| `006_model_run_observability` | `model_runs` observability: stage, modality, validation, response id |
| `007_ingestion_jobs`          | `ingestion_jobs`: one row per ingest attempt (status, error, detail) |
| `008_desktop_device`          | Widens `diagnostic_sessions.device_type` to `laptop/desktop/smartphone` |
| `009_user_accounts`           | `users`, `user_sessions`; `diagnostic_sessions.user_id` |
| `010_email_verification`      | `users.email_confirmed_at`, `user_email_tokens` |
| `011_admin_platform`          | `users.role/status`, `admin_audit_logs`, `platform_settings` (seeded), `safety_incident_reviews`, `notification_records` |
| `012_user_notifications`      | `notification_records.user_id` + index |
| `013_user_mfa`                | `user_mfa`, `user_mfa_backup_codes`, `user_mfa_challenges` |
| `014_rate_limit_windows`      | `rate_limit_windows` shared fixed-window counters |
| `015_voice_guidance`          | `voice_preferences`, `voice_interactions`, `speech_transcriptions`; seeds `ai.voice.enabled` |
| `016_parts_advisor`           | `part_recommendations`, `tool_recommendations` (advisory only — no price/stock/supplier columns) |
| `017_technicians`             | `technician_profiles`, `technician_contact_requests`, `shared_diagnostic_handoffs` (directory + contact + consent-scoped handoffs; no rating columns) |
| `018_shop_workspace`          | `shops`, `shop_members`, `shop_customers`, `customer_devices`, `repair_jobs`, `repair_job_events`, `repair_estimates`, `repair_estimate_items`, `inventory_items`, `inventory_movements` (multi-tenant by shop; service-generated C-/J- references) |

Key decisions:

- **UUID primary keys** (`gen_random_uuid()`), `created_at` everywhere,
  `updated_at` with an auto-touch trigger on mutable tables.
- **TEXT + CHECK constraints instead of native enums** for status fields,
  so future states don't require enum-surgery migrations. The allowed
  values are mirrored in `packages/contracts` (`diagnostics.ts`,
  `knowledge.ts`) — change both together.
- **Foreign keys with cascading deletes** from `diagnostic_sessions` to
  all session children (evidence, hypotheses, tests, results, events,
  citations, safety events, reports, model runs). Cross-references that
  must survive use `SET NULL` (e.g. hypothesis → suggested test);
  `source_citations.chunk_id` uses the default `NO ACTION` so a cited
  passage cannot be deleted out from under a citation.
- **Append-only audit logs**: `diagnostic_events` and `safety_events`
  reject direct `UPDATE`/`DELETE` via trigger. Cascaded deletes from a
  removed parent session are allowed (detected with `pg_trigger_depth()`),
  so demo/test resets work while history stays immutable.
- **Full-text search**: `document_chunks.search_vector` is a generated
  `tsvector` column with a GIN index. `searchChunks()` only returns
  chunks from documents that are `approved` + `indexed`, with real
  excerpts (`ts_headline`) and page references. No vector extension yet,
  per PRD §8.
- **No binaries in PostgreSQL**: `evidence_files` and
  `technical_documents` store only `storage_key`, media type, size, and
  checksum. Files live in private object storage behind `StorageAdapter`
  (local driver by default). There are zero `bytea` columns; the suite
  asserts none exist.
- **Ingestion jobs are first-class**: every ingest attempt writes an
  `ingestion_jobs` row (`queued → running → succeeded|failed`) with
  the linked document, error text, chunk count, and a machine-readable
  `detail` jsonb (format, `pages_needing_ocr`, warnings,
  `duplicate_of`). Duplicates are detected by `checksum_sha256`
  (unique) and reported as successful jobs with zero new chunks.
- **Transactions**: recording a test result writes the result, marks the
  test complete, applies hypothesis updates, and appends the workflow
  event in one transaction (`recordTestResult` in `src/db/workflows.ts`).
  Safety transitions are likewise atomic (`recordSafetyTransition`).
  Any failure rolls everything back.
- **Demo data is flagged**: seeded sessions/documents carry
  `is_demo = true` and seeded model runs use `origin = 'demo'`, keeping
  demo output distinguishable from live results.

## Demo seed

`db:seed` deletes existing `is_demo` rows (sessions first so citations
release their chunks, then documents) and inserts, all fictional:

1. **Laptop, will-not-power-on** (`in_progress`): evidence metadata,
   user + model observations, a SAM-style annotation linked to its model
   run, two hypotheses, two guided tests, a recorded `led-off` result
   that supports H1 / weakens H2, a citation to manual page 42, a model
   run, and a draft report.
2. **Smartphone, suspected swollen battery** (`critical_stop`): a safety
   event (`user_report` → `critical_stop`, checklist blocked) plus a
   draft report with a safety summary.
3. **Knowledge base**: two approved + indexed fictional documents with
   five searchable chunks.

Re-running the seed is idempotent (reset + insert). It refuses to run
with `NODE_ENV=production` unless `ALLOW_DEMO_SEED=1` is set.

## Integration tests

`apps/api/tests/db/database.test.ts` runs against **real PostgreSQL**
and fails fast when `DATABASE_URL_TEST` is unset — it never skips and
never falls back to another database. It migrates to latest once, then
truncates all tables before each test. Covered: session round-trip and
cascade deletes, evidence uniqueness/CHECK constraints, the
`recordTestResult` transaction including rollback, FTS retrieval and its
approved-only filter, checksum/citation constraints, append-only
enforcement, the safety-transition workflow, and report/run tracking.

```sh
export DATABASE_URL_TEST=postgresql://127.0.0.1:5432/fieldfix_test
npm run test -w @fieldfix/api
```

## Writing a new migration

1. Create `apps/api/src/db/migrations/NNN_short_name.ts` (`NNN` = next
   number) exporting `up(db)` and `down(db)`, typed
   `(db: Kysely<Database>) => Promise<void>`.
2. Write explicit SQL via the `sql` template tag. Mirror any new status
   values in `packages/contracts` and `src/db/database.ts`.
3. Run `db:migrate`, verify, and also verify `db:migrate:down` + `up`
   round-trips cleanly.
4. Never edit a migration that has already been applied anywhere —
   write a new one (see `005` for an example).

## Troubleshooting

- **Connection refused**: is PostgreSQL running?
  (`brew services list`, look for `postgresql@16 started`).
- **Role/database does not exist**: `createdb fieldfix_dev fieldfix_test`
  (run `createdb` once per name) or create the missing role.
- **Migrations fail with "already exists"**: the database was migrated
  outside the runner. Inspect `kysely_migration`, or drop + recreate a
  scratch database and migrate cleanly.
- **Seed fails on a dirty database**: the seed only resets `is_demo`
  rows; non-demo rows with colliding unique keys (e.g. a real document
  with the same checksum) must be removed manually.
- **Tests fail with DATABASE_URL_TEST unset**: export it (see above) or
  add it to `apps/api/.env` — the test setup loads dotenv.

## Production notes

- `DATABASE_URL` is a secret: inject it via the host's secret manager,
  never commit it.
- Run `db:migrate` on every deploy before starting the new version.
  Migrations must stay backward-compatible with the previously deployed
  code until it is replaced.
- Never run `db:seed` against production data (guarded by default).
- Retention/deletion rules for sessions and evidence are still TBD and
  must be documented here before launch (PRD §10).
