import type { Kysely } from "kysely";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  addShopMemberSchema,
  attachJobSessionSchema,
  createCustomerDeviceSchema,
  createInventoryItemSchema,
  createInventoryMovementSchema,
  createRepairEstimateSchema,
  createRepairJobEventSchema,
  createRepairJobSchema,
  createShopCustomerSchema,
  createShopSchema,
  jobStatusSchema,
  listInventoryQuerySchema,
  listRepairJobsQuerySchema,
  shopReportQuerySchema,
  updateInventoryItemSchema,
  updateRepairEstimateSchema,
  updateRepairJobSchema,
  updateShopCustomerSchema,
  updateShopMemberSchema,
  updateShopSchema,
  type JobStatus,
  type ShopMemberRole,
} from "@fieldfix/contracts";
import { requireUser, type UserRequest } from "../auth/user-access.js";
import type { Database, RepairEstimate, Shop, ShopMember } from "../db/database.js";
import { AuditLogRepository } from "../db/repositories/audit.js";
import { PartRecommendationRepository } from "../db/repositories/parts.js";
import { SessionRepository } from "../db/repositories/sessions.js";
import {
  CustomerDeviceRepository,
  ESTIMATE_TRANSITIONS,
  generateReference,
  InventoryItemRepository,
  InventoryMovementRepository,
  RepairEstimateItemRepository,
  RepairEstimateRepository,
  RepairJobEventRepository,
  RepairJobRepository,
  ShopCustomerRepository,
  ShopMemberRepository,
  ShopRepository,
} from "../db/repositories/shop.js";
import { UsersRepository } from "../db/repositories/users.js";
import { sendError } from "../http/errors.js";
import {
  toCustomerDeviceShape,
  toInventoryItemShape,
  toInventoryMovementShape,
  toRepairEstimateItemShape,
  toRepairEstimateShape,
  toRepairJobEventShape,
  toRepairJobShape,
  toShopCustomerShape,
  toShopMemberShape,
  toShopReportSummaryShape,
  toShopShape,
} from "./serializers.js";

export interface ShopRouterDeps {
  db: Kysely<Database>;
}

const uuidParam = z.string().uuid();

/** Request inside a shop scope: login user + shop + own membership. */
export interface ShopRequest extends UserRequest {
  shop: Shop;
  membership: ShopMember;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function firstString(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "23505"
  );
}

/** Thrown for expected failures inside transactions; mapped outside. */
class ShopActionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const ALL_JOB_STATUSES = jobStatusSchema.options;
const IN_PROGRESS: JobStatus[] = ["diagnosing", "in_repair", "testing"];
const SHOP_MANAGERS: ShopMemberRole[] = ["owner", "admin"];

