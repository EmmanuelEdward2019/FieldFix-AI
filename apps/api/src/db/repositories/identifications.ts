import type {
  IdentifiedComponent,
  SuspectedFaultArea,
} from "@fieldfix/contracts";
import type { Db, EvidenceIdentification } from "../database.js";
import { jsonb } from "../database.js";

export interface CreateIdentificationInput {
  session_id: string;
  evidence_file_id: string;
  device_name: string | null;
  components: IdentifiedComponent[];
  suspected_fault_area: SuspectedFaultArea | null;
  unidentifiable: string[];
  model_run_id: string | null;
}

export class IdentificationRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateIdentificationInput): Promise<EvidenceIdentification> {
    return this.db
      .insertInto("evidence_identifications")
      .values({
        session_id: input.session_id,
        evidence_file_id: input.evidence_file_id,
        device_name: input.device_name,
        components: jsonb(input.components),
        suspected_fault_area: input.suspected_fault_area
          ? jsonb(input.suspected_fault_area)
          : null,
        unidentifiable: jsonb(input.unidentifiable),
        model_run_id: input.model_run_id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getLatest(fileId: string): Promise<EvidenceIdentification | undefined> {
    return this.db
      .selectFrom("evidence_identifications")
      .selectAll()
      .where("evidence_file_id", "=", fileId)
      .orderBy("created_at", "desc")
      .executeTakeFirst();
  }
}
