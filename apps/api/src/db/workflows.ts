import type { Kysely } from "kysely";
import type {
  CreateSafetyEvent,
  DiagnosticEventInput,
  RecordTestResult,
  UpdateHypothesis,
} from "@fieldfix/contracts";
import type {
  Database,
  DiagnosticSession,
  DiagnosticTest,
  SafetyEvent,
  TestResult,
} from "./database.js";
import { EventRepository } from "./repositories/events.js";
import { HypothesisRepository } from "./repositories/hypotheses.js";
import { SafetyEventRepository } from "./repositories/safety.js";
import { SessionRepository } from "./repositories/sessions.js";
import {
  DiagnosticTestRepository,
  TestResultRepository,
} from "./repositories/tests.js";

export interface HypothesisUpdateInput {
  id: string;
  patch: UpdateHypothesis;
}

export interface RecordTestResultInput {
  session_id: string;
  test_id: string;
  result: RecordTestResult;
  hypothesis_updates?: HypothesisUpdateInput[];
  event?: DiagnosticEventInput;
}

/**
 * Record a user-reported test result together with its hypothesis updates
 * and workflow event in a single transaction (PRD §8). Any failure —
 * unknown test, cross-session hypothesis, constraint violation — rolls
 * back the whole batch so the session can never hold a result without
 * its corresponding assessment update.
 */
export async function recordTestResult(
  db: Kysely<Database>,
  input: RecordTestResultInput,
): Promise<{ result: TestResult; test: DiagnosticTest }> {
  return db.transaction().execute(async (trx) => {
    const tests = new DiagnosticTestRepository(trx);
    const results = new TestResultRepository(trx);
    const hypotheses = new HypothesisRepository(trx);
    const events = new EventRepository(trx);

    const test = await tests.getById(input.test_id);
    if (!test || test.session_id !== input.session_id) {
      throw new Error(
        `test ${input.test_id} does not belong to session ${input.session_id}`,
      );
    }

    const result = await results.create({
      test_id: input.test_id,
      session_id: input.session_id,
      selected_option: input.result.selected_option,
      observation: input.result.observation ?? null,
    });

    const updatedTest = await tests.updateStatus(input.test_id, "completed");
    if (!updatedTest) {
      throw new Error(`test ${input.test_id} disappeared mid-transaction`);
    }

    for (const item of input.hypothesis_updates ?? []) {
      const hypothesis = await hypotheses.getById(item.id);
      if (!hypothesis || hypothesis.session_id !== input.session_id) {
        throw new Error(
          `hypothesis ${item.id} does not belong to session ${input.session_id}`,
        );
      }
      await hypotheses.update(item.id, item.patch);
    }

    await events.append(
      input.session_id,
      input.event ?? {
        event_type: "test_result_recorded",
        payload: {
          test_id: input.test_id,
          selected_option: input.result.selected_option,
        },
      },
    );

    return { result, test: updatedTest };
  });
}

export interface RecordSafetyTransitionInput {
  session_id: string;
  event: CreateSafetyEvent;
}

/**
 * Move a session to a new safety state and record the safety audit event
 * plus the workflow event atomically. The deterministic safety controller
 * (later phase) will call this — never the AI adapter directly.
 */
export async function recordSafetyTransition(
  db: Kysely<Database>,
  input: RecordSafetyTransitionInput,
): Promise<{ session: DiagnosticSession; safety_event: SafetyEvent }> {
  return db.transaction().execute(async (trx) => {
    const sessions = new SessionRepository(trx);
    const safety = new SafetyEventRepository(trx);
    const events = new EventRepository(trx);

    const session = await sessions.updateSafetyState(
      input.session_id,
      input.event.new_state,
    );
    if (!session) {
      throw new Error(`unknown session ${input.session_id}`);
    }
    const safetyEvent = await safety.append(input.session_id, input.event);
    await events.append(input.session_id, {
      event_type: "safety_state_changed",
      payload: {
        previous_state: input.event.previous_state,
        new_state: input.event.new_state,
        trigger_type: input.event.trigger_type,
      },
    });
    return { session, safety_event: safetyEvent };
  });
}
