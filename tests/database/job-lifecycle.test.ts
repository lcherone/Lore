import { describe, expect, it } from "vitest";
import type { JobDispatcher } from "@lore/core/index.js";
import {
  InMemoryJobDispatcher,
  InMemoryJobLedger,
  PersistentJobDispatcher
} from "@lore/database/index.js";

class SwitchableDispatcher implements JobDispatcher {
  fail = true;
  readonly jobs: Array<{ name: string; payload: Record<string, unknown>; idempotencyKey: string }> =
    [];
  async health(): Promise<void> {}
  async dispatch(
    name: "repository.index" | "github.import" | "knowledge.extract" | "knowledge.health",
    payload: Record<string, unknown>,
    idempotencyKey: string
  ): Promise<{ id: string }> {
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
    expect(completed).toMatchObject({
      state: "succeeded",
      attempt: 1,
      resultSummary: { evidenceAdded: 4 }
    });
    expect(completed.events?.map((event) => event.state)).toEqual([
      "queued",
      "dispatched",
      "running",
      "succeeded"
    ]);
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
    expect(await ledger.pending()).toHaveLength(1);
    expect((await ledger.list("org-1"))[0]?.state).toBe("queued");

    transport.fail = false;
    expect(await dispatcher.reconcile()).toBe(1);
    expect(await ledger.pending()).toEqual([]);
    expect(transport.jobs[0]?.payload.loreJobRunId).toBe(queued.id);
    expect((await ledger.list("org-1"))[0]?.state).toBe("dispatched");
  });

  it("does not re-dispatch a completed idempotent business job", async () => {
    const ledger = new InMemoryJobLedger();
    const transport = new InMemoryJobDispatcher();
    const dispatcher = new PersistentJobDispatcher(transport, ledger);
    const first = await dispatcher.dispatch(
      "knowledge.extract",
      { organisationId: "org-1", repositoryId: "repo-1", evidenceIds: ["evidence-1"] },
      "extract-stable-batch"
    );
    await ledger.markRunning({
      runId: first.id,
      organisationId: "org-1",
      repositoryId: "repo-1",
      name: "knowledge.extract",
      externalJobId: "extract-stable-batch",
      attempt: 1,
      maximumAttempts: 3
    });
    await ledger.markSucceeded(first.id, { candidatesCreated: 1 });

    const replay = await dispatcher.dispatch(
      "knowledge.extract",
      { organisationId: "org-1", repositoryId: "repo-1", evidenceIds: ["evidence-1"] },
      "extract-stable-batch"
    );

    expect(replay.id).toBe(first.id);
    expect(transport.jobs).toHaveLength(1);
    expect((await ledger.list("org-1"))[0]?.state).toBe("succeeded");
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

  it("reuses one durable run when a scheduled transport job retries", async () => {
    const ledger = new InMemoryJobLedger();
    const input = {
      organisationId: "org-1",
      repositoryId: "repo-1",
      name: "github.import" as const,
      externalJobId: "repeat:github-sync-repo-1:123",
      maximumAttempts: 3
    };
    const firstRunId = await ledger.markRunning({ ...input, attempt: 1 });
    await ledger.markFailed(firstRunId, new Error("temporary failure"), false);
    const retriedRunId = await ledger.markRunning({ ...input, attempt: 2 });

    expect(retriedRunId).toBe(firstRunId);
    expect(await ledger.list("org-1")).toHaveLength(1);
    expect((await ledger.list("org-1"))[0]).toMatchObject({ state: "retrying", attempt: 2 });
  });

  it("reconciles a transport-level stall that occurs outside the processor", async () => {
    const ledger = new InMemoryJobLedger();
    const runId = await ledger.markRunning({
      organisationId: "org-1",
      repositoryId: "repo-1",
      name: "github.import",
      externalJobId: "import-repo-1-stalled",
      attempt: 1,
      maximumAttempts: 3
    });

    await ledger.markTransportFailed(
      "import-repo-1-stalled",
      new Error("job stalled more than allowable limit"),
      true
    );
    await ledger.markTransportFailed(
      "import-repo-1-stalled",
      new Error("job stalled more than allowable limit"),
      true
    );

    const run = (await ledger.list("org-1"))[0]!;
    expect(run.id).toBe(runId);
    expect(run).toMatchObject({
      state: "dead_letter",
      errorMessage: "job stalled more than allowable limit"
    });
    expect(run.events?.filter((event) => event.state === "dead_letter")).toHaveLength(1);
  });
});
