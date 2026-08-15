import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/app.js";
import { InMemoryJobDispatcher, InMemoryLoreStore } from "@lore/database/index.js";
import { GitHubImportService } from "@lore/github/index.js";
import { createDemoSnapshot } from "@lore/shared/demo-data.js";
import type { PullRequestImport, SourceControlProvider } from "@lore/core/index.js";

const fixture = fileURLToPath(new URL("../fixtures/demo-repo/fixtures/github-prs.json", import.meta.url));
const previousSecret = process.env.GITHUB_WEBHOOK_SECRET;
afterEach(() => {
  if (previousSecret === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
  else process.env.GITHUB_WEBHOOK_SECRET = previousSecret;
});

describe("GitHub evidence ingestion", () => {
  it("is idempotent across repeated historical imports", async () => {
    const pullRequests = JSON.parse(await readFile(fixture, "utf8")) as PullRequestImport[];
    const provider: SourceControlProvider = { listMergedPullRequests: async () => pullRequests };
    const store = new InMemoryLoreStore();
    const snapshot = createDemoSnapshot();
    const importer = new GitHubImportService(provider, store);
    const first = await importer.importMergedPullRequests(snapshot.organisation.id, snapshot.repositories[0]!, 100);
    const second = await importer.importMergedPullRequests(snapshot.organisation.id, snapshot.repositories[0]!, 100);
    expect(first.evidenceAdded).toBeGreaterThan(0);
    expect(second.evidenceAdded).toBe(0);
  });

  it("applies repository retention before evidence is persisted", async () => {
    const provider: SourceControlProvider = {
      listMergedPullRequests: async () => [{
        externalId: "44",
        number: 44,
        title: "Keep only the bounded summary",
        body: "Sensitive pull request body",
        author: "casey",
        reviewers: ["joe"],
        reviewComments: [{ externalId: "comment-1", author: "joe", body: "Sensitive review", occurredAt: "2026-08-15T10:00:00.000Z" }],
        commits: ["abc123"],
        changedFiles: ["src/Private.php"],
        rawDiff: "+secret source",
        mergedAt: "2026-08-15T11:00:00.000Z",
        url: "https://example.test/pr/44"
      }]
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
    const imported = await new GitHubImportService(provider, store).importMergedPullRequests(snapshot.organisation.id, repository, 100);
    const importedEvidence = (await store.getEvidence(snapshot.organisation.id)).filter((item) => imported.evidenceIds.includes(item.id));
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
      review: { id: 7788, body: "Keep mapper boundaries explicit.", state: "approved", html_url: "https://example.test/review/7788" },
      sender: { login: "reviewer" }
    });
    const signature = `sha256=${createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET).update(payload).digest("hex")}`;
    const headers = { "content-type": "application/json", "x-github-event": "pull_request_review", "x-github-delivery": "delivery-7788", "x-hub-signature-256": signature };
    const first = await app.inject({ method: "POST", url: "/api/github/webhook", headers, payload });
    const replay = await app.inject({ method: "POST", url: "/api/github/webhook", headers, payload });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ status: "accepted", evidenceAdded: 1 });
    expect(replay.json()).toMatchObject({ status: "duplicate" });
    expect(jobs.jobs.filter((job) => job.name === "knowledge.extract")).toHaveLength(1);
    await app.close();
  });
});
