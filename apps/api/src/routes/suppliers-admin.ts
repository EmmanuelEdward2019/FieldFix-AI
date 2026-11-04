import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import {
  createManualProductSchema,
  createSupplierSchema,
  updateSupplierProductSchema,
  updateSupplierSchema,
} from "@fieldfix/contracts";
import type { Database } from "../db/database.js";
import {
  type AdminActor,
  type AdminRequest,
  type Capability,
  requireCapability,
} from "../auth/admin-access.js";
import { AuditLogRepository } from "../db/repositories/audit.js";
import { SuppliersRepository } from "../db/repositories/suppliers.js";
import { sendError } from "../http/errors.js";
import { SupplierSyncError, syncSupplier } from "../suppliers/sync.js";
import {
  toSupplierProductResponse,
  toSupplierResponse,
} from "./serializers.js";

export interface SuppliersAdminRouterDeps {
  db: Kysely<Database>;
}

const uuidParam = z.string().uuid();

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function adminOf(req: Request): AdminActor {
  return (req as AdminRequest).admin;
}

function page(req: Request, def = 25, max = 100): { limit: number; offset: number } {
  const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const rawOffset = Array.isArray(req.query.offset) ? req.query.offset[0] : req.query.offset;
  const limit = Math.min(Math.max(Number.parseInt(String(rawLimit ?? def), 10) || def, 1), max);
  const offset = Math.max(Number.parseInt(String(rawOffset ?? "0"), 10) || 0, 0);
  return { limit, offset };
}

