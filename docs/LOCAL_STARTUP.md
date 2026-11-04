# Local startup

Run the FieldFix AI scaffold (web + API) on your own machine.

## Prerequisites

- Node.js `>= 20.19` (check with `node --version`)
- npm `>= 10` (check with `npm --version`)
- PostgreSQL 16 running locally with `fieldfix_dev` and `fieldfix_test`
  databases (see [DATABASE.md](./DATABASE.md))
- Ports `3000` (web) and `3001` (API) free

No object storage or Meta API credentials are needed yet. Those arrive
with later phases and will be documented here.

## 1. Install

From the repository root:

```sh
npm install
```

## 2. Configure (optional for now)

Both apps run with safe defaults and no `.env` file. To override:

```sh
cp apps/api/.env.example apps/api/.env        # PORT, CORS_ORIGIN, API_VERSION
cp apps/web/.env.example apps/web/.env.local  # NEXT_PUBLIC_API_URL
```

The API validates its environment at startup with zod and exits with a
readable message if a value is invalid. The web app reads
`NEXT_PUBLIC_API_URL` (default `http://localhost:3001`).

## 2b. Migrate and seed the database

```sh
npm run db:migrate -w @fieldfix/api
npm run db:seed -w @fieldfix/api       # fictional demo scenarios, idempotent
```

`DATABASE_URL` / `DATABASE_URL_TEST` come from `apps/api/.env` (see
`.env.example`). Details, migration instructions, and troubleshooting:
[DATABASE.md](./DATABASE.md).

## 3. Run

Both servers together (recommended):

```sh
npm run dev
```

Or separately, in two terminals:

```sh
npm run dev:api
npm run dev:web
```

## 4. Verify

- Open [http://localhost:3000](http://localhost:3000) in a browser.
  The page shows **API connected** when the backend is reachable.
- Check the API directly:

```sh
curl http://localhost:3001/health
```

Expected shape (see `packages/contracts`):

```json
{
  "status": "ok",
  "service": "fieldfix-api",
  "version": "0.1.0",
  "uptimeSeconds": 12.34,
  "timestamp": "2026-10-30T00:00:00.000Z"
}
```

## Checks

| Command             | What it runs                              |
| ------------------- | ----------------------------------------- |
| `npm run typecheck` | `tsc --noEmit` in every workspace         |
| `npm run lint`      | ESLint over the whole repo                |
| `npm run test`      | Test suites in every workspace            |
| `npm run build`     | Production builds (contracts, API, web)   |

Run all four before opening a pull request.

For a real-browser pass (headless Chrome via `playwright-core`):

```sh
npm run test:browser -w @fieldfix/web
```

It boots production servers itself when `:3000`/`:3001` are free
(reusing yours otherwise), walks the landing page and the full
guest demo flow, checks auth/admin gates, the theme toggle, and
mobile overflow, fails on any console/page error, and leaves
screenshots in `apps/web/test-results/browser/`. Needs a Chrome or
Chromium binary (`CHROME_PATH` overrides the default search).

## Troubleshooting

- **Port already in use** (`EADDRINUSE`): stop the other process, or set
  `PORT=3002` in `apps/api/.env` and point `NEXT_PUBLIC_API_URL` at it.
- **Web shows “API unreachable”**: the API is not running or
  `NEXT_PUBLIC_API_URL` is wrong. Start `npm run dev:api` and reload.
- **`@fieldfix/contracts` not found**: the contracts package builds
  automatically via `predev`/`prebuild`/`pretest` hooks. If you deleted
  `packages/contracts/dist`, run `npm run build -w @fieldfix/contracts`.
- **Database errors** (`DATABASE_URL` unset, connection refused, missing
  role/database): see the troubleshooting section in
  [DATABASE.md](./DATABASE.md).
- **`next-env.d.ts` type errors on first checkout**: run `npm run dev:web`
  once; Next.js generates that file automatically.
