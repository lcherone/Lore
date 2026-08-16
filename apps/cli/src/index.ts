import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { Command } from "commander";
import { formatAgentInstructions, formatContextPackage } from "@lore/context/index.js";
import { ImpactGraph } from "@lore/impact/index.js";
import { formatSafetyReport } from "@lore/reporting/index.js";
import { CliRuntime } from "./runtime.js";

const program = new Command();
program
  .name("lore")
  .description("Evidence-backed engineering memory and change governance")
  .version("0.1.0")
  .option("--json", "emit machine-readable JSON");

const print = (value: unknown, human: string): void => {
  if (program.opts<{ json?: boolean }>().json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${human}\n`);
};

const runtime = (): CliRuntime => new CliRuntime(process.cwd());

program
  .command("init")
  .description("initialise Lore in the current repository")
  .option("--repository <owner/name>", "repository identity")
  .option("--organisation <slug>", "organisation slug")
  .option("--mode <mode>", "local, service, or demo", "local")
  .action(async (options: { repository?: string; organisation?: string; mode: string }) => {
    if (!new Set(["local", "service", "demo"]).has(options.mode)) throw new Error("Mode must be local, service, or demo");
    const project = runtime().project;
    const config = await project.initialize({
      ...(options.repository ? { repository: options.repository } : {}),
      ...(options.organisation ? { organisation: options.organisation } : {}),
      mode: options.mode as "local" | "service" | "demo"
    });
    print(config, `Lore initialised in ${project.loreDirectory}\nNext: lore index`);
  });

program
  .command("connect")
  .description("connect this checkout to a repository in the local Lore service")
  .argument("[repository]", "GitHub OWNER/REPOSITORY; local Lore discovers its IDs")
  .option("--repository-id <id>", "explicit repository ID for remote/SaaS service mode")
  .option("--organisation-id <id>", "explicit organisation ID for remote/SaaS service mode")
  .option("--api-url <url>", "Lore API URL", "http://127.0.0.1:3001")
  .option("--token-file <path>", "owner-only file containing a Lore API token")
  .action(async (repository: string | undefined, options: { repositoryId?: string; organisationId?: string; apiUrl: string; tokenFile?: string }) => {
    const project = runtime().project;
    let repositoryId = options.repositoryId;
    let organisationId = options.organisationId;
    let organisation = "service";
    let repositoryName = repository;
    if (!repositoryId || !organisationId) {
      if (!repository) throw new Error("Pass OWNER/REPOSITORY for local discovery, or both --organisation-id and --repository-id for remote service mode");
      const hostname = new URL(options.apiUrl).hostname;
      if (!new Set(["localhost", "127.0.0.1", "::1"]).has(hostname)) {
        throw new Error("Automatic repository discovery is loopback-only; pass explicit IDs and --token-file for a remote service");
      }
      const response = await fetch(new URL("/api/bootstrap", options.apiUrl));
      const snapshot = await response.json() as { message?: string; organisation?: { id: string; slug: string }; repositories?: Array<{ id: string; owner: string; name: string }> };
      if (!response.ok) throw new Error(snapshot.message ?? `Lore API returned HTTP ${response.status}`);
      const match = snapshot.repositories?.find((item) => `${item.owner}/${item.name}`.toLowerCase() === repository.toLowerCase());
      if (!match || !snapshot.organisation) {
        throw new Error(`${repository} is not connected to the active local Lore organisation. Add it in Repositories first.`);
      }
      repositoryId = match.id;
      organisationId = snapshot.organisation.id;
      organisation = snapshot.organisation.slug;
      repositoryName = `${match.owner}/${match.name}`;
    }
    const config = await project.initialize({
      repositoryId,
      organisationId,
      organisation,
      ...(repositoryName ? { repository: repositoryName } : {}),
      apiUrl: options.apiUrl,
      ...(options.tokenFile ? { apiTokenFile: resolve(options.tokenFile) } : {}),
      mode: "service"
    });
    print(config, `Connected ${config.repository} to ${options.apiUrl}\nNext: lore index`);
  });

program
  .command("index")
  .description("index source symbols and relationships in the current repository")
  .action(async () => {
    const result = await runtime().indexRepository();
    print(result, `Indexed ${result.filesScanned} files\n${result.entities} entities · ${result.relationships} relationships · ${result.durationMs}ms`);
  });

program
  .command("status")
  .description("show local Lore configuration and index state")
  .action(async () => {
    const local = runtime();
    const [repository, context, session] = await Promise.all([
      local.repository(),
      local.project.readContext(),
      local.project.readSession()
    ]);
    const mode = await local.mode();
    const result = { mode, repository, context: context ? { id: context.id, task: context.task.text, generatedAt: context.generatedAt } : null, session };
    print(
      result,
      [`Mode: ${mode}`, `Repository: ${repository.owner}/${repository.name}`, `Index: ${repository.entityCount} entities · ${repository.relationshipCount} relationships`, `Context: ${context?.task.text ?? "not prepared"}`, `Session: ${typeof session?.status === "string" ? session.status : "none"}`].join("\n")
    );
  });

program
  .command("prepare")
  .argument("<task...>", "ticket or task description")
  .description("prepare ranked, evidence-backed context before code changes")
  .action(async (taskParts: string[]) => {
    const context = await runtime().prepare(taskParts.join(" "));
    print(context, formatContextPackage(context));
  });

program
  .command("context")
  .description("show the latest prepared context")
  .action(async () => {
    const context = await runtime().project.readContext();
    if (!context) throw new Error("No context has been prepared. Run `lore prepare \"task\"` first.");
    print(context, formatContextPackage(context));
  });

