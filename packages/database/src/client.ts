import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for the persistent Lore runtime");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
