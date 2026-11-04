import { describe, expect, it } from "vitest";
import { MANUFACTURERS, modelsFor } from "./device-options";

describe("device options", () => {
  it("covers every device type with manufacturers", () => {
    for (const device of ["laptop", "desktop", "smartphone"] as const) {
      expect(MANUFACTURERS[device].length).toBeGreaterThan(0);
    }
  });

  it("offers models for the main brands", () => {
    expect(modelsFor("Apple", "laptop")).toContain("MacBook Pro");
    expect(modelsFor("Apple", "smartphone")).toContain("iPhone 16");
    expect(modelsFor("Dell", "desktop")).toContain("XPS Desktop");
    expect(modelsFor("Samsung", "smartphone")).toContain("Galaxy S25");
  });

  it("returns an empty list for unknown combinations", () => {
    expect(modelsFor("Unknown", "laptop")).toEqual([]);
    expect(modelsFor("Apple", "desktop")).not.toContain("iPhone 16");
  });
});