program
  .command("explain")
  .argument("<target>", "file or symbol")
  .description("explain what code does, why it exists, and what it affects")
  .action(async (target: string) => {
    const result = await runtime().explain(target);
    if (!result) throw new Error(`No indexed entity matched '${target}'`);
    const human = [
      result.target,
      result.purpose,
      "",
      "Decisions:",
      ...(result.decisions.length ? result.decisions.map((item) => `- ${item.title}: ${item.rationale}`) : ["- None found"]),
      "",
      "File history:",
      ...(result.timeline.length ? result.timeline.map((commit) => `- ${commit.sha.slice(0, 8)} ${commit.subject || "No commit subject"} (${commit.occurredAt.slice(0, 10)})`) : ["- No local history found"]),
      "",
      "Affected consumers:",
      ...(result.affectedConsumers.length ? result.affectedConsumers.map((item) => `- ${item.entity.qualifiedName} — ${item.reason}`) : ["- None proven"]),
      "",
      "Tests:",
      ...(result.tests.length ? result.tests.map((item) => `- ${item.entity.path}`) : ["- None linked"])
    ].join("\n");
    print(result, human);
  });

program
  .command("search")
  .argument("<query...>")
  .description("search knowledge, evidence, and indexed symbols")
  .action(async (queryParts: string[]) => {
    const result = await runtime().search(queryParts.join(" ")) as { knowledge?: unknown[]; evidence?: unknown[]; entities?: unknown[]; mode?: string };
    print(result, `${result.knowledge?.length ?? 0} knowledge · ${result.evidence?.length ?? 0} evidence · ${result.entities?.length ?? 0} symbols · ${result.mode ?? "service"} authority`);
  });

program
  .command("impact")
  .argument("<target>")
  .description("show bounded downstream impact for a file or symbol")
  .action(async (target: string) => {
    const data = await runtime().graphData();
    const graph = new ImpactGraph(data.entities, data.relationships);
    const seeds = graph.findEntities(target).slice(0, 3);
    const result = graph.traverse(seeds.map((entity) => entity.id), { maxDepth: 3, maximumNodes: 50, minimumConfidence: 0.3 });
    print(result, result.length ? result.map((item) => `${Math.round(item.confidence * 100)}%  ${item.entity.qualifiedName}\n     ${item.reason}`).join("\n") : "No impact relationships found.");
  });

