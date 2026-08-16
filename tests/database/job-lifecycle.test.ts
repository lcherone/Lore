import { describe, expect, it } from "vitest";
import type { JobDispatcher } from "@lore/core/index.js";
import { InMemoryJobDispatcher, InMemoryJobLedger, PersistentJobDispatcher } from "@lore/database/index.js";

class SwitchableDispatcher implements JobDispatcher {
  fail = true;
  readonly jobs: Array<{ name: string; payload: Record<string, unknown>; idempotencyKey: string }> = [];
  async health(): Promise<void> {}
  async dispatch(name: "repository.index" | "github.import" | "knowledge.extract" | "knowledge.health", payload: Record<string, unknown>, idempotencyKey: string): Promise<{ id: string }> {
    if (this.fail) throw new Error("Redis unavailable");
    this.jobs.push({ name, payload, idempotencyKey });
    return { id: idempotencyKey };
  }
}

describe("durable job lifecycle", () => {
  it("records dispatch and worker lifecycle transitions", async () => {
    const ledger = new InMemoryJobLedger();
    const transport = new InMemoryJobDispatcher();
    const dispatcher = new PersistentJobDispatcher(transport, ledger);
    const queued = await dispatcher.dispatch(
      "github.import",
      { organisationId: "org-1", repositoryId: "repo-1", limit: "all" },
      "import-repo-1"
    );
    const dispatched = (await ledger.list("org-1"))[0]!;
    expect(queued).toEqual({ id: dispatched.id });
    expect(dispatched.state).toBe("dispatched");
    expect(transport.jobs[0]?.payload.loreJobRunId).toBe(dispatched.id);

    const runId = await ledger.markRunning({
      runId: dispatched.id,
      organisationId: "org-1",
      repositoryId: "repo-1",
      name: "github.import",
      externalJobId: "import-repo-1",
      attempt: 1,
      maximumAttempts: 3
    });
    await ledger.markSucceeded(runId, { evidenceAdded: 4 });
    const completed = (await ledger.list("org-1"))[0]!;
    expect(completed).toMatchObject({ state: "succeeded", attempt: 1, resultSummary: { evidenceAdded: 4 } });
    expect(completed.events?.map((event) => event.state)).toEqual(["queued", "dispatched", "running", "succeeded"]);
  });

  it("retains an outbox intent and reconciles after transport recovery", async () => {
    const ledger = new InMemoryJobLedger();
    const transport = new SwitchableDispatcher();
    const dispatcher = new PersistentJobDispatcher(transport, ledger);
    const queued = await dispatcher.dispatch(
      "knowledge.extract",
      { organisationId: "org-1", repositoryId: "repo-1", evidenceIds: ["evidence-1"] },
      "extract-evidence-1"
    );
    expect(queued.deferred).toBe(true);
    expect((await ledger.pending())).toHaveLength(1);
    expect((await ledger.list("org-1"))[0]?.state).toBe("queued");

    transport.fail = false;
    expect(await dispatcher.reconcile()).toBe(1);
    expect(await ledger.pending()).toEqual([]);
    expect(transport.jobs[0]?.payload.loreJobRunId).toBe(queued.id);
    expect((await ledger.list("org-1"))[0]?.state).toBe("dispatched");
  });

  it("redacts credentials and stores only bounded result summaries", async () => {
    const ledger = new InMemoryJobLedger();
    const run = await ledger.enqueue({
      organisationId: "org-1",
      name: "knowledge.extract",
      payload: {},
      idempotencyKey: "safe-observability"
    });
    await ledger.markFailed(
      run.id,
      new Error("Bearer secret-value github_pat_example sk-proj_example"),
      false
    );
    expect((await ledger.list("org-1"))[0]?.errorMessage).toBe(
      "Bearer [REDACTED] [REDACTED_GITHUB_TOKEN] [REDACTED_OPENAI_KEY]"
    );

    await ledger.markSucceeded(run.id, {
      count: 3,
      records: [{ private: "content" }],
      nested: { private: "content" }
    });
    expect((await ledger.list("org-1"))[0]?.resultSummary).toEqual({
      count: 3,
      records: "1 item",
      nested: "[details omitted]"
    });
  });
});
