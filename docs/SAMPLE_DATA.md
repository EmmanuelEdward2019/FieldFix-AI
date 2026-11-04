# Sample data instructions

How to load synthetic sessions, evidence, and permitted documents
for testing and demonstrations. Everything below is fictional or
explicitly permitted — no copyrighted or restricted material.

## Demo seed (fastest path)

```sh
npm run db:migrate -w @fieldfix/api
npm run db:seed -w @fieldfix/api
```

The seed resets `is_demo` rows and inserts:

1. **Laptop, will-not-power-on** (`in_progress`) — evidence
   metadata, user + model observations, a SAM-style annotation, two
   hypotheses, two guided tests, a recorded result, a citation to
   manual page 42, a model run, and a draft report.
2. **Smartphone, suspected swollen battery** (`critical_stop`) — a
   safety event plus a draft report with a safety summary.
3. **Knowledge base** — two approved + indexed fictional documents
   with five searchable chunks.

The seed refuses to run with `NODE_ENV=production` unless
`ALLOW_DEMO_SEED=1` is set. Seeded rows carry `is_demo = true` (and
model runs use `origin = 'demo'`) so demo output never passes as
live results. Details: [DATABASE.md](./DATABASE.md#demo-seed).

## Sample evidence photos

Tests use generated PNG fixtures (`apps/api/tests/vision/png-fixture.ts`
and `tests/ingestion/fixtures/`), not real device photos. For manual
testing, upload any JPEG/PNG/WebP/GIF under `MAX_UPLOAD_MB` through
the workstation's upload control or:

```sh
curl -X POST http://localhost:3001/api/v1/sessions/<id>/evidence \
  -H "Authorization: Bearer <token>" \
  -F "file=@photo.jpg" -F "observation=Back cover lifting."
```

## Permitted technical documents

Only the sources in [DATA_SOURCES.md](./DATA_SOURCES.md) may be
ingested: admin file uploads you own or are licensed to use,
manufacturer docs, the MyFixit dataset (local checkout + licence
ack), and explicit iFixit guides (licence ack). Tim's manuals and
manuals.plus are **not** connected (links only / not permitted).

Ingest a file you are allowed to use:

```sh
curl -X POST http://localhost:3001/api/v1/admin/documents \
  -H "Authorization: Bearer $USER_SESSION_TOKEN" \
  -F "file=@manual.pdf" \
  -F "metadata={\"title\":\"...\",\"document_type\":\"service_manual\",\"permission_status\":\"approved\"}"
```

Only `approved` + `indexed` documents are searchable or citable.
Citations must quote a real passage verbatim — the attach endpoint
refuses fabricated excerpts with `422 excerpt_not_found`.

## Demo sessions for the hackathon script

`docs/DEMO.md` lists the exact sessions to create (or re-seed) before
recording: a laptop overheating case, a phone touch-fault case, and a
swollen-battery safety case, each with named evidence files.
