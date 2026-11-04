import { describe, expect, it } from "vitest";
import {
  ModelError,
  type CallModality,
  type ModelProvider,
  type ProviderPrompt,
  type ProviderTextResult,
} from "../../src/models/types.js";
import { SafetyScreeningService } from "../../src/safety/screening.js";

class ScriptedProvider implements ModelProvider {
  readonly id = "scripted";
  readonly modalities: readonly CallModality[] = ["text"];
  prompts: ProviderPrompt[] = [];

  constructor(private readonly behavior: { text: string } | { error: ModelError }) {}

  async complete(prompt: ProviderPrompt): Promise<ProviderTextResult> {
    this.prompts.push(prompt);
    if ("error" in this.behavior) {
      throw this.behavior.error;
    }
    return { text: this.behavior.text, model: "scripted-1", latencyMs: 1, attempts: 1 };
  }
}

describe("SafetyScreeningService", () => {
  it("parses a positive screen and sends structured output", async () => {
    const provider = new ScriptedProvider({
      text: JSON.stringify({
        hazard_suspected: true,
        categories: ["heat"],
        rationale: "User reports unusual heat.",
      }),
    });
    const screening = new SafetyScreeningService({ provider });
    const result = await screening.screenText("It gets unusually hot.", {
      deviceType: "smartphone",
    });
    expect(result).toEqual({
      hazard_suspected: true,
      categories: ["heat"],
      rationale: "User reports unusual heat.",
    });
    expect(provider.prompts).toHaveLength(1);
    const sent = provider.prompts[0]!;
    expect(sent.jsonSchema.strict).toBe(true);
    expect(sent.jsonSchema.name).toBe("hazard_screen");
    expect(sent.images).toEqual([]);
  });

  it("returns a negative screen unchanged", async () => {
    const provider = new ScriptedProvider({
      text: JSON.stringify({ hazard_suspected: false, categories: [], rationale: "" }),
    });
    const screening = new SafetyScreeningService({ provider });
    expect(await screening.screenText("Wifi is slow.")).toEqual({
      hazard_suspected: false,
      categories: [],
      rationale: "",
    });
  });

  it.each([
    ["provider failure", { error: new ModelError("unavailable", "down") }],
    ["malformed JSON", { text: "not json{" }],
    ["schema violation", { text: JSON.stringify({ hazard_suspected: "maybe" }) }],
  ])("degrades to null on %s", async (_label, behavior) => {
    const provider = new ScriptedProvider(
      behavior as { text: string } | { error: ModelError },
    );
    const screening = new SafetyScreeningService({ provider });
    await expect(screening.screenText("Anything.")).resolves.toBeNull();
  });

  it("skips empty text without calling the provider", async () => {
    const provider = new ScriptedProvider({ text: "{}" });
    const screening = new SafetyScreeningService({ provider });
    await expect(screening.screenText("   ")).resolves.toBeNull();
    expect(provider.prompts).toHaveLength(0);
  });
});
