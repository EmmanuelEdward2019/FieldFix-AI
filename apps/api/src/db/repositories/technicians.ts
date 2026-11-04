import { sql } from "kysely";
import type {
  ContactRequestStatus,
  CreateContactRequest,
  CreateHandoff,
} from "@fieldfix/contracts";
import type {
  Db,
  NewTechnicianProfile,
  SharedDiagnosticHandoff,
  TechnicianContactRequest,
  TechnicianProfile,
} from "../database.js";
import { jsonb } from "../database.js";

export interface TechnicianSearchFilters {
  city?: string;
  region?: string;
  specialty?: string;
  deviceType?: string;
  limit: number;
}

export class TechnicianProfileRepository {
  constructor(private readonly db: Db) {}

  async upsert(input: NewTechnicianProfile): Promise<TechnicianProfile> {
    return this.db
      .insertInto("technician_profiles")
      .values(input)
      .onConflict((oc) =>
        oc.column("user_id").doUpdateSet({
          display_name: (eb) => eb.ref("excluded.display_name"),
          city: (eb) => eb.ref("excluded.city"),
          region: (eb) => eb.ref("excluded.region"),
          postal_code: (eb) => eb.ref("excluded.postal_code"),
          latitude: (eb) => eb.ref("excluded.latitude"),
          longitude: (eb) => eb.ref("excluded.longitude"),
          specialties: (eb) => eb.ref("excluded.specialties"),
          device_types: (eb) => eb.ref("excluded.device_types"),
          phone: (eb) => eb.ref("excluded.phone"),
          contact_email: (eb) => eb.ref("excluded.contact_email"),
          whatsapp: (eb) => eb.ref("excluded.whatsapp"),
          about: (eb) => eb.ref("excluded.about"),
          accepting_requests: (eb) => eb.ref("excluded.accepting_requests"),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getByUserId(userId: string): Promise<TechnicianProfile | undefined> {
    return this.db
      .selectFrom("technician_profiles")
      .selectAll()
      .where("user_id", "=", userId)
      .executeTakeFirst();
  }

  /**
   * Public directory search: accepting profiles only (verified and
   * unverified alike — the badge is a label, not a filter). Array
   * matches are case-insensitive exact-element matches.
   */
  async search(filters: TechnicianSearchFilters): Promise<TechnicianProfile[]> {
    let query = this.db
      .selectFrom("technician_profiles")
      .selectAll()
      .where("accepting_requests", "=", true);
    if (filters.city) {
      query = query.where("city", "ilike", filters.city);
    }
    if (filters.region) {
      query = query.where("region", "ilike", filters.region);
    }
    if (filters.specialty) {
      query = query.where(
        sql<boolean>`exists (select 1 from unnest(specialties) s where lower(s) = lower(${filters.specialty}))`,
      );
    }
    if (filters.deviceType) {
      query = query.where(
        sql<boolean>`exists (select 1 from unnest(device_types) d where lower(d) = lower(${filters.deviceType}))`,
      );
    }
    return query
      .orderBy("verified", "desc")
      .orderBy("display_name", "asc")
      .limit(filters.limit)
      .execute();
  }

  /** Admin-only badge toggle; profile content is never touched here. */
  async setVerified(
    userId: string,
    verified: boolean,
  ): Promise<TechnicianProfile | undefined> {
    return this.db
      .updateTable("technician_profiles")
      .set({ verified })
      .where("user_id", "=", userId)
      .returningAll()
      .executeTakeFirst();
  }
}

export class ContactRequestRepository {
  constructor(private readonly db: Db) {}

  async create(
    technicianUserId: string,
    requesterUserId: string,
    input: CreateContactRequest,
  ): Promise<TechnicianContactRequest> {
    return this.db
      .insertInto("technician_contact_requests")
      .values({
        session_id: input.session_id ?? null,
        requester_user_id: requesterUserId,
        technician_user_id: technicianUserId,
        message: input.message,
        contact_method: input.contact_method ?? null,
        preferred_time: input.preferred_time ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getById(id: string): Promise<TechnicianContactRequest | undefined> {
    return this.db
      .selectFrom("technician_contact_requests")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /** Requests the caller sent (requester side). */
  async listSent(requesterUserId: string): Promise<TechnicianContactRequest[]> {
    return this.db
      .selectFrom("technician_contact_requests")
      .selectAll()
      .where("requester_user_id", "=", requesterUserId)
      .orderBy("created_at", "desc")
      .execute();
  }

  /** Requests addressed to the caller (technician side). */
  async listReceived(technicianUserId: string): Promise<TechnicianContactRequest[]> {
    return this.db
      .selectFrom("technician_contact_requests")
      .selectAll()
      .where("technician_user_id", "=", technicianUserId)
      .orderBy("created_at", "desc")
      .execute();
  }

  async updateStatus(
    id: string,
    status: ContactRequestStatus,
  ): Promise<TechnicianContactRequest | undefined> {
    return this.db
      .updateTable("technician_contact_requests")
      .set({ status })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }
}

export class DiagnosticHandoffRepository {
  constructor(private readonly db: Db) {}

  async create(
    requestId: string,
    createdByUserId: string,
    input: CreateHandoff,
  ): Promise<SharedDiagnosticHandoff> {
    return this.db
      .insertInto("shared_diagnostic_handoffs")
      .values({
        request_id: requestId,
        session_id: input.session_id,
        shared_evidence_ids: jsonb(input.shared_evidence_ids),
        shared_report: input.shared_report,
        created_by_user_id: createdByUserId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** Latest consent record wins when a request was shared repeatedly. */
  async getLatestByRequestId(
    requestId: string,
  ): Promise<SharedDiagnosticHandoff | undefined> {
    return this.db
      .selectFrom("shared_diagnostic_handoffs")
      .selectAll()
      .where("request_id", "=", requestId)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();
  }
}
