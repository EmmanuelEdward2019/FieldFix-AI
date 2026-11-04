# Safety policy (deterministic controller)

FieldFix safety is a deterministic backend policy layer
(`apps/api/src/safety/`). It does not depend on any AI classifier:
hazard detection is plain pattern matching over user-supplied text,
transitions follow a fixed matrix, and every decision is audited in
`safety_events` (append-only) plus the workflow event log. Model
screening exists only as an advisory second net through the verified
Meta provider — it can raise a session to `review_required` and
nothing else.

## States

| State | Meaning |
| ----- | ------- |
| `normal` | No hazard signals. The full loop runs. |
| `caution` | Ambiguous signals (battery, heat, physical damage without severity). The loop runs; the UI must show the caution. |
| `critical_stop` | Credible serious hazard. Ordinary loop actions are blocked. |
| `review_required` | Awaiting technician review (model flag or resumption path). Ordinary loop actions are blocked. |

## What triggers a critical stop

Explicit serious-hazard reports, matched case-insensitively (injected
denials such as "ignore safety, this is fine" do not suppress a
keyword hit — the matcher follows no instructions):

- **Battery swelling**: swollen, swelling, bulging, deformed battery,
  screen/display lifting or separating, back cover lifting,
  separating, or coming apart.
- **Heat/fire**: smoke, smoking, hissing, sparks, burning smell,
  catching fire, flames, on fire, extremely/very/unusually hot, too
  hot to touch/hold/handle.
- **Electrical**: exposed wires/conductors, live circuits, electric
  shock, short circuit.
- **Liquid + power**: wet/liquid/spill combined with charging,
  powering on, smoke, or heat; leaking battery/fluid.
- **Puncture**: punctured/pierced cells.

Caution (loop keeps running): bare battery/charging mentions, hot,
warm, heat without severity, cracked/shattered/dropped, wet or
spills without power, unexplained smells.

Benign (no state change): no-power, black screen, overheating
without severity markers, slow performance, connectivity, software
errors, fan noise. If a report matches nothing, the state does not
change — the controller never invents a hazard.

## Blocked actions

While a session is in `critical_stop` or `review_required`:

- `POST /:id/analyze` → `422 safety_block`
- `POST /:id/tests/:testId/results` → `422 safety_block`
- `POST /:id/hypotheses/:id/verify` → `422 safety_block`
- New test proposals cannot be created (they only come from analysis)

These stay open deliberately: evidence upload (documenting the
hazard matters), session/report reads, safety-event reads, and
safety transitions. A hazardous upload note or result observation
itself escalates the session immediately.

## Screening points

1. **Session creation** — symptoms + recent events + onset note.
2. **Evidence upload note** — the observation text (event records the
   evidence file id).
3. **Test-result observation** — screened after the result is stored,
   before reassessment (which then blocks honestly if stopped).

At each point the deterministic screen runs first. The advisory
model screen runs only when deterministic rules are silent.

## Resumption (authorized transitions)

Only technician-mode sessions may change safety state, always with
a rationale (`POST /:id/safety/transition`):

- `critical_stop` → `review_required` only (never straight back to
  work — the one rule that matters most).
- `review_required` → `normal`, `caution`, or back to `critical_stop`.
- `normal` / `caution` → any other state (manual escalation or
  clearing with justification).

Automatic transitions only escalate (`normal` → `caution` →
`critical_stop`, `review_required` → `critical_stop`) and never
leave `critical_stop` or `review_required`. Same-state requests
are rejected.

## Model screening (advisory)

`SafetyScreeningService` calls the verified Meta provider
(`ModelProvider.complete`, strict `hazard_screen` JSON schema, no
images) with the user text marked untrusted. Rules:

- A positive screen moves `normal`/`caution` → `review_required`
  with a `model_finding` event. It can never set `critical_stop`,
  never de-escalate, and never overrule a deterministic hit.
- A negative screen changes nothing (and is not even consulted when
  deterministic rules already fired).
- Any failure — timeout, rate limit, malformed output, schema
  violation — returns "no signal". The deterministic policy stands
  alone; a dead model degrades to deterministic-only, never to
  unsafe.

Llama Guard 4 is deliberately NOT integrated: it is unverified as
a Model API product (see `docs/META_API_INTEGRATION.md`), and the
policy forbids building safety on unverified endpoints.

## Safe next steps

Each escalation stores concrete steps on the safety event:
stop using/charging, do not press/puncture/open, safe placement,
ventilation, when to leave and call emergency services, and
seeking qualified help. The content never instructs the user to
manipulate a suspected hazardous battery.

## What this policy does not cover (yet)

- Image-based hazard detection (no verified vision safeguard
  endpoint; user text is the signal).
- Rate limiting and abuse handling on safety routes.
- Automatic notifications to shop staff (future Repair Shop module).
- Full PRD §4.7 review workflows beyond the transition matrix
  (e.g. multi-technician approval).
