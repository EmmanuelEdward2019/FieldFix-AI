import { describe, expect, it } from "vitest";
import { screenTestSafety } from "../../src/diagnostics/safety-screen.js";

function screen(name: string, instructions: string[], objective = "Check something.") {
  return screenTestSafety({ name, objective, instructions, safety_notes: null });
}

describe("screenTestSafety", () => {
  it("passes benign external checks as safe", () => {
    expect(
      screen("Vent inspection", ["Power off.", "Shine a light into the vents."]).classification,
    ).toBe("safe");
    expect(
      screen("Adapter check", ["Verify the adapter LED glows steadily."]).matched,
    ).toEqual([]);
  });

  it("blocks chassis opening, live circuits, and battery abuse", () => {
    expect(
      screen("Internal probe", ["Open the chassis and probe live circuits."]).classification,
    ).toBe("blocked");
    expect(
      screen("Battery fix", ["Puncture the swollen cell to release gas."]).classification,
    ).toBe("blocked");
    expect(
      screen("Charge test", ["Charge the swollen battery and observe."]).classification,
    ).toBe("blocked");
    expect(
      screen("Bypass", ["Bypass the thermal protection and reboot."]).classification,
    ).toBe("blocked");
  });

  it("marks battery, heat, and sharp-edge work as caution", () => {
    expect(
      screen("Battery calibration", ["Charge to full, then discharge."]).classification,
    ).toBe("caution");
    expect(
      screen("Cracked screen check", ["Inspect the cracked screen for touch dead spots."])
        .classification,
    ).toBe("caution");
  });
});
