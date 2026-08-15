import { describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/app.js";
import { InMemoryJobDispatcher, InMemoryLoreStore } from "@lore/database/index.js";
import type { ContextPackage, SafetyReport } from "@lore/shared/types.js";

describe("working API vertical slice", () => {
  it("prepares context, approves a candidate, verifies a change, and queues imports", async () => {
    const store = new InMemoryLoreStore();
    const jobs = new InMemoryJobDispatcher();
    const app = await createApp({ demoMode: true, logger: false, dependencies: { store, jobs } });
    const context = await app.inject({
      method: "POST",
      url: "/api/tasks/prepare",
      payload: { repositoryId: "repo_soho_ecom", task: "SS-6160 Update Avalara ShipFrom and ShipTo addresses" }
    });
    expect(context.statusCode).toBe(200);
    expect(context.json<ContextPackage>().historicalRegressions[0]!.item.title).toContain("Address role");

    const approved = await app.inject({
      method: "POST",
      url: "/api/knowledge-candidates/candidate_interfaces/approve",
      payload: { statement: "Application services should depend on repository interfaces.", reason: "Evidence reviewed by Casey" }
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: "active", confidence: 0.86 });

    const merged = await app.inject({
      method: "POST",
      url: "/api/knowledge-candidates/candidate_refund_tests/merge",
      payload: { targetId: "candidate_avalara", reason: "Same reviewed rule with supporting evidence" }
    });
    expect(merged.statusCode).toBe(200);
    expect(merged.json<{ evidenceIds: string[] }>().evidenceIds).toEqual(expect.arrayContaining(["ev6160", "ev782"]));
    expect((await store.getSnapshot("org_acme")).candidates.some((item) => item.id === "candidate_refund_tests")).toBe(false);

    const session = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { repositoryId: "repo_soho_ecom", task: "Update address code mapping", agentType: "codex" }
    });
    const sessionId = session.json<{ id: string }>().id;
    const persistedContext = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/refresh-context`
    });
    expect(persistedContext.statusCode).toBe(200);
    expect(persistedContext.json()).toMatchObject({ revision: 1 });
    const report = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/verify`,
      payload: { changedFiles: [{ path: "src/Tax/Avalara/AddressCode.php", status: "modified", additions: 3, deletions: 1, patch: "+return $role;" }] }
    });
    expect(report.statusCode).toBe(200);
    expect(["MEDIUM", "HIGH", "CRITICAL"]).toContain(report.json<SafetyReport>().risk);
    expect(report.json<SafetyReport>()).toMatchObject({ sessionId, contextId: persistedContext.json<{ id: string }>().id });
    expect((await store.getSnapshot("org_acme")).sessions.find((item) => item.id === sessionId)?.status).toBe("completed");
    const events = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/events` });
    expect(events.json<{ items: Array<{ sequence: number; type: string }> }>().items.map((event) => event.type)).toEqual([
      "started", "context_prepared", "verification_started", "verification_finished", "completed"
    ]);
    expect(events.json<{ items: Array<{ sequence: number }> }>().items.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);

    const abandonedSession = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { repositoryId: "repo_soho_ecom", task: "Interrupted agent run", agentType: "codex" }
    });
    const abandonedId = abandonedSession.json<{ id: string }>().id;
    expect((await app.inject({ method: "POST", url: `/api/sessions/${abandonedId}/abandon`, payload: { reason: "Agent process exited" } })).json()).toMatchObject({ status: "abandoned" });
    expect((await store.getSessionEvents("org_acme", abandonedId)).at(-1)).toMatchObject({ type: "abandoned", data: { reason: "Agent process exited" } });

    const queued = await app.inject({
      method: "POST",
      url: "/api/repositories/repo_soho_ecom/github-import",
      payload: { installationId: 123, limit: 250 }
    });
    expect(queued.statusCode).toBe(202);
    expect(jobs.jobs.some((job) => job.name === "github.import")).toBe(true);

    const retention = await app.inject({
      method: "PATCH",
      url: "/api/repositories/repo_soho_ecom/retention",
      payload: {
        retainRawPullRequestDiff: false,
        retainSummariesOnly: true,
        retainReviewComments: false,
        retainCodeSnippets: false
      }
    });
    expect(retention.statusCode).toBe(200);
    expect(retention.json()).toMatchObject({ retentionConfig: { retainSummariesOnly: true, retainReviewComments: false } });

    const importedMarkdown = await app.inject({
      method: "POST",
      url: "/api/knowledge-import",
      payload: {
        format: "markdown",
        sourceName: "CONTRIBUTING.md",
        repositoryId: "repo_soho_ecom",
        content: "# Deployment convention\n\nNever deploy without recording the release verification result."
      }
    });
    expect(importedMarkdown.statusCode).toBe(201);
    expect(importedMarkdown.json()).toMatchObject({ imported: 1, items: [{ kind: "rule", scope: { repository: "soho/ecom" } }] });

    const rejectedDeletion = await app.inject({
      method: "DELETE",
      url: "/api/repositories/repo_soho_ecom?confirm=wrong"
    });
    expect(rejectedDeletion.statusCode).toBe(400);

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/repositories/repo_soho_ecom?confirm=soho%2Fecom"
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ deletedId: "repo_soho_ecom" });
    expect((await store.getSnapshot("org_acme")).repositories).toHaveLength(0);
    await app.close();
  });
});
