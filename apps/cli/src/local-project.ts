import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import type { CodeEntity, CodeRelationship, ContextPackage, SafetyReport } from "@lore/shared/types.js";
import { DEMO_ORGANISATION_ID, DEMO_REPOSITORY_ID } from "@lore/shared/demo-data.js";

const configSchema = z.object({
  repositoryId: z.string().min(1),
  organisationId: z.string().min(1),
  organisation: z.string().min(1),
  repository: z.string().min(1),
  mode: z.enum(["local", "service", "demo"]).default("local"),
  defaultAgent: z.enum(["codex", "claude", "cursor"]).default("codex"),
  apiUrl: z.string().url().default("http://127.0.0.1:3001"),
  tests: z.record(z.string(), z.string()).default({})
});

const MAX_STATE_BYTES = 50_000_000;

export type LocalConfig = z.infer<typeof configSchema>;

export const defaultConfig: LocalConfig = {
  repositoryId: DEMO_REPOSITORY_ID,
  organisationId: DEMO_ORGANISATION_ID,
  organisation: "acme-engineering",
  repository: "local/repository",
  mode: "local",
  defaultAgent: "codex",
  apiUrl: "http://127.0.0.1:3001",
  tests: {}
};

export class LocalProject {
  readonly root: string;
  readonly loreDirectory: string;

  public constructor(root = process.cwd()) {
    this.root = resolve(root);
    this.loreDirectory = resolve(this.root, ".lore");
  }

  async initialize(overrides: Partial<LocalConfig> = {}): Promise<LocalConfig> {
    await mkdir(this.loreDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.loreDirectory, 0o700);
    const existing = await this.readConfig().catch(() => defaultConfig);
    const config = configSchema.parse({ ...existing, ...overrides });
    await this.#writeJson("config.json", config);
    await this.#writeText(
      "AGENT_INSTRUCTIONS.md",
      [
        "# This repository uses Lore",
        "",
        "Before making changes, obtain task context from Lore and review mandatory policies and high-confidence decisions.",
        "Before completion, run `lore verify` and resolve blockers.",
        "Dynamic knowledge remains in Lore; do not copy the full knowledge base into AGENTS.md.",
        ""
      ].join("\n")
    );
    return config;
  }

  async readConfig(): Promise<LocalConfig> {
    return configSchema.parse(JSON.parse(await this.#readText("config.json", 1_000_000)));
  }

  async readConfigOrDefault(): Promise<LocalConfig> {
    return this.readConfig().catch(() => defaultConfig);
  }

  async saveIndex(index: { entities: CodeEntity[]; relationships: CodeRelationship[]; indexedAt: string; commit?: string }): Promise<void> {
    await mkdir(this.loreDirectory, { recursive: true, mode: 0o700 });
    await this.#writeJson("index.json", index);
  }

  async readIndex(): Promise<{ entities: CodeEntity[]; relationships: CodeRelationship[]; indexedAt: string; commit?: string } | undefined> {
    try {
      return JSON.parse(await this.#readText("index.json")) as {
        entities: CodeEntity[];
        relationships: CodeRelationship[];
        indexedAt: string;
        commit?: string;
      };
    } catch (error) {
      if (!this.#isMissing(error)) throw error;
      return undefined;
    }
  }

  async saveContext(context: ContextPackage, markdown: string): Promise<void> {
    await mkdir(this.loreDirectory, { recursive: true, mode: 0o700 });
    await this.#writeJson("context.json", context);
    await this.#writeText("LORE_CONTEXT.md", markdown);
  }

  async readContext(): Promise<ContextPackage | undefined> {
    try {
      return JSON.parse(await this.#readText("context.json")) as ContextPackage;
    } catch (error) {
      if (!this.#isMissing(error)) throw error;
      return undefined;
    }
  }

  async saveReport(report: SafetyReport): Promise<void> {
    await mkdir(resolve(this.loreDirectory, "reports"), { recursive: true, mode: 0o700 });
    await this.#writeText(resolve("reports", `${report.id}.json`), `${JSON.stringify(report, null, 2)}\n`);
    await this.#writeJson("latest-report.json", report);
  }

  async saveSession(session: Record<string, unknown>): Promise<void> {
    await mkdir(this.loreDirectory, { recursive: true, mode: 0o700 });
    await this.#writeJson("session.json", session);
  }

  async readSession(): Promise<Record<string, unknown> | undefined> {
    try {
      return JSON.parse(await this.#readText("session.json")) as Record<string, unknown>;
    } catch (error) {
      if (!this.#isMissing(error)) throw error;
      return undefined;
    }
  }

  async #writeJson(name: string, value: unknown): Promise<void> {
    await this.#writeText(name, `${JSON.stringify(value, null, 2)}\n`);
  }

  async #writeText(name: string, content: string): Promise<void> {
    const target = resolve(this.loreDirectory, name);
    const parent = resolve(target, "..");
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await chmod(parent, 0o700);
    await this.#assertSafeExistingPath(target, false);
    const temporary = resolve(parent, `.${name.split("/").at(-1)}.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, target);
      await chmod(target, 0o600);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async #readText(name: string, maximumBytes = MAX_STATE_BYTES): Promise<string> {
    const target = resolve(this.loreDirectory, name);
    const metadata = await this.#assertSafeExistingPath(target, true);
    if (metadata.size > maximumBytes) throw new Error(`Lore state file ${name} exceeds the ${maximumBytes}-byte safety limit`);
    return readFile(target, "utf8");
  }

  async #assertSafeExistingPath(target: string, required: boolean) {
    try {
      const metadata = await lstat(target);
      if (metadata.isSymbolicLink()) throw new Error(`Lore refuses symbolic-link state path: ${target}`);
      if (!metadata.isFile()) throw new Error(`Lore state path is not a regular file: ${target}`);
      const currentUser = process.getuid?.();
      if (currentUser != null && metadata.uid !== currentUser) throw new Error(`Lore state file is owned by another user: ${target}`);
      if ((metadata.mode & 0o077) !== 0) throw new Error(`Lore state file permissions are too broad: ${target}`);
      return metadata;
    } catch (error) {
      if (!required && this.#isMissing(error)) return { size: 0 } as Awaited<ReturnType<typeof lstat>>;
      throw error;
    }
  }

  #isMissing(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
  }
}
