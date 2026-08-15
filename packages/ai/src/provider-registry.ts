import type { AIProvider } from "@lore/core/index.js";

/** Keeps provider selection at the composition root instead of domain code. */
export function selectAIProvider(name: string, providers: Record<string, AIProvider>): AIProvider {
  const provider = providers[name];
  if (!provider) {
    throw new Error(`AI provider '${name}' is not configured. Available providers: ${Object.keys(providers).join(", ") || "none"}`);
  }
  return provider;
}