program
  .command("verify")
  .description("independently verify the current Git diff")
  .option("--task <task>")
  .action(async (options: { task?: string }) => {
    const report = await runtime().verify(options.task);
    print(report, formatSafetyReport(report));
    if (report.blockers.length > 0) process.exitCode = 2;
  });

const session = program.command("session").description("manage agent sessions");
session
  .command("start")
  .argument("<task...>")
  .option("--agent <agent>", "agent type", "codex")
  .action(async (task: string[], options: { agent: string }) => {
    const result = await runtime().startSession(task.join(" "), options.agent);
    print(result, `Session ${String(result.id)} started\nContext: .lore/LORE_CONTEXT.md`);
  });
session.command("status").action(async () => {
  const result = await runtime().project.readSession();
  print(result ?? {}, result ? `Session ${String(result.id)} · ${String(result.status)}\n${String(result.task)}` : "No active session");
});
session.command("stop").action(async () => {
  const local = runtime();
  const current = await local.project.readSession();
  if (!current) throw new Error("No session exists");
  const report = await local.verify(typeof current.task === "string" ? current.task : "Unspecified task");
  const stopped = { ...current, status: "completed", completedAt: new Date().toISOString(), reportId: report.id };
  await local.project.saveSession(stopped);
  print(stopped, `Session completed · Risk ${report.risk}`);
});

const knowledge = program.command("knowledge").description("inspect and export organisational knowledge");
knowledge.command("list").action(async () => {
  const authority = await runtime().knowledge();
  print(authority, authority.items.map((item) => `${item.id}\t${item.kind}\t${Math.round(item.confidence * 100)}%\t${item.title}`).join("\n") || `No knowledge in ${authority.mode} mode`);
});
knowledge.command("show").argument("<id>").action(async (id: string) => {
  const item = (await runtime().knowledge()).items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Knowledge item '${id}' was not found`);
  print(item, `${item.title}\n${item.statement}\n\nWhy: ${item.rationale}\nEvidence: ${item.evidenceIds.join(", ") || "none"}`);
});
knowledge
  .command("export")
  .option("--format <format>", "json or markdown", "json")
  .option("--output <path>")
  .action(async (options: { format: string; output?: string }) => {
    const items = (await runtime().knowledge()).items;
    const content = options.format === "markdown"
      ? items.map((item) => `## ${item.title}\n\n${item.statement}\n\n- Kind: ${item.kind}\n- Confidence: ${Math.round(item.confidence * 100)}%\n- Evidence: ${item.evidenceIds.join(", ") || "none"}`).join("\n\n")
      : `${JSON.stringify(items, null, 2)}\n`;
    if (options.output) {
      await writeFile(resolve(options.output), content, "utf8");
      print({ output: resolve(options.output), count: items.length }, `Exported ${items.length} items to ${resolve(options.output)}`);
    } else process.stdout.write(content);
  });
