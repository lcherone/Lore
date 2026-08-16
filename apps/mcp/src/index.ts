import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { validateKnowledgeProposal } from "@lore/core/index.js";
import { createDemoSnapshot, getDemoEvidence } from "@lore/shared/demo-data.js";
import { proposalPayloadSchema } from "@lore/shared/schemas.js";
import { ImpactGraph } from "@lore/impact/index.js";
import { CliRuntime } from "../../cli/src/runtime.js";

const runtime = new CliRuntime(process.env.LORE_REPOSITORY_PATH ?? process.cwd());
const server = new McpServer({ name: "lore", version: "0.1.0" });

const toStructuredContent = (value: unknown): Record<string, unknown> => {
  if (Array.isArray(value)) return { items: value };
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return { value };
};

const result = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: toStructuredContent(value)
});

server.registerTool(
  "lore_prepare_task",
  {
    title: "Prepare task context",
    description: "Deterministically resolve task concepts, affected code, applicable knowledge, policies, regressions, and tests before changes.",
    inputSchema: z.object({ task: z.string().min(3), paths: z.array(z.string()).max(100).optional() })
  },
  async ({ task, paths }) => result(await runtime.prepare(task, paths))
);

server.registerTool(
  "lore_get_context",
  {
    title: "Get current Lore context",
    description: "Return the latest mandatory, high-priority, advisory, warning, provenance, and unknown context.",
    inputSchema: z.object({ task: z.string().min(3).optional(), paths: z.array(z.string()).max(100).optional() })
  },
  async ({ task, paths }) => {
    const context = task ? await runtime.prepare(task, paths) : await runtime.project.readContext();
    return result(context ?? { mandatory: [], highPriority: [], advisory: [], warnings: [], message: "No context prepared" });
  }
);

server.registerTool(
  "lore_search",
  {
    title: "Search Lore",
    description: "Hybrid keyword and structured search across knowledge, evidence, and indexed symbols.",
    inputSchema: z.object({ query: z.string().min(2), kind: z.string().optional() })
  },
  async ({ query, kind }) => {
    const search = await runtime.search(query);
    if (!kind || !Array.isArray(search.knowledge)) return result(search);
    return result({
      ...search,
      knowledge: search.knowledge.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object" && "kind" in item && (item as Record<string, unknown>).kind === kind
      )
    });
  }
);

server.registerTool(
  "lore_lookup_symbol",
  {
    title: "Look up a symbol",
    description: "Resolve indexed code entities by qualified name or path.",
    inputSchema: z.object({ symbol: z.string().min(1) })
  },
  async ({ symbol }) => {
    const index = await runtime.graphData();
    return result(new ImpactGraph(index.entities, index.relationships).findEntities(symbol).slice(0, 20));
  }
);

server.registerTool(
  "lore_find_history",
  {
    title: "Find Git history",
    description: "Return bounded local Git history for a repository path without shell interpolation.",
    inputSchema: z.object({ path: z.string().optional(), limit: z.number().int().min(1).max(500).default(50) }),
    outputSchema: z.object({
      path: z.string().nullable(),
      count: z.number().int().nonnegative(),
      commits: z.array(
        z.object({
          sha: z.string(),
          occurredAt: z.string(),
          subject: z.string(),
          paths: z.array(z.string())
        })
      )
    })
  },
  async ({ path, limit }) => {
    const commits = await runtime.git.history(runtime.project.root, path, limit);
    return result({ path: path ?? null, count: commits.length, commits });
  }
);

server.registerTool(
  "lore_get_rules",
  {
    title: "Get engineering rules",
    description: "Return active rules and explicit policies; preferences remain separate.",
    inputSchema: z.object({ repositoryId: z.string().optional() })
  },
  async ({ repositoryId }) => {
    const authority = await runtime.knowledge();
    return result({
      mode: authority.mode,
      organisationId: authority.organisationId,
      repositoryId: authority.repositoryId,
      policies: authority.policies.filter((item) => !repositoryId || !item.repositoryId || item.repositoryId === repositoryId),
      rules: authority.items.filter((item) => item.kind === "rule" && (!repositoryId || !item.repositoryId || item.repositoryId === repositoryId))
    });
  }
);

server.registerTool(
  "lore_get_decisions",
  {
    title: "Get engineering decisions",
    description: "Return active, evidence-backed decisions separately from rules and preferences.",
    inputSchema: z.object({ query: z.string().optional() })
  },
  async ({ query }) => {
    const authority = await runtime.knowledge();
    const needle = query?.toLowerCase();
    return result(
      authority.items.filter(
        (item) => item.kind === "decision" && (!needle || `${item.title} ${item.statement}`.toLowerCase().includes(needle))
      )
    );
  }
);

server.registerTool(
  "lore_get_impact",
  {
    title: "Get bounded impact",
    description: "Traverse deterministic and historical relationships with explicit depth, confidence, and node limits.",
    inputSchema: z.object({ symbols: z.array(z.string()).min(1).max(20), maxDepth: z.number().int().min(1).max(5).default(3) })
  },
  async ({ symbols, maxDepth }) => {
    const index = await runtime.graphData();
    const graph = new ImpactGraph(index.entities, index.relationships);
    const seeds = symbols.flatMap((symbol) => graph.findEntities(symbol).slice(0, 2));
    return result({
      seeds,
      impact: graph.traverse(seeds.map((entity) => entity.id), {
        maxDepth,
        maximumNodes: 80,
        minimumConfidence: 0.3
      })
    });
  }
);

server.registerTool(
  "lore_verify_change",
  {
    title: "Verify current change",
    description: "Independently inspect Git diff, impact, rules, policies, regressions, and test gaps.",
    inputSchema: z.object({ task: z.string().min(3).optional() })
  },
  async ({ task }) => result(await runtime.verify(task))
);

server.registerTool(
  "lore_explain",
  {
    title: "Explain code history and intent",
    description: "Explain what a file or symbol does, why it exists, related evidence, consumers, and tests.",
    inputSchema: z.object({ target: z.string().min(1) })
  },
  async ({ target }) => result((await runtime.explain(target)) ?? { target, message: "No indexed entity matched" })
);

server.registerTool(
  "lore_propose_knowledge",
  {
    title: "Validate a knowledge proposal",
    description: "Validate a proposal and return deterministic errors, duplicates, and contradictions. This tool never mutates knowledge.",
    inputSchema: z.object({ proposal: proposalPayloadSchema, repositoryId: z.string().optional() })
  },
  async ({ proposal, repositoryId }) => {
    if (await runtime.mode() !== "demo") {
      return result({
        accepted: false,
        mode: await runtime.mode(),
        message: "Knowledge proposal validation is available through the Lore service review workflow; fixture validation requires explicit demo mode."
      });
    }
    const snapshot = createDemoSnapshot();
    return result(
      validateKnowledgeProposal({
        organisationId: snapshot.organisation.id,
        ...(repositoryId ? { repositoryId } : {}),
        payload: proposal,
        evidence: getDemoEvidence(),
        existingKnowledge: snapshot.knowledge,
        humanInitiated: false
      })
    );
  }
);

await server.connect(new StdioServerTransport());
