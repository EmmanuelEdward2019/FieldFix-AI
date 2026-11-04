import { describe, expect, it } from "vitest";
import type { SessionDetailResponse } from "@fieldfix/contracts";
import { toWorkstationSession } from "./real-session";

const SESSION = {
  id: "11111111-1111-4111-8111-111111111111",
  device_type: "laptop",
  manufacturer: "Acme",
  model: "AcmeBook Pro 14",
  operating_system: null,
  symptoms: "Will not power on.",
  problem_started_at: null,
  problem_started_note: null,
  recent_events: null,
  user_mode: "technician",
  status: "open",
  safety_state: "normal",
  created_at: "2026-10-30T09:00:00.000Z",
  updated_at: "2026-10-30T09:00:00.000Z",
} as const;

const DETAIL: SessionDetailResponse = {
  session: { ...SESSION },
  evidence: [],
  observations: [],
  hypotheses: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      session_id: SESSION.id,
      title: "Failing battery",
      description: null,
      supporting_observations: [{ kind: "note", id: null, note: "Swollen" }],
      contradicting_observations: [],
      confidence_label: "medium",
      confidence_rationale: null,
      status: "proposed",
      suggested_next_test_id: null,
      verified_by_test_result_id: null,
      created_at: "2026-10-30T09:05:00.000Z",
      updated_at: "2026-10-30T09:05:00.000Z",
    },
  ],
  tests: [
    {
      test: {
        id: "66666666-6666-4666-8666-666666666666",
        session_id: SESSION.id,
        name: "Charger swap",
        objective: "Rule out the adapter.",
        rationale: null,
        required_tools: ["Known-good charger"],
        skill_level: "beginner",
        safety_classification: "safe",
        instructions: [{ step: 1, text: "Swap the charger." }],
        expected_outcomes: null,
        result_options: [{ value: "boots", label: "It boots" }],
        position: 0,
        status: "awaiting_result",
        created_at: "2026-10-30T09:05:00.000Z",
        updated_at: "2026-10-30T09:05:00.000Z",
      },
      result: null,
    },
  ],
  events: [
    {
      id: "88888888-8888-4888-8888-888888888888",
      session_id: SESSION.id,
      event_type: "analysis_completed",
      payload: { hypotheses: 1 },
      created_at: "2026-10-30T09:05:00.000Z",
    },
  ],
  citations: [
    {
      id: "99999999-9999-4999-8999-999999999999",
      chunk_id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      hypothesis_id: "44444444-4444-4444-8444-444444444444",
      test_id: null,
      excerpt: "Check the battery connector.",
      note: null,
      document_id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      document_title: "Acme Service Manual",
      page_number: 12,
      heading: "Battery",
      created_at: "2026-10-30T09:06:00.000Z",
    },
  ],
  safety_events: [],
  model_runs: [
    {
      id: "cccccccc-cccc-4ccc-cccc-cccccccccccc",
      provider: "meta",
      model_id: "muse-spark-1.3",
      task_type: "diagnosis",
      status: "succeeded",
      latency_ms: 1200,
      created_at: "2026-10-30T09:05:00.000Z",
    },
  ],
};

describe("toWorkstationSession", () => {
  it("maps the full loop state into panel shapes", () => {
    const session = toWorkstationSession(DETAIL);
    expect(session.hypotheses).toHaveLength(1);
    expect(session.hypotheses[0]).toMatchObject({
      title: "Failing battery",
      status: "proposed",
    });
    expect(session.tests).toHaveLength(1);
    expect(session.tests[0]).toMatchObject({ name: "Charger swap", result: null });
    expect(session.events.map((e) => e.event_type)).toEqual(["analysis_completed"]);
    expect(session.citations[0]).toMatchObject({
      document_title: "Acme Service Manual",
      page_number: 12,
    });
    expect(session.model_runs[0]).toMatchObject({
      model_id: "muse-spark-1.3",
      origin: "live",
    });
    expect(session.user_mode).toBe("technician");
  });
});
