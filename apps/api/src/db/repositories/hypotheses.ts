import type {
  CreateHypothesis,
  LinkHypothesisEvidence,
  UpdateHypothesis,
} from "@fieldfix/contracts";
import type {
  Db,
  DiagnosticHypothesis,
  HypothesisEvidenceLink,
} from "../database.js";
import { jsonb } from "../database.js";

export class HypothesisRepository {
  constructor(private readonly db: Db) {}

  async create(
    sessionId: string,
    input: CreateHypothesis,
  ): Promise<DiagnosticHypothesis> {
    return this.db
      .insertInto("diagnostic_hypotheses")
      .values({
        session_id: sessionId,
        title: input.title,
        description: input.description ?? null,
        supporting_observations: jsonb(input.supporting_observations),
        contradicting_observations: jsonb(input.contradicting_observations),
        confidence_label: input.confidence_label,
        confidence_rationale: input.confidence_rationale ?? null,
        status: input.status,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getById(id: string): Promise<DiagnosticHypothesis | undefined> {
    return this.db
      .selectFrom("diagnostic_hypotheses")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async listBySession(sessionId: string): Promise<DiagnosticHypothesis[]> {
    return this.db
      .selectFrom("diagnostic_hypotheses")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async update(
    id: string,
    patch: UpdateHypothesis,
  ): Promise<DiagnosticHypothesis | undefined> {
    if (Object.keys(patch).length === 0) {
      return this.getById(id);
    }
    const { supporting_observations, contradicting_observations, ...rest } =
      patch;
    return this.db
      .updateTable("diagnostic_hypotheses")
      .set({
        ...rest,
        ...(supporting_observations !== undefined
          ? { supporting_observations: jsonb(supporting_observations) }
          : {}),
        ...(contradicting_observations !== undefined
          ? { contradicting_observations: jsonb(contradicting_observations) }
          : {}),
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  async linkEvidence(
    hypothesisId: string,
    link: LinkHypothesisEvidence,
  ): Promise<HypothesisEvidenceLink> {
    return this.db
      .insertInto("hypothesis_evidence")
      .values({
        hypothesis_id: hypothesisId,
        evidence_file_id: link.evidence_file_id ?? null,
        observation_id: link.observation_id ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listEvidenceLinks(
    hypothesisId: string,
  ): Promise<HypothesisEvidenceLink[]> {
    return this.db
      .selectFrom("hypothesis_evidence")
      .selectAll()
      .where("hypothesis_id", "=", hypothesisId)
      .orderBy("created_at", "asc")
      .execute();
  }
}
