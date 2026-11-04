import type {
  CreateAnnotation,
  CreateEvidenceFile,
  CreateObservation,
  ProcessingStatus,
} from "@fieldfix/contracts";
import type {
  Db,
  EvidenceAnnotation,
  EvidenceFile,
  EvidenceObservation,
} from "../database.js";
import { jsonb } from "../database.js";

export class EvidenceFileRepository {
  constructor(private readonly db: Db) {}

  async create(
    sessionId: string,
    input: CreateEvidenceFile,
  ): Promise<EvidenceFile> {
    return this.db
      .insertInto("evidence_files")
      .values({
        session_id: sessionId,
        storage_key: input.storage_key,
        media_type: input.media_type,
        byte_size: input.byte_size,
        original_filename: input.original_filename ?? null,
        kind: input.kind,
        checksum_sha256: input.checksum_sha256 ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getById(id: string): Promise<EvidenceFile | undefined> {
    return this.db
      .selectFrom("evidence_files")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async listBySession(sessionId: string): Promise<EvidenceFile[]> {
    return this.db
      .selectFrom("evidence_files")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async setProcessing(
    id: string,
    status: ProcessingStatus,
    error: string | null = null,
  ): Promise<EvidenceFile | undefined> {
    return this.db
      .updateTable("evidence_files")
      .set({ processing_status: status, processing_error: error })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  async remove(id: string): Promise<void> {
    await this.db.deleteFrom("evidence_files").where("id", "=", id).execute();
  }
}

export class ObservationRepository {
  constructor(private readonly db: Db) {}

  async create(
    sessionId: string,
    input: CreateObservation,
  ): Promise<EvidenceObservation> {
    return this.db
      .insertInto("evidence_observations")
      .values({
        session_id: sessionId,
        evidence_file_id: input.evidence_file_id ?? null,
        source: input.source,
        body: input.body,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listBySession(sessionId: string): Promise<EvidenceObservation[]> {
    return this.db
      .selectFrom("evidence_observations")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "asc")
      .execute();
  }
}

export class AnnotationRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateAnnotation): Promise<EvidenceAnnotation> {
    return this.db
      .insertInto("evidence_annotations")
      .values({
        evidence_file_id: input.evidence_file_id,
        kind: input.kind,
        coordinates: jsonb(input.coordinates),
        label: input.label ?? null,
        producer: input.producer,
        image_width: input.image_width,
        image_height: input.image_height,
        model_run_id: input.model_run_id ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listByFile(fileId: string): Promise<EvidenceAnnotation[]> {
    return this.db
      .selectFrom("evidence_annotations")
      .selectAll()
      .where("evidence_file_id", "=", fileId)
      .orderBy("created_at", "asc")
      .execute();
  }
}
