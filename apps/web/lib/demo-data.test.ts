import { afterEach, describe, expect, it, vi } from "vitest";
import {
  annotationCoordinatesSchema,
  createCitationSchema,
  createDiagnosticTestSchema,
  createEvidenceFileSchema,
  createHypothesisSchema,
  createObservationSchema,
  createSafetyEventSchema,
  createSessionSchema,
  diagnosticEventSchema,
  recordTestResultSchema,
  reportDataSchema,
} from "@fieldfix/contracts";
import {
  assertDemoIntegrity,
  DEMO_SESSIONS,
  getDemoSession,
  loadDemoSessions,
} from "./demo-data";

describe("demo fixtures", () => {
  it("ships three labelled demo sessions", () => {
    expect(DEMO_SESSIONS).toHaveLength(3);
    expect(getDemoSession(DEMO_SESSIONS[0]?.id ?? "")).toBeDefined();
    expect(getDemoSession("no-such-session")).toBeUndefined();
  });

  it("passes the integrity check", () => {
    expect(() => assertDemoIntegrity(DEMO_SESSIONS)).not.toThrow();
  });

  it("fails integrity when a reference dangles", () => {
    const tampered = structuredClone(DEMO_SESSIONS);
    const session = tampered[0];
    if (session?.citations[0]) {
      session.citations[0].hypothesis_id = "00000000-0000-4000-8000-000000000000";
    }
    expect(() => assertDemoIntegrity(tampered)).toThrow(/missing hypothesis/);
  });

  it("loads asynchronously", async () => {
    const result = await loadDemoSessions();
    expect(result.sessions).toHaveLength(3);
  });
});

describe("demo/live separation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads demo sessions with no network access", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("demo must not fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await loadDemoSessions();
    expect(result.sessions).toHaveLength(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("demo fixtures validate against contracts", () => {
  const laptop = DEMO_SESSIONS[0];
  const phone = DEMO_SESSIONS[1];

  it("sessions match createSessionSchema inputs", () => {
    for (const s of [laptop, phone]) {
      expect(
        createSessionSchema.safeParse({
          device_type: s?.device_type,
          manufacturer: s?.manufacturer,
          model: s?.model,
          operating_system: s?.operating_system,
          symptoms: s?.symptoms,
          problem_started_note: s?.problem_started_note,
          recent_events: s?.recent_events,
          user_mode: s?.user_mode,
        }).success,
      ).toBe(true);
    }
  });

  it("evidence, observations, and annotations validate", () => {
    const file = laptop?.evidence[0];
    expect(
      createEvidenceFileSchema.safeParse({
        storage_key: file?.storage_key,
        media_type: file?.media_type,
        byte_size: file?.byte_size,
        original_filename: file?.original_filename,
        kind: file?.kind,
        checksum_sha256: file?.checksum_sha256,
      }).success,
    ).toBe(true);
    for (const obs of laptop?.observations ?? []) {
      expect(
        createObservationSchema.safeParse({
          evidence_file_id: obs.evidence_file_id,
          source: obs.source,
          body: obs.body,
        }).success,
      ).toBe(true);
    }
    const annotation = file?.annotations[0];
    expect(annotationCoordinatesSchema.safeParse(annotation?.coordinates).success).toBe(
      true,
    );
  });

  it("hypotheses, tests, and results validate", () => {
    for (const h of laptop?.hypotheses ?? []) {
      expect(
        createHypothesisSchema.safeParse({
          title: h.title,
          description: h.description,
          supporting_observations: h.supporting_observations,
          contradicting_observations: h.contradicting_observations,
          confidence_label: h.confidence_label,
          confidence_rationale: h.confidence_rationale,
          status: h.status,
        }).success,
      ).toBe(true);
    }
    for (const t of laptop?.tests ?? []) {
      expect(
        createDiagnosticTestSchema.safeParse({
          name: t.name,
          objective: t.objective,
          rationale: t.rationale,
          required_tools: t.required_tools,
          skill_level: t.skill_level,
          safety_classification: t.safety_classification,
          instructions: t.instructions,
          expected_outcomes: t.expected_outcomes,
          result_options: t.result_options,
          position: t.position,
        }).success,
      ).toBe(true);
      if (t.result) {
        expect(
          recordTestResultSchema.safeParse({
            selected_option: t.result.selected_option,
            observation: t.result.observation,
          }).success,
        ).toBe(true);
      }
    }
  });

  it("events, citations, safety, and report data validate", () => {
    for (const e of laptop?.events ?? []) {
      expect(
        diagnosticEventSchema.safeParse({
          event_type: e.event_type,
          payload: e.payload,
        }).success,
      ).toBe(true);
    }
    for (const c of laptop?.citations ?? []) {
      expect(
        createCitationSchema.safeParse({
          hypothesis_id: c.hypothesis_id,
          test_id: c.test_id,
          chunk_id: c.chunk_id,
          excerpt: c.excerpt,
          note: c.note,
        }).success,
      ).toBe(true);
    }
    for (const s of phone?.safety_events ?? []) {
      expect(
        createSafetyEventSchema.safeParse({
          previous_state: s.previous_state,
          new_state: s.new_state,
          trigger_type: s.trigger_type,
          trigger_detail: s.trigger_detail,
          evidence_file_id: s.evidence_file_id,
          blocked_action: s.blocked_action,
          safe_next_steps: s.safe_next_steps,
        }).success,
      ).toBe(true);
    }
    expect(reportDataSchema.safeParse(laptop?.report?.data).success).toBe(true);
  });
});
