import type {
  CreateDiagnosticTest,
  DiagnosticTestStatus,
  RecordTestResult,
} from "@fieldfix/contracts";
import type { Db, DiagnosticTest, TestResult } from "../database.js";
import { jsonb } from "../database.js";

export class DiagnosticTestRepository {
  constructor(private readonly db: Db) {}

  async create(
    sessionId: string,
    input: CreateDiagnosticTest,
  ): Promise<DiagnosticTest> {
    return this.db
      .insertInto("diagnostic_tests")
      .values({
        session_id: sessionId,
        name: input.name,
        objective: input.objective,
        rationale: input.rationale ?? null,
        required_tools: input.required_tools,
        skill_level: input.skill_level,
        safety_classification: input.safety_classification,
        instructions: jsonb(input.instructions),
        expected_outcomes: input.expected_outcomes ?? null,
        result_options: jsonb(input.result_options),
        position: input.position,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getById(id: string): Promise<DiagnosticTest | undefined> {
    return this.db
      .selectFrom("diagnostic_tests")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async listBySession(sessionId: string): Promise<DiagnosticTest[]> {
    return this.db
      .selectFrom("diagnostic_tests")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("position", "asc")
      .orderBy("created_at", "asc")
      .execute();
  }

  async updateStatus(
    id: string,
    status: DiagnosticTestStatus,
  ): Promise<DiagnosticTest | undefined> {
    return this.db
      .updateTable("diagnostic_tests")
      .set({ status })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }
}

export interface CreateTestResultInput extends RecordTestResult {
  test_id: string;
  session_id: string;
}

export class TestResultRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateTestResultInput): Promise<TestResult> {
    return this.db
      .insertInto("test_results")
      .values({
        test_id: input.test_id,
        session_id: input.session_id,
        selected_option: input.selected_option,
        observation: input.observation ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getByTestId(testId: string): Promise<TestResult | undefined> {
    return this.db
      .selectFrom("test_results")
      .selectAll()
      .where("test_id", "=", testId)
      .executeTakeFirst();
  }

  async listBySession(sessionId: string): Promise<TestResult[]> {
    return this.db
      .selectFrom("test_results")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "asc")
      .execute();
  }
}
