import { afterEach, describe, expect, it } from "vitest";
import { getApiBaseUrl } from "./env";

const ORIGINAL = process.env.NEXT_PUBLIC_API_URL;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = ORIGINAL;
  }
});

describe("getApiBaseUrl", () => {
  it("defaults to the local API port", () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    expect(getApiBaseUrl()).toBe("http://localhost:3001");
  });

  it("trims whitespace and trailing slashes", () => {
    process.env.NEXT_PUBLIC_API_URL = "  http://api:4000///  ";
    expect(getApiBaseUrl()).toBe("http://api:4000");
  });
});