function str(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    value = value[0];
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

function syncStatus(code: SupplierSyncError["code"]): number {
  switch (code) {
    case "supplier_not_found":
      return 404;
    case "sync_not_supported":
    case "sync_disabled":
    case "sync_not_configured":
      return 422;
    default:
      return 502;
  }
}

export function createSuppliersAdminRouter(deps: SuppliersAdminRouterDeps) {
  const { db } = deps;
  const router = express.Router();
  const suppliers = new SuppliersRepository(db);
  const audit = new AuditLogRepository(db);
  const guard = (capability: Capability) => requireCapability(db, capability);

  const log = (
    req: Request,
    action: string,
    opts: {
      targetType?: string;
      targetId?: string;
      outcome?: "success" | "denied" | "failed";
      metadata?: Record<string, unknown>;
    } = {},
  ) => audit.append(adminOf(req), req, { action, ...opts });

  router.get("/suppliers", guard("suppliers:view"), async (_req: Request, res: Response) => {
    const rows = await suppliers.list();
    res.json({
      suppliers: rows.map((row) => toSupplierResponse(row, row.product_count)),
    });
  });

  router.post("/suppliers", guard("suppliers:manage"), async (req: Request, res: Response) => {
    const parsed = createSupplierSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", formatIssues(parsed.error));
      return;
    }
    if (parsed.data.feed_type === "woocommerce_store" && !parsed.data.feed_base_url) {
      sendError(res, 400, "invalid_request", "Live store feeds require a feed URL.");
      return;
    }
    const created = await suppliers.create(parsed.data);
    await log(req, "supplier.create", {
      targetType: "supplier",
      targetId: created.id,
      metadata: { name: created.name, feed_type: created.feed_type },
    });
    res.status(201).json({ supplier: toSupplierResponse(created, 0) });
  });

  router.patch("/suppliers/:id", guard("suppliers:manage"), async (req: Request, res: Response) => {
    const id = uuidParam.safeParse(req.params.id);
    const parsed = updateSupplierSchema.safeParse(req.body);
    if (!id.success || !parsed.success) {
      sendError(res, 400, "invalid_request", "Valid supplier id and update body are required.");
      return;
    }
    const updated = await suppliers.update(id.data, parsed.data);
    if (!updated) {
      sendError(res, 404, "not_found", "Unknown supplier.");
      return;
    }
    await log(req, "supplier.update", {
      targetType: "supplier",
      targetId: updated.id,
      metadata: { keys: Object.keys(parsed.data) },
    });
    const products = await suppliers.listProducts(updated.id, { limit: 1, offset: 0 });
    res.json({ supplier: toSupplierResponse(updated, products.total) });
  });

  router.delete("/suppliers/:id", guard("suppliers:manage"), async (req: Request, res: Response) => {
    const id = uuidParam.safeParse(req.params.id);
    if (!id.success) {
      sendError(res, 400, "invalid_request", "Valid supplier id is required.");
      return;
    }
    const removed = await suppliers.remove(id.data);
    if (!removed) {
      sendError(res, 404, "not_found", "Unknown supplier.");
      return;
    }
    await log(req, "supplier.delete", { targetType: "supplier", targetId: id.data });
    res.json({ ok: true });
  });

  router.post(
    "/suppliers/:id/sync",
    guard("suppliers:manage"),
    async (req: Request, res: Response) => {
      const id = uuidParam.safeParse(req.params.id);
      if (!id.success) {
        sendError(res, 400, "invalid_request", "Valid supplier id is required.");
        return;
      }
      try {
        const result = await syncSupplier(db, id.data);
        await log(req, "supplier.sync", {
          targetType: "supplier",
          targetId: id.data,
          metadata: {
            fetched: result.fetched,
            created: result.created,
            updated: result.updated,
            truncated: result.truncated,
          },
        });
        res.json({ sync: result });
      } catch (err) {
        if (err instanceof SupplierSyncError) {
          await log(req, "supplier.sync", {
            targetType: "supplier",
            targetId: id.data,
            outcome: "failed",
            metadata: { code: err.code },
          });
          sendError(res, syncStatus(err.code), err.code, err.message);
          return;
        }
        sendError(res, 500, "internal_error", "Unexpected supplier sync failure.");
      }
    },
  );

  router.get(
    "/suppliers/:id/products",
    guard("suppliers:view"),
    async (req: Request, res: Response) => {
      const id = uuidParam.safeParse(req.params.id);
      if (!id.success) {
        sendError(res, 400, "invalid_request", "Valid supplier id is required.");
        return;
      }
      const supplier = await suppliers.getById(id.data);
      if (!supplier) {
        sendError(res, 404, "not_found", "Unknown supplier.");
        return;
      }
      const { limit, offset } = page(req);
      const { items, total } = await suppliers.listProducts(id.data, {
        limit,
        offset,
        query: str(req.query.q),
      });
      res.json({
        products: items.map(toSupplierProductResponse),
        total,
        limit,
        offset,
      });
    },
  );

  router.post(
    "/suppliers/:id/products",
    guard("suppliers:manage"),
    async (req: Request, res: Response) => {
      const id = uuidParam.safeParse(req.params.id);
      const parsed = createManualProductSchema.safeParse(req.body);
      if (!id.success || !parsed.success) {
        sendError(
          res,
          400,
          "invalid_request",
          !parsed.success ? formatIssues(parsed.error) : "Valid supplier id is required.",
        );
        return;
      }
      const supplier = await suppliers.getById(id.data);
      if (!supplier) {
        sendError(res, 404, "not_found", "Unknown supplier.");
        return;
      }
      if (supplier.feed_type !== "manual") {
        sendError(
          res,
          422,
          "sync_not_supported",
          "Listings can only be keyed in for manual suppliers; live feeds sync from the store.",
        );
        return;
      }
      const created = await suppliers.createManualProduct(
        id.data,
        `manual-${randomUUID()}`,
        parsed.data,
      );
      await log(req, "supplier.product.create", {
        targetType: "supplier_product",
        targetId: created.id,
        metadata: { supplier_id: id.data, name: created.name },
      });
      res.status(201).json({ product: toSupplierProductResponse(created) });
    },
  );

  router.patch(
    "/suppliers/:id/products/:productId",
    guard("suppliers:manage"),
    async (req: Request, res: Response) => {
      const ids = z
        .object({ id: z.string().uuid(), productId: z.string().uuid() })
        .safeParse(req.params);
      const parsed = updateSupplierProductSchema.safeParse(req.body);
      if (!ids.success || !parsed.success) {
        sendError(res, 400, "invalid_request", "Valid ids and update body are required.");
        return;
      }
      const product = await suppliers.getProduct(ids.data.productId);
      if (!product || product.supplier_id !== ids.data.id) {
        sendError(res, 404, "not_found", "Unknown product for this supplier.");
        return;
      }
      const updated = await suppliers.updateProduct(ids.data.productId, parsed.data);
      if (!updated) {
        sendError(res, 404, "not_found", "Unknown product.");
        return;
      }
      await log(req, "supplier.product.update", {
        targetType: "supplier_product",
        targetId: updated.id,
        metadata: { keys: Object.keys(parsed.data) },
      });
      res.json({ product: toSupplierProductResponse(updated) });
    },
  );

  router.delete(
    "/suppliers/:id/products/:productId",
    guard("suppliers:manage"),
    async (req: Request, res: Response) => {
      const ids = z
        .object({ id: z.string().uuid(), productId: z.string().uuid() })
        .safeParse(req.params);
      if (!ids.success) {
        sendError(res, 400, "invalid_request", "Valid ids are required.");
        return;
      }
      const product = await suppliers.getProduct(ids.data.productId);
      if (!product || product.supplier_id !== ids.data.id) {
        sendError(res, 404, "not_found", "Unknown product for this supplier.");
        return;
      }
      await suppliers.removeProduct(ids.data.productId);
      await log(req, "supplier.product.delete", {
        targetType: "supplier_product",
        targetId: ids.data.productId,
      });
      res.json({ ok: true });
    },
  );

  return router;
}
