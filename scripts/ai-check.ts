import "dotenv/config";
import { z } from "zod";
import { createBundledMockAIProvider, createConfiguredAIProvider } from "@lore/ai/index.js";

const schema = z.object({
  status: z.literal("ready"),
  capability: z.literal("structured-evidence-extraction")
}).strict();

const configured = createConfiguredAIProvider(process.env, createBundledMockAIProvider());
if (configured.name !== "openai") {
  throw new Error("AI_PROVIDER is not openai; Lore would use the deterministic mock provider");
}

const result = await configured.provider.generateStructured({
  schemaName: "lore_ai_readiness",
  schema,
  promptVersion: "lore-ai-readiness/v1",
  systemInstructions: "You are validating Lore's structured extraction connection.",
  applicationInstructions: "Return status ready and capability structured-evidence-extraction.",
  untrustedSourceContent: JSON.stringify({ check: "No customer or repository data is sent by this readiness test." }),
  parse: (value) => schema.parse(value)
});

process.stdout.write(`✓ OpenAI Responses API returned validated structured output with ${configured.model}\n`);
process.stdout.write(`✓ Capability: ${result.capability}\n`);
