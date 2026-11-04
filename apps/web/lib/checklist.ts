import {
  recordTestResultSchema,
  type RecordTestResult,
} from "@fieldfix/contracts";

/**
 * Local reducer for guided-test result capture. The dashboard has no
 * results endpoint yet, so capture stays client-side and the UI labels
 * it clearly as unsaved demo input.
 */

export interface ChecklistState {
  selectedOption: string | null;
  observation: string;
  submitted: RecordTestResult | null;
  error: string | null;
}

export type ChecklistAction =
  | { type: "select"; value: string }
  | { type: "notes"; value: string }
  | { type: "submit"; validOptions: string[] }
  | { type: "reset" };

export function initialChecklistState(): ChecklistState {
  return { selectedOption: null, observation: "", submitted: null, error: null };
}

export function checklistReducer(
  state: ChecklistState,
  action: ChecklistAction,
): ChecklistState {
  switch (action.type) {
    case "select":
      return { ...state, selectedOption: action.value, error: null };
    case "notes":
      return { ...state, observation: action.value, error: null };
    case "reset":
      return initialChecklistState();
    case "submit": {
      if (state.selectedOption == null) {
        return { ...state, error: "Choose a result option first." };
      }
      if (!action.validOptions.includes(state.selectedOption)) {
        return { ...state, error: "That option is not valid for this test." };
      }
      const parsed = recordTestResultSchema.safeParse({
        selected_option: state.selectedOption,
        observation: state.observation.trim() || null,
      });
      if (!parsed.success) {
        return { ...state, error: "Result notes are too long." };
      }
      return { ...state, submitted: parsed.data, error: null };
    }
  }
}