knowledge
  .command("import")
  .argument("<path>", "JSON, Markdown, AGENTS.md, CONTRIBUTING.md, or ADR file")
  .option("--organisation-wide", "do not scope imported knowledge to the current repository")
  .action(async (path: string, options: { organisationWide?: boolean }) => {
    const local = runtime();
    const config = await local.project.readConfigOrDefault();
    if (config.mode !== "service") throw new Error("Knowledge import requires service mode. Run `lore connect` first.");
    const absolutePath = resolve(path);
    const sourceName = basename(absolutePath);
    const content = await readFile(absolutePath, "utf8");
    let payload: Record<string, unknown>;
    if (extname(absolutePath).toLowerCase() === ".json") {
      const parsed = JSON.parse(content) as unknown;
      const sourceItems = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { knowledge?: unknown[] }).knowledge)
          ? (parsed as { knowledge: unknown[] }).knowledge
          : [];
      const allowedKinds = new Set(["fact", "decision", "rule", "preference", "regression", "warning"]);
      const items = sourceItems.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const item = value as Record<string, unknown>;
        if (typeof item.title !== "string" || typeof item.statement !== "string") return [];
        const kind = typeof item.kind === "string" && allowedKinds.has(item.kind) ? item.kind : "fact";
        return [{
          ...(!options.organisationWide ? { repositoryId: config.repositoryId } : {}),
          kind,
          title: item.title,
          statement: item.statement,
          rationale: typeof item.rationale === "string" ? item.rationale : `Imported from ${sourceName}.`,
          severity: typeof item.severity === "string" ? item.severity : "suggestion",
          scope: item.scope && typeof item.scope === "object" ? item.scope : {},
          sourceName
        }];
      });
      payload = { items };
    } else {
      payload = {
        format: "markdown",
        content,
        sourceName,
        ...(!options.organisationWide ? { repositoryId: config.repositoryId } : {})
      };
    }
    const response = await fetch(`${config.apiUrl}/api/knowledge-import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json() as { imported?: number; message?: string };
    if (!response.ok) throw new Error(result.message ?? `Knowledge import failed with HTTP ${response.status}`);
    print(result, `Imported ${result.imported ?? 0} knowledge item(s) from ${sourceName}`);
  });

program
  .command("agent")
  .argument("<agent>", "codex (other agents use Lore MCP)")
  .argument("<task...>", "task description")
  .description("prepare mandatory context, run an agent, observe changes, then verify")
  .action(async (agent: string, taskParts: string[]) => {
    if (agent !== "codex") throw new Error("The verified interactive wrapper currently supports Codex. Connect other agents through Lore MCP.");
    const local = runtime();
    const task = taskParts.join(" ");
    const sessionState = await local.startSession(task, agent);
    const observed = new Set<string>();
    let checking = false;
    const timer = setInterval(() => {
      if (checking) return;
      checking = true;
      void local.git
        .changedFiles(local.project.root, typeof sessionState.baseCommit === "string" ? sessionState.baseCommit : undefined)
        .then(async (files) => {
          const changed = files.map((file) => file.path);
          const discovered = changed.filter((path) => !observed.has(path));
          changed.forEach((path) => observed.add(path));
          if (discovered.length > 0) {
            await local.refreshSessionContext(task, changed);
            process.stderr.write(`\nLore refreshed .lore/LORE_CONTEXT.md for: ${discovered.join(", ")}. Review it before completion.\n`);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          checking = false;
        });
    }, 2_000);
    const context = await local.project.readContext();
    if (!context) throw new Error("Lore did not prepare an agent context");
    const agentPrompt = [
      task,
      "",
      "Lore prepared the following evidence-backed context before this session. Follow mandatory policies, use the listed decisions as scoped guidance, and run the requested verification before completion. Lore may refresh .lore/LORE_CONTEXT.md when the working set changes; read that file again before finalising.",
      "",
      formatAgentInstructions(context)
    ].join("\n");
    const child = spawn(agent, ["-C", local.project.root, agentPrompt], {
      cwd: local.project.root,
      shell: false,
      stdio: "inherit",
      env: { ...process.env, LORE_CONTEXT_FILE: resolve(local.project.loreDirectory, "LORE_CONTEXT.md") }
    });
    const exitCode = await new Promise<number>((resolveExit, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolveExit(code ?? 1));
    });
    clearInterval(timer);
    if (exitCode !== 0) {
      await local.abandonSession(`Codex exited with status ${exitCode}`);
      process.stderr.write(`Lore retained the session as abandoned because Codex exited with status ${exitCode}.\n`);
      process.exitCode = exitCode;
      return;
    }
    const report = await local.verify(task);
    process.stdout.write(`${formatSafetyReport(report)}\n`);
    process.exitCode = report.blockers.length > 0 ? 2 : exitCode;
  });

program.configureOutput({
  outputError: (value, write) => write(`Lore error: ${value}`)
});

try {
  await program.parseAsync(process.argv);
} catch (error) {
  process.stderr.write(`Lore error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
