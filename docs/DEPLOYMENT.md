# Deployment

FieldFix AI is a monorepo with three deployable pieces: the Next.js
frontend (`apps/web`), the Express API (`apps/api`), and PostgreSQL
plus private object storage. There is no separate hosting platform to
adopt — any host that runs Node 22+, Postgres 15+, and a private file
volume or S3-compatible bucket works.

## Environment variables

API (`apps/api/.env.example` is the complete reference):

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `production` in prod (quiets error logging) |
| `PORT` | yes | API listen port |
| `CORS_ORIGIN` | yes | Exact frontend origin, e.g. `https://app.example.com` |
| `DATABASE_URL` | yes | Postgres connection string (secret) |
| `STORAGE_DRIVER` | yes | `local` (volume at `STORAGE_DIR`) |
| `STORAGE_DIR` | for local | Private directory, never web-served |
| `MAX_UPLOAD_MB` | no | Default 10 |
| `META_API_KEY` | for AI | Secret; AI analysis/segmentation degrade honestly without it |
| `META_MODEL_ID` / `SAM_MODEL_ID` | no | Defaults `muse-spark-1.3` / `sam-3.1` |
| `META_API_BASE_URL` | no | Default `https://api.meta.ai/v1` |
| `META_REQUEST_TIMEOUT_MS` / `META_MAX_RETRIES` | no | Defaults 60000 / 3 |
| `SUPER_ADMIN_EMAILS` | for admin bootstrap | Comma-separated owner emails auto-promoted to Super Admin on login |

Frontend (`apps/web/.env.example`):

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | yes | Public API base URL, e.g. `https://api.example.com` |

## Build, migrate, start

From a clean checkout:

```sh
npm ci
npm run build -w @fieldfix/contracts
npm run build -w @fieldfix/api
npm run build -w @fieldfix/web
DATABASE_URL=... npm run db:migrate -w @fieldfix/api   # up to 008
DATABASE_URL=... npm run start -w @fieldfix/api        # or: node apps/api/dist/index.js
npm run start -w @fieldfix/web                         # next start (needs NEXT_PUBLIC_API_URL at build time)
```

Run migrations on every deploy before starting the new version.
Never run `db:seed` against production (it is guarded).

## Health checks and monitoring

- `GET /health` → `{ status: "ok", service, version, uptimeSeconds,
  timestamp }`. Use it for load-balancer checks and uptime monitors.
- API readiness implies DB reachability: without `DATABASE_URL` the
  server stays up but `/api/*` answers 503 `database_unavailable`.
- Logs are stdout lines (listen/shutdown/migrate). Errors reaching
  clients are always the safe envelope; details log only when
  `NODE_ENV !== "production"`.

## Networking and TLS

- Terminate TLS at the host/load balancer; the app serves plain HTTP.
- Set `CORS_ORIGIN` to the exact frontend origin. The API sends
  helmet's default security headers.
- Before production, add a Content-Security-Policy to the Next
  deployment (session tokens live in `localStorage`; see
  `docs/SECURITY_REVIEW.md` risk 1).

## Storage and backup

- PostgreSQL: schedule host-level `pg_dump` (or managed backups) and
  test restores. All session state, evidence metadata, annotations,
  knowledge chunks, safety events, reports, and model-run metadata
  live here — but no binaries (`evidence_files`/`technical_documents`
  hold `storage_key` + checksum only).
- Object storage: back up the `STORAGE_DIR` volume (or bucket) on the
  same schedule as the database; a storage key without bytes serves
  404 on download, and an upload whose DB insert fails deletes its
  bytes, so the two stay consistent.
- Retention/deletion rules for sessions and evidence are still TBD
  (PRD §10) and must be set before launch.

## Verify a deployment

```sh
curl https://api.example.com/health
curl -X POST https://api.example.com/api/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{"device_type":"laptop","symptoms":"smoke test","user_mode":"everyday"}'
```

Then open the frontend, create a session, upload a photo, and confirm
the session detail loads. Without `META_API_KEY`, "Run AI analysis"
and "Locate components" must fail with clear provider errors — that
is the expected degraded behavior, not an outage.
