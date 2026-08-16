import type { LoreStore } from "@lore/core/index.js";
import { createPrismaClient } from "./client.js";
import { InMemoryLoreStore } from "./memory-store.js";
import { PrismaLoreStore } from "./prisma-store.js";

export * from "./client.js";
export * from "./job-dispatcher.js";
export * from "./job-ledger.js";
export * from "./memory-store.js";
export * from "./prisma-store.js";

export function createLoreStore(environment = process.env): LoreStore {
  if (environment.DEMO_MODE === "true") {
    if (environment.NODE_ENV === "production") {
      throw new Error("Demo fixtures cannot be used by the production Lore runtime");
    }
    return new InMemoryLoreStore();
  }
  return new PrismaLoreStore(createPrismaClient(environment.DATABASE_URL));
}
