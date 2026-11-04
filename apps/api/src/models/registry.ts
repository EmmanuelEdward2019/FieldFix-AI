import type { ModelProvider } from "./types.js";

/**
 * Provider registry. Lookups are exact: requesting an unknown provider
 * throws instead of silently substituting another model.
 */
export class ModelProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>();
  private defaultId: string | null = null;

  register(provider: ModelProvider, options: { isDefault?: boolean } = {}): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Model provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
    if (options.isDefault === true || this.defaultId === null) {
      this.defaultId = provider.id;
    }
  }

  get(id: string): ModelProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      const known = [...this.providers.keys()].join(", ") || "(none)";
      throw new Error(`Unknown model provider: ${id}. Registered: ${known}.`);
    }
    return provider;
  }

  getDefault(): ModelProvider {
    if (this.defaultId === null) {
      throw new Error("No model provider registered.");
    }
    return this.get(this.defaultId);
  }

  ids(): string[] {
    return [...this.providers.keys()];
  }
}
