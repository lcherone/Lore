import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/app.js";
import { InMemoryJobDispatcher, InMemoryLoreStore } from "@lore/database/index.js";
import { GitHubImportService } from "@lore/github/index.js";
import { createDemoSnapshot } from "@lore/shared/demo-data.js";
import type { PullRequestImport, SourceControlProvider } from "@lore/core/index.js";

const fixture = fileURLToPath(
  new URL("../fixtures/demo-repo/fixtures/github-prs.json", import.meta.url)
);
const previousSecret = process.env.GITHUB_WEBHOOK_SECRET;
afterEach(() => {
  if (previousSecret === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
  else process.env.GITHUB_WEBHOOK_SECRET = previousSecret;
});

describe("GitHub evidence ingestion", () => {
  it("is idempotent across repeated historical imports", async () => {
    const pullRequests = JSON.parse(await readFile(fixture, "utf8")) as PullRequestImport[];
    const provider: SourceControlProvider = { listMergedPullRequests: async () => pullRequests };
    const snapshot = createDemoSnapshot();
    const store = new InMemoryLoreStore(snapshot, []);
    const importer = new GitHubImportService(provider, store);
    const first = await importer.importMergedPullRequests(
      snapshot.organisation.id,
      snapshot.repositories[0]!,
      100
    );
    const second = await importer.importMergedPullRequests(
      snapshot.organisation.id,
      snapshot.repositories[0]!,
      100
    );
    expect(first.evidenceAdded).toBeGreaterThan(0);
    expect(first.evidenceUpdated).toBe(0);
    expect(first.evidenceIds.length).toBe(first.evidenceAdded);
    expect(second.evidenceAdded).toBe(0);
    expect(second.evidenceUpdated).toBe(0);
    expect(second.evidenceIds).toEqual([]);
  });

  it("uses a durable source checkpoint without creating an evidence revision", async () => {
    const [fixturePullRequest] = JSON.parse(await readFile(fixture, "utf8")) as PullRequestImport[];
    const pullRequest = {
      ...fixturePullRequest!,
      sourceVersion: "2026-08-16T12:00:00.000Z"
    };
    let detailCollections = 0;
    const provider: SourceControlProvider = {
      listMergedPullRequests: async (_repository, _limit, options) => {
        if (options?.knownSourceVersions?.[pullRequest.externalId] === pullRequest.sourceVersion) {
          return [];
        }
        detailCollections += 1;
        await options?.onPullRequest?.(pullRequest);
        return [pullRequest];
      }
    };
    const snapshot = createDemoSnapshot();
    const store = new InMemoryLoreStore(snapshot, []);
    const importer = new GitHubImportService(provider, store);
    await importer.importMergedPullRequests(
      snapshot.organisation.id,
      snapshot.repositories[0]!,
      "all"
    );
    const evidence = (await store.getEvidence(snapshot.organisation.id)).find((record) =>
      record.externalId.endsWith(`:pr:${pullRequest.number}`)
    )!;
    await importer.importMergedPullRequests(
      snapshot.organisation.id,
      snapshot.repositories[0]!,
      "all"
    );

    expect(detailCollections).toBe(1);
    expect(await store.getEvidenceRevisions(snapshot.organisation.id, evidence.id)).toHaveLength(1);
  });

  it("retains immutable revisions and re-queues changed upstream evidence", async () => {
    const original = JSON.parse(await readFile(fixture, "utf8")) as PullRequestImport[];
    let body = original[0]!.body;
    const provider: SourceControlProvider = {
      listMergedPullRequests: async () => [{ ...original[0]!, body }]
    };
    const snapshot = createDemoSnapshot();
    const store = new InMemoryLoreStore(snapshot, []);
    const importer = new GitHubImportService(provider, store);
    await importer.importMergedPullRequests(
      snapshot.organisation.id,
      snapshot.repositories[0]!,
      100
    );
    const evidenceId = (await store.getEvidence(snapshot.organisation.id)).find((record) =>
      record.externalId.endsWith(`:pr:${original[0]!.number}`)
    )!.id;

    body = `${body}\n\nClarification added after merge.`;
    const second = await importer.importMergedPullRequests(
      snapshot.organisation.id,
      snapshot.repositories[0]!,
      100
    );
    expect(second).toMatchObject({ evidenceAdded: 0, evidenceUpdated: 1 });
    expect(second.evidenceIds).toContain(evidenceId);
    const revisions = await store.getEvidenceRevisions(snapshot.organisation.id, evidenceId);
    expect(revisions).toHaveLength(2);
    expect(revisions[0]?.content).not.toContain("Clarification added after merge.");
    expect(revisions[1]?.content).toContain("Clarification added after merge.");
    expect(revisions[0]?.contentHash).not.toBe(revisions[1]?.contentHash);
  });

  it("persists completed pull requests before a later GitHub request fails", async () => {
    const pullRequests = JSON.parse(await readFile(fixture, "utf8")) as PullRequestImport[];
    const firstPullRequest = { ...pullRequests[0]!, sourceVersion: "2026-08-15T10:00:00.000Z" };
    const provider: SourceControlProvider = {
      listMergedPullRequests: async (_repository, _limit, options) => {
        await options?.onPullRequest?.(firstPullRequest);
        throw new Error("simulated later rate-limit failure");
      }
    };
    const snapshot = createDemoSnapshot();
    const store = new InMemoryLoreStore(snapshot, []);
    const persistedBatches: string[][] = [];
    const importer = new GitHubImportService(provider, store);

    await expect(
      importer.importMergedPullRequests(
        snapshot.organisation.id,
        snapshot.repositories[0]!,
        "all",
        async (evidence) => {
          persistedBatches.push(evidence.map((record) => record.id));
        }
      )
    ).rejects.toThrow("simulated later rate-limit failure");

    const retained = (await store.getEvidence(snapshot.organisation.id)).filter(
      (record) =>
        record.externalId.includes(`:pr:${firstPullRequest.number}`) ||
        record.metadata.pullRequest === firstPullRequest.number
    );
    expect(retained.length).toBeGreaterThan(0);
    expect(
      (
        await store.getSyncSourceVersions(
          snapshot.organisation.id,
          snapshot.repositories[0]!.id,
          "github",
          "merged_pull_request"
        )
      )[firstPullRequest.externalId]
    ).toBe(firstPullRequest.sourceVersion);
    expect(persistedBatches.flat()).toEqual(
      expect.arrayContaining(retained.map((record) => record.id))
    );
  });

  it("applies repository retention before evidence is persisted", async () => {
    const provider: SourceControlProvider = {
      listMergedPullRequests: async () => [
        {
          externalId: "44",
          number: 44,
          title: "Keep only the bounded summary",
          body: "Sensitive pull request body",
          author: "casey",
          reviewers: ["joe"],
          reviewComments: [
            {
              externalId: "comment-1",
              author: "joe",
              body: "Sensitive review",
              occurredAt: "2026-08-15T10:00:00.000Z"
            }
          ],
          commits: ["abc123"],
          changedFiles: ["src/Private.php"],
          rawDiff: "+secret source",
          mergedAt: "2026-08-15T11:00:00.000Z",
          url: "https://example.test/pr/44"
        }
      ]
    };
    const store = new InMemoryLoreStore();
    const snapshot = createDemoSnapshot();
    const repository = {
      ...snapshot.repositories[0]!,
      retentionConfig: {
        retainRawPullRequestDiff: false,
        retainSummariesOnly: true,
        retainReviewComments: false,
        retainCodeSnippets: false
      }
    };
    const imported = await new GitHubImportService(provider, store).importMergedPullRequests(
      snapshot.organisation.id,
      repository,
      100
    );
    const importedEvidence = (await store.getEvidence(snapshot.organisation.id)).filter((item) =>
      imported.evidenceIds.includes(item.id)
    );
    expect(importedEvidence).toHaveLength(1);
    expect(importedEvidence[0]?.content).toBe("Keep only the bounded summary");
  });

  it("validates signatures and ignores replayed webhook deliveries", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-webhook-secret";
    const store = new InMemoryLoreStore();
    const jobs = new InMemoryJobDispatcher();
    const app = await createApp({ demoMode: true, logger: false, dependencies: { store, jobs } });
    const payload = JSON.stringify({
      action: "submitted",
      installation: { id: 123 },
      repository: { id: 73421009, name: "ecom", full_name: "soho/ecom", owner: { login: "soho" } },
      pull_request: { number: 2401, updated_at: "2026-08-15T10:00:00.000Z" },
      review: {
        id: 7788,
        body: "Keep mapper boundaries explicit.",
        state: "approved",
        html_url: "https://example.test/review/7788"
      },
      sender: { login: "reviewer" }
    });
    const signature = `sha256=${createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET).update(payload).digest("hex")}`;
    const headers = {
      "content-type": "application/json",
      "x-github-event": "pull_request_review",
      "x-github-delivery": "delivery-7788",
      "x-hub-signature-256": signature
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/github/webhook",
      headers,
      payload
    });
    const replay = await app.inject({
      method: "POST",
      url: "/api/github/webhook",
      headers,
      payload
    });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ status: "accepted", evidenceAdded: 1 });
    expect(replay.json()).toMatchObject({ status: "duplicate" });
    expect(jobs.jobs.filter((job) => job.name === "knowledge.extract")).toHaveLength(1);
    await app.close();
  });
});
