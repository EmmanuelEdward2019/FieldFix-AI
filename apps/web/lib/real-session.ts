import type { SessionDetailResponse } from "@fieldfix/contracts";
import type { DemoSession } from "./demo-data";

/**
 * Normalize a live API session into the workstation's session shape so
 * every panel renders real data with the same code. The detail endpoint
 * carries the full diagnostic state (hypotheses, tests + results,
 * events, citations, safety history, model runs).
 */
export function toWorkstationSession(
  detail: SessionDetailResponse,
): DemoSession {
  const { session } = detail;
  return {
    device_type: session.device_type,
    manufacturer: session.manufacturer ?? undefined,
    model: session.model ?? undefined,
    operating_system: session.operating_system ?? undefined,
    symptoms: session.symptoms,
    problem_started_at: session.problem_started_at ?? undefined,
    problem_started_note: session.problem_started_note ?? undefined,
    recent_events: session.recent_events ?? undefined,
    user_mode: session.user_mode,
    id: session.id,
    status: session.status,
    safety_state: session.safety_state,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    evidence: detail.evidence.map((file) => ({
      storage_key: "",
      media_type: file.media_type,
      byte_size: file.byte_size,
      original_filename: file.original_filename,
      kind: file.kind,
      checksum_sha256: file.checksum_sha256,
      id: file.id,
      processing_status: file.processing_status,
      processing_error: file.processing_error,
      createdAt: file.created_at,
      annotations: [],
    })),
    observations: detail.observations.map((obs) => ({
      evidence_file_id: obs.evidence_file_id,
      source: obs.source,
      body: obs.body,
      id: obs.id,
      createdAt: obs.created_at,
    })),
    hypotheses: detail.hypotheses.map((h) => ({
      title: h.title,
      description: h.description ?? undefined,
      supporting_observations: h.supporting_observations,
      contradicting_observations: h.contradicting_observations,
      confidence_label: h.confidence_label,
      confidence_rationale: h.confidence_rationale ?? undefined,
      id: h.id,
      status: h.status,
      createdAt: h.created_at,
      updatedAt: h.updated_at,
    })),
    tests: detail.tests.map(({ test, result }) => ({
      name: test.name,
      objective: test.objective,
      rationale: test.rationale ?? undefined,
      required_tools: test.required_tools,
      skill_level: test.skill_level,
      safety_classification: test.safety_classification,
      instructions: test.instructions,
      expected_outcomes: test.expected_outcomes ?? undefined,
      result_options: test.result_options,
      position: test.position,
      id: test.id,
      status: test.status,
      result: result
        ? {
            selected_option: result.selected_option,
            observation: result.observation ?? undefined,
            id: result.id,
            reportedAt: result.created_at,
          }
        : null,
    })),
    events: detail.events.map((event) => ({
      event_type: event.event_type,
      payload: event.payload,
      id: event.id,
      createdAt: event.created_at,
    })),
    citations: detail.citations.map((citation) => ({
      hypothesis_id: citation.hypothesis_id ?? undefined,
      test_id: citation.test_id ?? undefined,
      chunk_id: citation.chunk_id,
      excerpt: citation.excerpt,
      note: citation.note ?? undefined,
      id: citation.id,
      document_title: citation.document_title,
      page_number: citation.page_number,
      createdAt: citation.created_at,
    })),
    safety_events: detail.safety_events.map((event) => ({
      previous_state: event.previous_state,
      new_state: event.new_state,
      trigger_type: event.trigger_type,
      trigger_detail: event.trigger_detail ?? undefined,
      evidence_file_id: event.evidence_file_id ?? undefined,
      blocked_action: event.blocked_action ?? undefined,
      safe_next_steps: event.safe_next_steps,
      id: event.id,
      createdAt: event.created_at,
    })),
    model_runs: detail.model_runs.map((run) => ({
      id: run.id,
      provider: run.provider,
      model_id: run.model_id,
      task_type: run.task_type,
      status: run.status,
      latency_ms: run.latency_ms,
      origin: "live" as const,
      createdAt: run.created_at,
    })),
    report: null,
  };
}
