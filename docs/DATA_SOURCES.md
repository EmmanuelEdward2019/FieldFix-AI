# Data sources (ingestion permissions)

FieldFix ingests technical documents only from explicitly permitted
sources (PRD §5.1, masterprompt §7). There is no generic URL fetcher,
no web crawler, and no bulk-download path. An unknown source id is
refused with `source_not_permitted`; licensed connectors additionally
refuse to run until the operator records an exact licence
acknowledgement in the environment (see each source below).

Rule of thumb: **indexing is not serving**. Ingested documents start
at `permission_status = pending` (connector imports) or whatever the
admin declares (uploads). Retrieval (`POST /api/v1/knowledge/search`)
only ever returns chunks from `approved` + `indexed` documents.

## 1. Admin file upload (`admin_upload`)

- **Transport:** `POST /api/v1/admin/documents` (multipart `file` +
  `metadata` JSON), admin bearer token required.
- **Formats:** PDF (text layer), JSON (generic `{ sections[] }` or
  MyFixit-shaped records), CSV (header row with a content column),
  plain text / Markdown. Media allowlist + magic-byte sniffing;
  anything else is `415`.
- **Licence:** per-file, declared by the uploading admin in
  `metadata.licence_name`. The admin asserts authority to import each
  file. No acknowledgement env var — the declaration is the record.
- **Retention:** bytes stay in private object storage under
  `documents/<uuid>/<name>.<ext>`; the extension is server-assigned
  from the detected kind so re-ingestion recovers the right parser.

## 2. Manufacturer documentation (`manufacturer_docs`)

- **Transport:** same admin upload endpoint with `"source":
  "manufacturer_docs"`, for official troubleshooting pages, safety
  notices, service manuals, and manuals whose terms permit import.
- **Licence:** per-document, declared at upload. Retain `source_url`,
  `version`, and permission metadata; keep `permission_status` at
  `pending` until reviewed.
- **No manufacturer-specific fetcher exists yet.** Each approved site
  or API gets its own connector only after its terms are documented
  here.

## 3. MyFixit Dataset (`myfixit_dataset`, local checkout only)

- **Upstream:** https://github.com/rub-ksv/MyFixit-Dataset — 31,601
  iFixit-derived repair manuals in 15 category files under `jsons/`
  (`Phone.json`, `Mac.json`, `PC.json`, …), plus `tmp.json` sample.
  Verified October 2026: category files are **newline-delimited
  JSON** (one manual per line); records carry `Title`, `Ancestors`,
  `Guidid`, `Category`, `Subject`, `Url`, and `Steps[]` with `Order`,
  `Lines[].Text`, `Text_raw`, `StepId`, and (Mac Laptop)
  `Word_level_parts_clean` part annotations.
- **Licence:** `CC BY-NC-SA 3.0` (LICENSE file in the repo):
  non-commercial, share-alike, attribution required. Content is
  iFixit-derived, so iFixit's no-LLM-training term applies in spirit:
  **never train models on this content**.
- **Connector:** `POST /api/v1/admin/documents` with
  `{ "connector": "myfixit_dataset", "ref": "<local path>", "limit" }`.
  Reads a **local checkout only** — the server never clones or
  downloads the dataset. Each manual becomes one document
  (`permission_status = pending`, `licence_name = CC BY-NC-SA 3.0`,
  `source_url` = manual URL, `version = guide-<Guidid>`); steps
  become chunks with step order, part tags, and category
  applicability. Default 25 manuals per call, max 500.
- **Enablement:** `MYFIXIT_LICENCE_ACK=CC-BY-NC-SA-3.0` after the
  operator has reviewed the LICENSE file. Without it the connector
  returns `403 source_disabled`.

## 4. iFixit API (`ifixit_api`, explicit guides only)

- **Upstream:** official API at `https://www.ifixit.com/api/2.0`
  (verified against the published OpenAPI spec, October 2026).
  `GET /guides/{guideid}` is public (no auth) and returns the guide
  with `title`, `subject`, `category`, `url`, `revisionid`, and
  `steps[]` (`orderby`, `title`, `lines[].text_raw`).
- **Licence:** `CC BY-NC-SA 3.0`, non-commercial. Commercial use
  requires contacting the iFixit API team, and **training large
  language models on iFixit content is prohibited** by their terms.
  FieldFix uses guides for retrieval + display only.
- **Connector:** `POST /api/v1/admin/documents` with
  `{ "connector": "ifixit_api", "ref": "<guide id>" }`. Fetches
  **one explicitly listed guide per call** — no search, no category
  walk, no catalogue crawl. Steps become chunks; `source_url` and
  `guide-<id>-rev-<n>` are retained.
- **Enablement:** `IFIXIT_INGEST_ACK=CC-BY-NC-SA-3.0`. Without it the
  connector returns `403 source_disabled`. Base URL is configurable
  via `IFIXIT_API_BASE_URL` (tests point it at a mock).

## 5. Tim's Laptop Service Manuals (not connected)

http://tim.id.au/blog/tims-laptop-service-manuals/ is a PRD-listed
*candidate*. Page structure, access rules, file availability, and
content rights have not been validated, so **no connector exists**.
Per PRD §5.1.4 it stays an optional, explicitly-enabled connector or
it stays out. Relevant files may still arrive via admin upload with
declared permission metadata.

## 6. Manuals.plus and other manual libraries (links only)

Manuals.plus states third-party manuals remain subject to their
owners' rights; access does not grant redistribution permission.
**No scraper, no bulk download.** Use outbound links or an approved
retrieval method per document, with permission recorded at upload.
Mobile Manuals / ManualsOnline and any other library each need their
own documented permissions, limits, and failure behaviour before a
connector is considered.

## OCR and scanned pages

OCR exists for one case only: PDF pages with no usable text layer.
The PDF parser flags pages under 30 extractable characters as
`pages_needing_ocr`; text pages are never OCR'd. The default
provider shells to system `pdftoppm` + `tesseract` and reports
unavailable when either is missing (the usual case in dev) — the
document still indexes from its text pages and the job detail lists
the skipped pages. Install both binaries on the host to enable OCR;
no code change is needed.

## Citation integrity

Every citation is validated at write time (`CitationService`): the
referenced chunk must exist, its document must be `approved` +
`indexed`, and the excerpt must be verifiably contained in the
chunk text (whitespace-normalized). Fabricated excerpts, unapproved
documents, and cross-session links are refused. Resolution returns
the live passage with document title, page, and heading, so the
reference panel always shows real passages.
