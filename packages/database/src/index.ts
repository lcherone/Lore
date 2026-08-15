import type { LoreStore } from "@lore/core/index.js";
import { createPrismaClient } from "./client.js";
import { InMemoryLoreStore } from "./memory-store.js";
import { PrismaLoreStore } from "./prisma-store.js";

export * from "./client.js";
export * from "./job-dispatcher.js";
export * from "./memory-store.js";
export * from "./prisma-store.js";

export function createLoreStore(environment = process.env): LoreStore {
  if (environment.DEMO_MODE !== "false" || !environment.DATABASE_URL) return new InMemoryLoreStore();
  return new PrismaLoreStore(createPrismaClient(environment.DATABASE_URL));
}
