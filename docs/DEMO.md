# Three-minute hackathon demo

Show working functionality only. Anything scripted or mocked is
labelled as such below and must be labelled the same way on stage.

## Demo environment

```sh
npm install
npm run db:migrate -w @fieldfix/api
npm run db:seed -w @fieldfix/api
npm run dev
```

Open `http://localhost:3000` (landing page):

- **Explore the demo** (`/demo`): guest dashboard mirroring the
  signed-in dashboard — sample stats, device cards, and fictional
  jobs, no sign-in. Each job opens the restricted synthetic
  workspace (`/demo/workspace`, no API writes, every panel labelled
  demo). Safe to show first.
- **Sign in / Create account** (`/login`, `/register`): real
  accounts backed by PostgreSQL. Sessions, evidence, and reports
  are per-user; swapping ids across users returns `403`.
- **With `META_API_KEY`** (preferred): live analysis and "Locate
  components" run for real. Confirm both model IDs the day before
  (see `META_API_INTEGRATION.md` checklist).
- **Without a key**: analysis shows the honest provider error.
  Present the seeded sessions, safety flow, citations, and reports
  instead, and say plainly that AI calls need the key.

Fallback: record the full run once while everything works; if the
network or provider fails on stage, play the recording and say it is
a recording.

## Seed these three sessions the night before

1. **Laptop overheating** (everyday): symptoms "Laptop overheats and
   shuts down under load. Fan is loud." + a `vents.png` photo.
2. **Phone touch fault** (everyday): symptoms "Lower half of the
   touchscreen stopped responding after a drop." + a `screen.png`
   photo.
3. **Swollen battery** (everyday): symptoms "Back cover is lifting
   and the battery looks swollen." — creation alone must land it in
   `critical_stop`; do not "fix" it before the safety beat.

Ingest one approved manual per device family so citations resolve
(see `SAMPLE_DATA.md`).

## Script (3:00)

**0:00–0:20 · Introduction.** "FieldFix AI is an evidence-driven
troubleshooting agent for laptops, desktops, and phones. Every claim
stays labelled — observed, inferred, user-reported, or verified —
and hazards stop the session before anyone gets hurt."

**0:20–1:10 · Laptop diagnostic.** Open session 1. Show symptoms +
photo, run AI analysis (or show the seeded hypotheses and say which
mode you are in), open a hypothesis to show supporting vs
contradicting evidence, run "Vent inspection", record "clear", and
show the weakened reassessment.

**1:10–1:55 · Mobile diagnostic.** Open session 2. Same engine,
different device: touch-fault hypotheses, "Locate components" overlay
on the photo (regions, not a diagnosis), a service-manual citation
with page number, one recorded test result.

**1:55–2:25 · Safety.** Open session 3. Show the critical-stop
banner and safe next steps. Attempt "Run AI analysis" — blocked.
Attempt a normal→normal technician skip — rejected. Note the audit
event and that uploads/reports still work.

**2:25–2:50 · Report.** Open the laptop report: assessment,
user-reported results, citations, timeline. Download the PDF.

**2:50–3:00 · Closing.** "Observations stay observations, guesses
stay guesses, and only a technician verifies. That is the whole
product: evidence you can hand to a repair shop."

## Screenshots (owner step)

No headless browser is available in this environment, so capture
these manually from a running demo before the event and store them
under `docs/screenshots/`: dashboard, laptop diagnostic, mobile
diagnostic, evidence + segmentation overlay, safety warning, repair
report. Use the seeded sessions; never crop out the Demo/Live
badges.
