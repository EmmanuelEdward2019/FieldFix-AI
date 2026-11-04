import { describe, expect, it } from "vitest";
import {
  apiErrorSchema,
  healthResponseSchema,
  type HealthResponse,
} from "../src/index.js";

describe("healthResponseSchema", () => {
  it("accepts a valid health payload", () => {
    const payload: HealthResponse = {
      status: "ok",
      service: "fieldfix-api",
      version: "0.1.0",
      uptimeSeconds: 12.5,
      timestamp: new Date().toISOString(),
    };
    expect(healthResponseSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects a non-ok status or bad timestamp", () => {
    expect(
      healthResponseSchema.safeParse({
        status: "degraded",
        service: "fieldfix-api",
        version: "0.1.0",
        uptimeSeconds: 1,
        timestamp: new Date().toISOString(),
      }).success,
    ).toBe(false);
    expect(
      healthResponseSchema.safeParse({
        status: "ok",
        service: "fieldfix-api",
        version: "0.1.0",
        uptimeSeconds: 1,
        timestamp: "not-a-date",
      }).success,
    ).toBe(false);
  });
});

describe("apiErrorSchema", () => {
  it("accepts the standard error envelope", () => {
    expect(
      apiErrorSchema.safeParse({
        error: { code: "not_found", message: "No such route." },
      }).success,
    ).toBe(true);
  });
});
