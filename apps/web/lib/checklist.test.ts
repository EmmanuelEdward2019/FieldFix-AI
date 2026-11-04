import { describe, expect, it } from "vitest";
import {
  checklistReducer,
  initialChecklistState,
} from "./checklist";

const OPTIONS = ["led-on", "led-off", "not-sure"];

describe("checklistReducer", () => {
  it("selects an option and records notes", () => {
    let state = initialChecklistState();
    state = checklistReducer(state, { type: "select", value: "led-off" });
    state = checklistReducer(state, { type: "notes", value: "Dark brick." });
    expect(state.selectedOption).toBe("led-off");
    expect(state.observation).toBe("Dark brick.");
    expect(state.error).toBeNull();
  });

  it("requires a selection before submit", () => {
    const state = checklistReducer(initialChecklistState(), {
      type: "submit",
      validOptions: OPTIONS,
    });
    expect(state.submitted).toBeNull();
    expect(state.error).toBe("Choose a result option first.");
  });

  it("rejects options outside the allowlist", () => {
    let state = initialChecklistState();
    state = checklistReducer(state, { type: "select", value: "bogus" });
    state = checklistReducer(state, { type: "submit", validOptions: OPTIONS });
    expect(state.submitted).toBeNull();
    expect(state.error).toBe("That option is not valid for this test.");
  });

  it("submits a valid capture and resets", () => {
    let state = initialChecklistState();
    state = checklistReducer(state, { type: "select", value: "led-off" });
    state = checklistReducer(state, {
      type: "submit",
      validOptions: OPTIONS,
    });
    expect(state.submitted).toMatchObject({ selected_option: "led-off" });
    expect(state.error).toBeNull();
    state = checklistReducer(state, { type: "reset" });
    expect(state).toEqual(initialChecklistState());
  });
});
