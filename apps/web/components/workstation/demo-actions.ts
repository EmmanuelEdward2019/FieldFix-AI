/**
 * Guest loop actions: the demo-mode counterpart to live API actions.
 * Recording and sample analysis mutate the tab-local guest session only —
 * they never call the API and every result is labelled simulated.
 */
export interface DemoLoopActions {
  analyzing: boolean;
  analysisStep: number;
  runSampleAnalysis: () => void;
  recordResult: (testId: string, option: string, observation: string) => void;
  recordingId: string | null;
  safetyBlocked: boolean;
}