export function createShopRouter(deps: ShopRouterDeps) {
  const { db } = deps;
  const router = express.Router();
  const shops = new ShopRepository(db);
  const members = new ShopMemberRepository(db);
  const customers = new ShopCustomerRepository(db);
  const devices = new CustomerDeviceRepository(db);
  const jobs = new RepairJobRepository(db);
  const events = new RepairJobEventRepository(db);
  const estimates = new RepairEstimateRepository(db);
  const estimateItems = new RepairEstimateItemRepository(db);
  const inventory = new InventoryItemRepository(db);
  const movements = new InventoryMovementRepository(db);
  const users = new UsersRepository(db);
  const sessions = new SessionRepository(db);
  const partRecs = new PartRecommendationRepository(db);
  const audit = new AuditLogRepository(db);

  const auditMutation = (
    req: Request,
    user: { id: string; email: string },
    action: string,
    targetType: string,
    targetId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> =>
    audit.append(
      { actorType: "user", actorId: user.id, actorEmail: user.email },
      req,
      { action, targetType, targetId, metadata },
    );

  /**
   * Shop-membership guard. Unknown/malformed shops 404 (no leak);
   * non-members 403. Optional role allowlist for manager-only routes.
   */
  function requireShopMember(allowed?: ShopMemberRole[]) {
    return async (req: Request, res: Response, next: NextFunction) => {
      const parsedId = uuidParam.safeParse(req.params.shopId);
      if (!parsedId.success) {
        sendError(res, 404, "shop_not_found", "No such shop.");
        return;
      }
      const { user } = req as UserRequest;
      let shop: Shop | undefined;
      let membership: ShopMember | undefined;
      try {
        shop = await shops.getById(parsedId.data);
        membership = shop ? await members.get(shop.id, user.id) : undefined;
      } catch (err) {
        next(err);
        return;
      }
      if (!shop) {
        sendError(res, 404, "shop_not_found", "No such shop.");
        return;
      }
      if (!membership) {
        sendError(res, 403, "forbidden", "You are not a member of this shop.");
        return;
      }
      if (allowed && !allowed.includes(membership.role)) {
        sendError(
          res,
          403,
          "forbidden",
          `This action requires one of: ${allowed.join(", ")}.`,
        );
        return;
      }
      (req as ShopRequest).shop = shop;
      (req as ShopRequest).membership = membership;
      next();
    };
  }

  const memberOnly = requireShopMember();
  const managerOnly = requireShopMember(SHOP_MANAGERS);

  /** Insert with a fresh reference, retrying once per collision. */
  async function insertWithReference<T>(
    prefix: "C" | "J",
    insert: (reference: string) => Promise<T>,
  ): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await insert(generateReference(prefix));
      } catch (err) {
        if (!isUniqueViolation(err)) {
          throw err;
        }
        last = err;
      }
    }
    throw last;
  }

  /* Shops. */

  router.post("/", requireUser(db), async (req: Request, res: Response) => {
    const parsed = createShopSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", formatIssues(parsed.error));
      return;
    }
    const { user } = req as UserRequest;
    const created = await db.transaction().execute(async (trx) => {
      const shop = await new ShopRepository(trx).create(user.id, parsed.data);
      await new ShopMemberRepository(trx).add(shop.id, user.id, "owner");
      return shop;
    });
    await auditMutation(req, user, "shop.create", "shop", created.id);
    res.status(201).json({ shop: toShopShape(created), my_role: "owner" });
  });

  router.get("/", requireUser(db), async (req: Request, res: Response) => {
    const { user } = req as UserRequest;
    const rows = await shops.listByUser(user.id);
    res.json({ shops: rows.map(toShopShape) });
  });

  router.get("/:shopId", requireUser(db), memberOnly, (req: Request, res: Response) => {
    const { shop, membership } = req as ShopRequest;
    res.json({ shop: toShopShape(shop), my_role: membership.role });
  });

  router.patch(
    "/:shopId",
    requireUser(db),
    managerOnly,
    async (req: Request, res: Response) => {
      const parsed = updateShopSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { user, shop, membership } = req as ShopRequest;
      const updated = await shops.update(shop.id, parsed.data);
      if (!updated) {
        sendError(res, 404, "shop_not_found", "No such shop.");
        return;
      }
      await auditMutation(req, user, "shop.update", "shop", shop.id);
      res.json({ shop: toShopShape(updated), my_role: membership.role });
    },
  );

  /* Members (owner/admin manage; owner role granted by owners only). */

  router.get(
    "/:shopId/members",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const { shop } = req as ShopRequest;
      const rows = await members.listByShop(shop.id);
      res.json({ members: rows.map(toShopMemberShape) });
    },
  );

  router.post(
    "/:shopId/members",
    requireUser(db),
    managerOnly,
    async (req: Request, res: Response) => {
      const parsed = addShopMemberSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { user, shop, membership } = req as ShopRequest;
      if (parsed.data.role === "owner" && membership.role !== "owner") {
        sendError(res, 403, "forbidden", "Only an owner can grant the owner role.");
        return;
      }
      const target = parsed.data.user_id
        ? await users.getById(parsed.data.user_id)
        : await users.getByEmail((parsed.data.email as string).toLowerCase());
      if (!target) {
        sendError(res, 404, "user_not_found", "No account matches that invite.");
        return;
      }
      const existing = await members.get(shop.id, target.id);
      if (existing) {
        sendError(res, 409, "member_exists", "That user is already a member.");
        return;
      }
      const created = await members.add(shop.id, target.id, parsed.data.role);
      await auditMutation(req, user, "shop.member.add", "shop_member", target.id, {
        shop_id: shop.id,
        role: created.role,
      });
      res.status(201).json({ member: toShopMemberShape(created) });
    },
  );

  router.patch(
    "/:shopId/members/:userId",
    requireUser(db),
    managerOnly,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.userId);
      const parsed = updateShopMemberSchema.safeParse(req.body ?? {});
      if (!parsedId.success) {
        sendError(res, 404, "member_not_found", "No such member.");
        return;
      }
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { user, shop, membership } = req as ShopRequest;
      const row = await members.get(shop.id, parsedId.data);
      if (!row) {
        sendError(res, 404, "member_not_found", "No such member.");
        return;
      }
      if (parsed.data.role === "owner" && membership.role !== "owner") {
        sendError(res, 403, "forbidden", "Only an owner can grant the owner role.");
        return;
      }
      if (
        row.role === "owner" &&
        parsed.data.role !== "owner" &&
        (await members.countOwners(shop.id)) <= 1
      ) {
        sendError(res, 422, "last_owner", "A shop must keep at least one owner.");
        return;
      }
      const updated =
        parsed.data.role === row.role
          ? row
          : await members.setRole(shop.id, row.user_id, parsed.data.role);
      if (!updated) {
        sendError(res, 404, "member_not_found", "No such member.");
        return;
      }
      await auditMutation(req, user, "shop.member.update", "shop_member", row.user_id, {
        shop_id: shop.id,
        from: row.role,
        to: updated.role,
      });
      res.json({ member: toShopMemberShape(updated) });
    },
  );

  router.delete(
    "/:shopId/members/:userId",
    requireUser(db),
    managerOnly,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.userId);
      if (!parsedId.success) {
        sendError(res, 404, "member_not_found", "No such member.");
        return;
      }
      const { user, shop } = req as ShopRequest;
      const row = await members.get(shop.id, parsedId.data);
      if (!row) {
        sendError(res, 404, "member_not_found", "No such member.");
        return;
      }
      if (row.role === "owner" && (await members.countOwners(shop.id)) <= 1) {
        sendError(res, 422, "last_owner", "A shop must keep at least one owner.");
        return;
      }
      await members.remove(shop.id, row.user_id);
      await auditMutation(req, user, "shop.member.remove", "shop_member", row.user_id, {
        shop_id: shop.id,
        role: row.role,
      });
      res.status(204).send();
    },
  );

  /* Customers (any member). */

  router.post(
    "/:shopId/customers",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsed = createShopCustomerSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { user, shop } = req as ShopRequest;
      const created = await insertWithReference("C", (reference) =>
        customers.create(shop.id, reference, parsed.data),
      );
      await auditMutation(req, user, "shop.customer.create", "shop_customer", created.id, {
        shop_id: shop.id,
      });
      res.status(201).json({ customer: toShopCustomerShape(created) });
    },
  );

  router.get(
    "/:shopId/customers",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const { shop } = req as ShopRequest;
      const rows = await customers.listByShop(shop.id, firstString(req.query.search));
      res.json({ customers: rows.map(toShopCustomerShape) });
    },
  );

  router.get(
    "/:shopId/customers/:customerId",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.customerId);
      if (!parsedId.success) {
        sendError(res, 404, "customer_not_found", "No such customer.");
        return;
      }
      const { shop } = req as ShopRequest;
      const row = await customers.getScoped(shop.id, parsedId.data);
      if (!row) {
        sendError(res, 404, "customer_not_found", "No such customer.");
        return;
      }
      res.json({ customer: toShopCustomerShape(row) });
    },
  );

  router.patch(
    "/:shopId/customers/:customerId",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.customerId);
      const parsed = updateShopCustomerSchema.safeParse(req.body ?? {});
      if (!parsedId.success) {
        sendError(res, 404, "customer_not_found", "No such customer.");
        return;
      }
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { user, shop } = req as ShopRequest;
      const updated = await customers.update(shop.id, parsedId.data, parsed.data);
      if (!updated) {
        sendError(res, 404, "customer_not_found", "No such customer.");
        return;
      }
      await auditMutation(req, user, "shop.customer.update", "shop_customer", updated.id, {
        shop_id: shop.id,
      });
      res.json({ customer: toShopCustomerShape(updated) });
    },
  );

  /* Devices (any member; always under a shop customer). */

  router.post(
    "/:shopId/customers/:customerId/devices",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.customerId);
      const parsed = createCustomerDeviceSchema.safeParse(req.body ?? {});
      if (!parsedId.success) {
        sendError(res, 404, "customer_not_found", "No such customer.");
        return;
      }
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { user, shop } = req as ShopRequest;
      const customer = await customers.getScoped(shop.id, parsedId.data);
      if (!customer) {
        sendError(res, 404, "customer_not_found", "No such customer.");
        return;
      }
      const created = await devices.create(customer.id, parsed.data);
      await auditMutation(req, user, "shop.device.create", "customer_device", created.id, {
        shop_id: shop.id,
      });
      res.status(201).json({ device: toCustomerDeviceShape(created) });
    },
  );

  router.get(
    "/:shopId/customers/:customerId/devices",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.customerId);
      if (!parsedId.success) {
        sendError(res, 404, "customer_not_found", "No such customer.");
        return;
      }
      const { shop } = req as ShopRequest;
      const customer = await customers.getScoped(shop.id, parsedId.data);
      if (!customer) {
        sendError(res, 404, "customer_not_found", "No such customer.");
        return;
      }
      const rows = await devices.listByCustomer(customer.id);
      res.json({ devices: rows.map(toCustomerDeviceShape) });
    },
  );

  /* Repair jobs (any member). */

  router.post(
    "/:shopId/jobs",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsed = createRepairJobSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { user, shop } = req as ShopRequest;
      const customer = await customers.getScoped(shop.id, parsed.data.customer_id);
      if (!customer) {
        sendError(res, 404, "customer_not_found", "No such customer in this shop.");
        return;
      }
      if (parsed.data.device_id) {
        const device = await devices.getById(parsed.data.device_id);
        if (!device) {
          sendError(res, 404, "device_not_found", "No such device.");
          return;
        }
        if (device.customer_id !== customer.id) {
          sendError(
            res,
            422,
            "device_wrong_customer",
            "That device belongs to a different customer.",
          );
          return;
        }
      }
      if (parsed.data.assignee_user_id) {
        const assignee = await members.get(shop.id, parsed.data.assignee_user_id);
        if (!assignee) {
          sendError(
            res,
            422,
            "assignee_not_member",
            "The assignee must be a member of this shop.",
          );
          return;
        }
      }
      const created = await insertWithReference("J", (reference) =>
        jobs.create(shop.id, reference, parsed.data),
      );
      await auditMutation(req, user, "shop.job.create", "repair_job", created.id, {
        shop_id: shop.id,
      });
      res.status(201).json({ job: toRepairJobShape(created) });
    },
  );

  router.get(
    "/:shopId/jobs",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsed = listRepairJobsQuerySchema.safeParse({
        status: firstString(req.query.status),
        priority: firstString(req.query.priority),
        assignee: firstString(req.query.assignee),
        customer: firstString(req.query.customer),
        from: firstString(req.query.from),
        to: firstString(req.query.to),
        limit: firstString(req.query.limit),
      });
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { shop } = req as ShopRequest;
      const rows = await jobs.list(shop.id, parsed.data);
      res.json({ jobs: rows.map(toRepairJobShape) });
    },
  );

  router.get(
    "/:shopId/jobs/:jobId",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.jobId);
      if (!parsedId.success) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      const { shop } = req as ShopRequest;
      const job = await jobs.getScoped(shop.id, parsedId.data);
      if (!job) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      // Read-only hazard display: the linked session's safety state.
      const session = job.session_id ? await sessions.getById(job.session_id) : undefined;
      res.json({
        job: toRepairJobShape(job),
        session_safety_state: session ? session.safety_state : null,
      });
    },
  );

  router.patch(
    "/:shopId/jobs/:jobId",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.jobId);
      const parsed = updateRepairJobSchema.safeParse(req.body ?? {});
      if (!parsedId.success) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { user, shop } = req as ShopRequest;
      const job = await jobs.getScoped(shop.id, parsedId.data);
      if (!job) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      if (parsed.data.assignee_user_id) {
        const assignee = await members.get(shop.id, parsed.data.assignee_user_id);
        if (!assignee) {
          sendError(
            res,
            422,
            "assignee_not_member",
            "The assignee must be a member of this shop.",
          );
          return;
        }
      }
      const statusChanged =
        parsed.data.status !== undefined && parsed.data.status !== job.status;
      const update = {
        ...parsed.data,
        completed_at:
          parsed.data.status === "completed" && job.completed_at == null
            ? new Date()
            : undefined,
      };
      const updated = await db.transaction().execute(async (trx) => {
        const row = await new RepairJobRepository(trx).update(
          shop.id,
          job.id,
          // completed_at: undefined keys are dropped by the update path.
          Object.fromEntries(
            Object.entries(update).filter(([, v]) => v !== undefined),
          ) as Parameters<RepairJobRepository["update"]>[2],
        );
        if (row && statusChanged) {
          await new RepairJobEventRepository(trx).append({
            jobId: job.id,
            actorUserId: user.id,
            kind: "status_change",
            body: null,
            fromStatus: job.status,
            toStatus: parsed.data.status,
          });
        }
        return row;
      });
      if (!updated) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      await auditMutation(req, user, "shop.job.update", "repair_job", job.id, {
        shop_id: shop.id,
        ...(statusChanged ? { from: job.status, to: parsed.data.status } : {}),
      });
      res.json({ job: toRepairJobShape(updated) });
    },
  );

  /* Job events (any member). */

  router.post(
    "/:shopId/jobs/:jobId/events",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.jobId);
      const parsed = createRepairJobEventSchema.safeParse(req.body ?? {});
      if (!parsedId.success) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { user, shop } = req as ShopRequest;
      const job = await jobs.getScoped(shop.id, parsedId.data);
      if (!job) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      const created = await events.append({
        jobId: job.id,
        actorUserId: user.id,
        kind: parsed.data.kind,
        body: parsed.data.body ?? null,
        fromStatus: parsed.data.from_status ?? null,
        toStatus: parsed.data.to_status ?? null,
      });
      await auditMutation(req, user, "shop.job.event.create", "repair_job_event", created.id, {
        shop_id: shop.id,
        job_id: job.id,
      });
      res.status(201).json({ event: toRepairJobEventShape(created) });
    },
  );

  router.get(
    "/:shopId/jobs/:jobId/events",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.jobId);
      if (!parsedId.success) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      const { shop } = req as ShopRequest;
      const job = await jobs.getScoped(shop.id, parsedId.data);
      if (!job) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      const rows = await events.listByJob(job.id);
      res.json({ events: rows.map(toRepairJobEventShape) });
    },
  );

  /* Session link (any member; the session must be the caller's own). */

  router.post(
    "/:shopId/jobs/:jobId/session",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.jobId);
      const parsed = attachJobSessionSchema.safeParse(req.body ?? {});
      if (!parsedId.success) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { user, shop } = req as ShopRequest;
      const job = await jobs.getScoped(shop.id, parsedId.data);
      if (!job) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      const session = await sessions.getById(parsed.data.session_id);
      if (!session) {
        sendError(res, 404, "session_not_found", "No such session.");
        return;
      }
      // D12 ownership check: direct user_id match, no token fallback.
      if (session.user_id !== user.id) {
        sendError(res, 403, "forbidden", "You can only link your own sessions.");
        return;
      }
      const updated = await jobs.setSession(shop.id, job.id, session.id);
      if (!updated) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      await auditMutation(req, user, "shop.job.session.attach", "repair_job", job.id, {
        shop_id: shop.id,
        session_id: session.id,
      });
      res.json({ job: toRepairJobShape(updated) });
    },
  );

  router.delete(
    "/:shopId/jobs/:jobId/session",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.jobId);
      if (!parsedId.success) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      const { user, shop } = req as ShopRequest;
      const job = await jobs.getScoped(shop.id, parsedId.data);
      if (!job) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      const updated = await jobs.setSession(shop.id, job.id, null);
      if (!updated) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      await auditMutation(req, user, "shop.job.session.detach", "repair_job", job.id, {
        shop_id: shop.id,
      });
      res.json({ job: toRepairJobShape(updated) });
    },
  );

  /* Estimates (any member; nested under the job for tenant scoping). */

  async function loadJobEstimate(
    shopId: string,
    jobIdParam: string,
    estIdParam: string,
  ): Promise<
    | { status: 200; jobId: string; estimate: RepairEstimate }
    | { status: 404; code: string; message: string }
  > {
    const jobId = uuidParam.safeParse(jobIdParam);
    const estId = uuidParam.safeParse(estIdParam);
    if (!jobId.success) {
      return { status: 404, code: "job_not_found", message: "No such job." };
    }
    if (!estId.success) {
      return { status: 404, code: "estimate_not_found", message: "No such estimate." };
    }
    const job = await jobs.getScoped(shopId, jobId.data);
    if (!job) {
      return { status: 404, code: "job_not_found", message: "No such job." };
    }
    const estimate = await estimates.getById(estId.data);
    if (!estimate || estimate.job_id !== job.id) {
      return { status: 404, code: "estimate_not_found", message: "No such estimate." };
    }
    return { status: 200, jobId: job.id, estimate };
  }

  router.post(
    "/:shopId/jobs/:jobId/estimates",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.jobId);
      const parsed = createRepairEstimateSchema.safeParse(req.body ?? {});
      if (!parsedId.success) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { user, shop } = req as ShopRequest;
      const job = await jobs.getScoped(shop.id, parsedId.data);
      if (!job) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      for (const item of parsed.data.items) {
        if (item.source_part_rec_id) {
          const rec = await partRecs.getById(item.source_part_rec_id);
          if (!rec) {
            sendError(
              res,
              404,
              "part_recommendation_not_found",
              "A linked part recommendation does not exist.",
            );
            return;
          }
        }
      }
      const created = await db.transaction().execute(async (trx) => {
        const estimate = await new RepairEstimateRepository(trx).create(
          job.id,
          user.id,
          parsed.data,
        );
        const items = await new RepairEstimateItemRepository(trx).createMany(
          estimate.id,
          parsed.data.items,
        );
        return { estimate, items };
      });
      await auditMutation(req, user, "shop.estimate.create", "repair_estimate", created.estimate.id, {
        shop_id: shop.id,
        job_id: job.id,
      });
      res.status(201).json({
        estimate: toRepairEstimateShape(created.estimate),
        items: created.items.map(toRepairEstimateItemShape),
      });
    },
  );

  router.get(
    "/:shopId/jobs/:jobId/estimates",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.jobId);
      if (!parsedId.success) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      const { shop } = req as ShopRequest;
      const job = await jobs.getScoped(shop.id, parsedId.data);
      if (!job) {
        sendError(res, 404, "job_not_found", "No such job.");
        return;
      }
      const rows = await estimates.listByJob(job.id);
      const items = await estimateItems.listByEstimates(rows.map((r) => r.id));
      const byEstimate = new Map<string, typeof items>();
      for (const item of items) {
        const list = byEstimate.get(item.estimate_id) ?? [];
        list.push(item);
        byEstimate.set(item.estimate_id, list);
      }
      res.json({
        estimates: rows.map((estimate) => ({
          estimate: toRepairEstimateShape(estimate),
          items: (byEstimate.get(estimate.id) ?? []).map(toRepairEstimateItemShape),
        })),
      });
    },
  );

  router.patch(
    "/:shopId/jobs/:jobId/estimates/:estId",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsed = updateRepairEstimateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { user, shop } = req as ShopRequest;
      const loaded = await loadJobEstimate(shop.id, req.params.jobId, req.params.estId);
      if (loaded.status !== 200) {
        sendError(res, loaded.status, loaded.code, loaded.message);
        return;
      }
      const current = loaded.estimate;
      if (current.status === "converted") {
        sendError(
          res,
          422,
          "estimate_converted",
          "Converted estimates are terminal and cannot change.",
        );
        return;
      }
      if (parsed.data.items !== undefined && current.status !== "draft") {
        sendError(
          res,
          422,
          "estimate_not_draft",
          "Line items can only be replaced on draft estimates.",
        );
        return;
      }
      const next = parsed.data.status;
      if (next !== undefined && next !== current.status) {
        if (next === "converted") {
          sendError(
            res,
            422,
            "use_convert",
            "Use the convert endpoint to convert an approved estimate.",
          );
          return;
        }
        if (!ESTIMATE_TRANSITIONS[current.status].includes(next)) {
          sendError(
            res,
            422,
            "invalid_transition",
            `Cannot move a ${current.status} estimate to ${next}.`,
          );
          return;
        }
      }
      if (parsed.data.items) {
        for (const item of parsed.data.items) {
          if (item.source_part_rec_id) {
            const rec = await partRecs.getById(item.source_part_rec_id);
            if (!rec) {
              sendError(
                res,
                404,
                "part_recommendation_not_found",
                "A linked part recommendation does not exist.",
              );
              return;
            }
          }
        }
      }
      const { items: replacement, status, ...fields } = parsed.data;
      const updated = await db.transaction().execute(async (trx) => {
        const estRepo = new RepairEstimateRepository(trx);
        const row = await estRepo.update(current.id, {
          ...fields,
          ...(status !== undefined && status !== current.status
            ? {
                status,
                decided_at:
                  status === "approved" || status === "rejected" ? new Date() : null,
              }
            : {}),
        });
        if (row && replacement !== undefined) {
          const itemRepo = new RepairEstimateItemRepository(trx);
          await itemRepo.deleteByEstimate(current.id);
          await itemRepo.createMany(current.id, replacement);
        }
        const items = row
          ? await new RepairEstimateItemRepository(trx).listByEstimate(current.id)
          : [];
        return row ? { estimate: row, items } : null;
      });
      if (!updated) {
        sendError(res, 404, "estimate_not_found", "No such estimate.");
        return;
      }
      await auditMutation(req, user, "shop.estimate.update", "repair_estimate", current.id, {
        shop_id: shop.id,
        job_id: current.job_id,
        ...(next !== undefined && next !== current.status
          ? { from: current.status, to: next }
          : {}),
      });
      res.json({
        estimate: toRepairEstimateShape(updated.estimate),
        items: updated.items.map(toRepairEstimateItemShape),
      });
    },
  );

  router.post(
    "/:shopId/jobs/:jobId/estimates/:estId/convert",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const { user, shop } = req as ShopRequest;
      const loaded = await loadJobEstimate(shop.id, req.params.jobId, req.params.estId);
      if (loaded.status !== 200) {
        sendError(res, loaded.status, loaded.code, loaded.message);
        return;
      }
      const current = loaded.estimate;
      if (current.status !== "approved") {
        sendError(
          res,
          422,
          "estimate_not_approved",
          "Only an approved estimate can be converted.",
        );
        return;
      }
      const converted = await db.transaction().execute(async (trx) => {
        const estimate = await new RepairEstimateRepository(trx).update(current.id, {
          status: "converted",
        });
        if (!estimate) {
          return null;
        }
        // An approved job waiting on approval moves into repair.
        const jobRepo = new RepairJobRepository(trx);
        const job = await jobRepo.getScoped(shop.id, current.job_id);
        let jobStatus: JobStatus | null = null;
        if (job && job.status === "awaiting_approval") {
          await jobRepo.update(shop.id, job.id, { status: "in_repair" });
          await new RepairJobEventRepository(trx).append({
            jobId: job.id,
            actorUserId: user.id,
            kind: "status_change",
            body: null,
            fromStatus: "awaiting_approval",
            toStatus: "in_repair",
          });
          jobStatus = "in_repair";
        }
        const items = await new RepairEstimateItemRepository(trx).listByEstimate(
          current.id,
        );
        return { estimate, items, jobStatus };
      });
      if (!converted) {
        sendError(res, 404, "estimate_not_found", "No such estimate.");
        return;
      }
      await auditMutation(req, user, "shop.estimate.convert", "repair_estimate", current.id, {
        shop_id: shop.id,
        job_id: current.job_id,
      });
      res.json({
        estimate: toRepairEstimateShape(converted.estimate),
        items: converted.items.map(toRepairEstimateItemShape),
      });
    },
  );

  /* Inventory (any member). */

  router.post(
    "/:shopId/inventory",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsed = createInventoryItemSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { user, shop } = req as ShopRequest;
      const created = await inventory.create(shop.id, parsed.data);
      await auditMutation(req, user, "shop.inventory.create", "inventory_item", created.id, {
        shop_id: shop.id,
      });
      res.status(201).json({ item: toInventoryItemShape(created) });
    },
  );

  router.get(
    "/:shopId/inventory",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsed = listInventoryQuerySchema.safeParse({
        low_stock: firstString(req.query.low_stock),
        search: firstString(req.query.search),
        limit: firstString(req.query.limit),
      });
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { shop } = req as ShopRequest;
      const rows = await inventory.list(shop.id, {
        lowStock: parsed.data.low_stock,
        search: parsed.data.search,
        limit: parsed.data.limit,
      });
      res.json({ items: rows.map(toInventoryItemShape) });
    },
  );

  router.get(
    "/:shopId/inventory/:itemId",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.itemId);
      if (!parsedId.success) {
        sendError(res, 404, "item_not_found", "No such inventory item.");
        return;
      }
      const { shop } = req as ShopRequest;
      const row = await inventory.getScoped(shop.id, parsedId.data);
      if (!row) {
        sendError(res, 404, "item_not_found", "No such inventory item.");
        return;
      }
      res.json({ item: toInventoryItemShape(row) });
    },
  );

  router.patch(
    "/:shopId/inventory/:itemId",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.itemId);
      const parsed = updateInventoryItemSchema.safeParse(req.body ?? {});
      if (!parsedId.success) {
        sendError(res, 404, "item_not_found", "No such inventory item.");
        return;
      }
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { user, shop } = req as ShopRequest;
      const updated = await inventory.update(shop.id, parsedId.data, parsed.data);
      if (!updated) {
        sendError(res, 404, "item_not_found", "No such inventory item.");
        return;
      }
      await auditMutation(req, user, "shop.inventory.update", "inventory_item", updated.id, {
        shop_id: shop.id,
      });
      res.json({ item: toInventoryItemShape(updated) });
    },
  );

  router.post(
    "/:shopId/inventory/:itemId/movements",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.itemId);
      const parsed = createInventoryMovementSchema.safeParse(req.body ?? {});
      if (!parsedId.success) {
        sendError(res, 404, "item_not_found", "No such inventory item.");
        return;
      }
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { user, shop } = req as ShopRequest;
      if (parsed.data.job_id) {
        const job = await jobs.getScoped(shop.id, parsed.data.job_id);
        if (!job) {
          sendError(res, 404, "job_not_found", "No such job in this shop.");
          return;
        }
      }
      // One transaction: lock the row, re-check quantity, forbid
      // negative on-hand, then write the movement + new quantity.
      let result: { movementId: string; quantity: number };
      try {
        result = await db.transaction().execute(async (trx) => {
          const locked = await trx
            .selectFrom("inventory_items")
            .select(["id", "quantity"])
            .where("shop_id", "=", shop.id)
            .where("id", "=", parsedId.data)
            .forUpdate()
            .executeTakeFirst();
          if (!locked) {
            throw new ShopActionError(404, "item_not_found", "No such inventory item.");
          }
          const next = locked.quantity + parsed.data.delta;
          if (next < 0) {
            throw new ShopActionError(
              422,
              "insufficient_stock",
              `Only ${locked.quantity} on hand; cannot deduct ${-parsed.data.delta}.`,
            );
          }
          const movement = await trx
            .insertInto("inventory_movements")
            .values({
              item_id: locked.id,
              job_id: parsed.data.job_id ?? null,
              delta: parsed.data.delta,
              reason: parsed.data.reason,
              created_by_user_id: user.id,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          await trx
            .updateTable("inventory_items")
            .set({ quantity: next })
            .where("id", "=", locked.id)
            .execute();
          return { movementId: movement.id, quantity: next };
        });
      } catch (err) {
        if (err instanceof ShopActionError) {
          sendError(res, err.status, err.code, err.message);
          return;
        }
        // Unexpected failures must fail the request, never escape as
        // unhandled rejections that crash the API process.
        sendError(res, 500, "internal_error", "Unexpected server error.");
        return;
      }
      const movement = await db
        .selectFrom("inventory_movements")
        .selectAll()
        .where("id", "=", result.movementId)
        .executeTakeFirstOrThrow();
      await auditMutation(req, user, "shop.inventory.movement", "inventory_movement", movement.id, {
        shop_id: shop.id,
        item_id: parsedId.data,
        delta: parsed.data.delta,
      });
      res.status(201).json({
        movement: toInventoryMovementShape(movement),
        quantity: result.quantity,
      });
    },
  );

  router.get(
    "/:shopId/inventory/:itemId/movements",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsedId = uuidParam.safeParse(req.params.itemId);
      if (!parsedId.success) {
        sendError(res, 404, "item_not_found", "No such inventory item.");
        return;
      }
      const { shop } = req as ShopRequest;
      const item = await inventory.getScoped(shop.id, parsedId.data);
      if (!item) {
        sendError(res, 404, "item_not_found", "No such inventory item.");
        return;
      }
      const rows = await movements.listByItem(item.id);
      res.json({ movements: rows.map(toInventoryMovementShape) });
    },
  );

  /* Reports (any member; actuals-only — never estimate revenue). */

  router.get(
    "/:shopId/reports/summary",
    requireUser(db),
    memberOnly,
    async (req: Request, res: Response) => {
      const parsed = shopReportQuerySchema.safeParse({
        from: firstString(req.query.from),
        to: firstString(req.query.to),
      });
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", formatIssues(parsed.error));
        return;
      }
      const { shop } = req as ShopRequest;
      const { from, to } = parsed.data;
      const counts = await jobs.statusCounts(shop.id, from, to);
      const jobsByStatus: Record<string, number> = Object.fromEntries(
        ALL_JOB_STATUSES.map((status) => [status, 0]),
      );
      for (const { status, count } of counts) {
        jobsByStatus[status] = count;
      }
      const jobsTotal = Object.values(jobsByStatus).reduce((a, b) => a + b, 0);
      const inProgress = IN_PROGRESS.reduce((a, s) => a + (jobsByStatus[s] ?? 0), 0);
      const avg = await jobs.avgTurnaroundHours(shop.id, from, to);
      const partsConsumption = await movements.consumption(shop.id, from, to);
      const workload = await jobs.workload(shop.id, from, to);
      res.json({
        summary: toShopReportSummaryShape({
          from: from ?? null,
          to: to ?? null,
          jobsTotal,
          jobsByStatus,
          inProgress,
          avgTurnaroundHours: avg == null ? null : Math.round(avg * 100) / 100,
          partsConsumption,
          workload,
        }),
      });
    },
  );

  return router;
}
