import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
const host =
  process.env.API_HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const app = await createApp();

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ event: "server.shutdown", signal }, "Stopping Lore API");
  await app.close();
  process.exit(0);
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port, host });
app.log.info({ event: "server.started", port, host }, "Lore API is ready");
