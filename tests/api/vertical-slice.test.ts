import { describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/app.js";
import {
  InMemoryJobDispatcher,
  InMemoryJobLedger,
  InMemoryLoreStore
} from "@lore/database/index.js";
import type {
  CodeGraphPage,
  CodeRelationshipView,
  ContextPackage,
  SafetyReport
} from "@lore/shared/types.js";

describe("working API vertical slice", () => {
  it("does not start a duplicate GitHub import for the same repository", async () => {
    const store = new InMemoryLoreStore();
    const jobs = new InMemoryJobDispatcher();
    const jobLedger = new InMemoryJobLedger();
    const run = await jobLedger.enqueue({
      organisationId: "org_acme",
      repositoryId: "repo_soho_ecom",
      name: "github.import",
      payload: {},
      idempotencyKey: "existing-import"
    });
    await jobLedger.markRunning({
      runId: run.id,
      organisationId: "org_acme",
      repositoryId: "repo_soho_ecom",
      name: "github.import",
      externalJobId: "existing-import",
      attempt: 1,
      maximumAttempts: 3
    });
    const app = await createApp({
      demoMode: true,
      logger: false,
      dependencies: { store, jobs, jobLedger }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/repositories/repo_soho_ecom/github-import",
      payload: { limit: "all" }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: "already_running",
      alreadyRunning: true,
      jobId: run.id
    });
    expect(jobs.jobs.filter((job) => job.name === "github.import")).toHaveLength(0);
    await app.close();
  });

  it("prepares context, approves a candidate, verifies a change, and queues imports", async () => {
    const store = new InMemoryLoreStore();
    const jobs = new InMemoryJobDispatcher();
    const app = await createApp({ demoMode: true, logger: false, dependencies: { store, jobs } });
    const context = await app.inject({
      method: "POST",
      url: "/api/tasks/prepare",
      payload: {
        repositoryId: "repo_soho_ecom",
        task: "SS-6160 Update Avalara ShipFrom and ShipTo addresses"
      }
    });
    expect(context.statusCode).toBe(200);
    expect(context.json<ContextPackage>().historicalRegressions[0]!.item.title).toContain(
      "Address role"
    );

    const approved = await app.inject({
      method: "POST",
      url: "/api/knowledge-candidates/candidate_interfaces/approve",
      payload: {
        statement: "Application services should depend on repository interfaces.",
        reason: "Evidence reviewed by Casey"
      }
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: "active", confidence: 0.86 });

    const merged = await app.inject({
      method: "POST",
      url: "/api/knowledge-candidates/candidate_refund_tests/merge",
      payload: {
        targetId: "candidate_avalara",
        reason: "Same reviewed rule with supporting evidence"
      }
    });
    expect(merged.statusCode).toBe(200);
    expect(merged.json<{ evidenceIds: string[] }>().evidenceIds).toEqual(
      expect.arrayContaining(["ev6160", "ev782"])
    );
    expect(
      (await store.getSnapshot("org_acme")).candidates.some(
        (item) => item.id === "candidate_refund_tests"
      )
    ).toBe(false);

    const session = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        repositoryId: "repo_soho_ecom",
        task: "Update address code mapping",
        agentType: "codex"
      }
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
      payload: {
        changedFiles: [
          {
            path: "src/Tax/Avalara/AddressCode.php",
            status: "modified",
            additions: 3,
            deletions: 1,
            patch: "+return $role;"
          }
        ]
      }
    });
    expect(report.statusCode).toBe(200);
    expect(["MEDIUM", "HIGH", "CRITICAL"]).toContain(report.json<SafetyReport>().risk);
    const safetyReport = report.json<SafetyReport>();
    expect(safetyReport).toMatchObject({
      sessionId,
      contextId: persistedContext.json<{ id: string }>().id,
      contextRevision: 1
    });
    expect(safetyReport.observationId).toMatch(/^[0-9a-f-]{36}$/);
    const observation = await app.inject({
      method: "GET",
      url: `/api/observations/${safetyReport.observationId}`
    });
    expect(observation.statusCode).toBe(200);
    expect(observation.json()).toMatchObject({
      id: safetyReport.observationId,
      sessionId,
      contextId: persistedContext.json<{ id: string }>().id,
      contextRevision: 1,
      files: [{ path: "src/Tax/Avalara/AddressCode.php", status: "modified" }]
    });
    expect(JSON.stringify(observation.json())).not.toContain("return $role");
    expect(
      (await store.getSnapshot("org_acme")).sessions.find((item) => item.id === sessionId)?.status
    ).toBe("completed");
    const events = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/events` });
    expect(
      events
        .json<{ items: Array<{ sequence: number; type: string }> }>()
        .items.map((event) => event.type)
    ).toEqual([
      "started",
      "context_prepared",
      "verification_started",
      "verification_finished",
      "completed"
    ]);
    expect(
      events.json<{ items: Array<{ type: string; data: Record<string, unknown> }> }>().items[2]
        ?.data
    ).toMatchObject({
      observationId: safetyReport.observationId,
      contextRevision: 1
    });
    expect(
      events.json<{ items: Array<{ sequence: number }> }>().items.map((event) => event.sequence)
    ).toEqual([1, 2, 3, 4, 5]);

    const abandonedSession = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { repositoryId: "repo_soho_ecom", task: "Interrupted agent run", agentType: "codex" }
    });
    const abandonedId = abandonedSession.json<{ id: string }>().id;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/sessions/${abandonedId}/abandon`,
          payload: { reason: "Agent process exited" }
        })
      ).json()
    ).toMatchObject({ status: "abandoned" });
    expect((await store.getSessionEvents("org_acme", abandonedId)).at(-1)).toMatchObject({
      type: "abandoned",
      data: { reason: "Agent process exited" }
    });

    const queued = await app.inject({
      method: "POST",
      url: "/api/repositories/repo_soho_ecom/github-import",
      payload: { installationId: 123, limit: 250 }
    });
    expect(queued.statusCode).toBe(202);
    expect(jobs.jobs.some((job) => job.name === "github.import")).toBe(true);
    const activity = await app.inject({ method: "GET", url: "/api/jobs?limit=10" });
    expect(activity.statusCode).toBe(200);
    expect(activity.json<{ items: Array<Record<string, unknown>> }>().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organisationId: "org_acme",
          name: "github.import",
          state: "dispatched"
        }),
        expect.objectContaining({
          organisationId: "org_acme",
          name: "knowledge.extract",
          state: "running"
        })
      ])
    );
    expect(JSON.stringify(activity.json())).not.toContain("evidenceIds");
    expect(JSON.stringify(activity.json())).not.toContain("payload");

    const entityPage = await app.inject({
      method: "GET",
      url: "/api/repositories/repo_soho_ecom/entities?page=1&pageSize=1"
    });
    expect(entityPage.statusCode).toBe(200);
    expect(entityPage.json()).toMatchObject({ page: 1, pageSize: 1, count: 1, hasMore: true });
    expect(entityPage.json<{ total: number }>().total).toBeGreaterThan(1);

    const relationshipPage = await app.inject({
      method: "GET",
      url: "/api/repositories/repo_soho_ecom/relationships?page=1&pageSize=1"
    });
    expect(relationshipPage.statusCode).toBe(200);
    const relationshipBody = relationshipPage.json<CodeGraphPage<CodeRelationshipView>>();
    expect(relationshipBody).toMatchObject({
      page: 1,
      pageSize: 1,
      count: 1
    });
    expect(typeof relationshipBody.items[0]?.sourceEntity.qualifiedName).toBe("string");
    expect(typeof relationshipBody.items[0]?.targetEntity.qualifiedName).toBe("string");

    const extractionJobsBefore = jobs.jobs.filter((job) => job.name === "knowledge.extract").length;
    const replay = await app.inject({
      method: "POST",
      url: "/api/repositories/repo_soho_ecom/knowledge-extraction",
      payload: { includeProcessed: true }
    });
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toMatchObject({ status: "simulated", includeProcessed: true });
    expect(
      replay.json<{ evidenceQueued: number; batchesQueued: number }>().evidenceQueued
    ).toBeGreaterThan(0);
    expect(
      replay.json<{ evidenceQueued: number; batchesQueued: number }>().batchesQueued
    ).toBeGreaterThan(0);
    expect(jobs.jobs.filter((job) => job.name === "knowledge.extract")).toHaveLength(
      extractionJobsBefore + replay.json<{ batchesQueued: number }>().batchesQueued
    );

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
    expect(retention.json()).toMatchObject({
      retentionConfig: { retainSummariesOnly: true, retainReviewComments: false }
    });

    const importedMarkdown = await app.inject({
      method: "POST",
      url: "/api/knowledge-import",
      payload: {
        format: "markdown",
        sourceName: "CONTRIBUTING.md",
        repositoryId: "repo_soho_ecom",
        content:
          "# Deployment convention\n\nNever deploy without recording the release verification result."
      }
    });
    expect(importedMarkdown.statusCode).toBe(201);
    expect(importedMarkdown.json()).toMatchObject({
      imported: 1,
      items: [{ kind: "rule", scope: { repository: "soho/ecom" } }]
    });

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
