import { describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/app.js";
import { InMemoryJobDispatcher, InMemoryLoreStore } from "@lore/database/index.js";
import { DEMO_ORGANISATION_ID } from "@lore/shared/demo-data.js";
import type { CandidateBulkReviewResult, DashboardSnapshot } from "@lore/shared/types.js";

describe("candidate triage API", () => {
  it("triages the queue and bulk-approves a guarded recommendation", async () => {
    const app = await createApp({
      demoMode: true,
      logger: false,
      dependencies: { store: new InMemoryLoreStore(), jobs: new InMemoryJobDispatcher() }
    });

    const triage = await app.inject({
      method: "POST",
      url: "/api/knowledge-candidates/triage",
      payload: { candidateIds: ["candidate_tax_codes"] }
    });
    expect(triage.statusCode).toBe(200);
    expect(triage.json()).toMatchObject({ status: "completed", queued: 1 });

    const snapshot = await app.inject({ method: "GET", url: "/api/bootstrap" });
    const candidate = snapshot
      .json<DashboardSnapshot>()
      .candidates.find((item) => item.id === "candidate_tax_codes");
    expect(candidate?.triage).toMatchObject({
      action: "approve",
      bulkEligibleAction: "approve",
      method: "ai"
    });

    const bulk = await app.inject({
      method: "POST",
      url: "/api/knowledge-candidates/bulk-review",
      payload: {
        action: "approve",
        candidateIds: ["candidate_tax_codes"],
        confirmationCount: 1,
        reason: "Bulk approved after guarded AI triage"
      }
    });
    expect(bulk.statusCode).toBe(200);
    expect(bulk.json<CandidateBulkReviewResult>()).toMatchObject({
      processedIds: ["candidate_tax_codes"],
      skipped: []
    });
    await app.close();
  });

  it("bulk-approves explicitly selected candidates without requiring AI recommendations", async () => {
    const app = await createApp({
      demoMode: true,
      logger: false,
      dependencies: { store: new InMemoryLoreStore(), jobs: new InMemoryJobDispatcher() }
    });

    const bulk = await app.inject({
      method: "POST",
      url: "/api/knowledge-candidates/bulk-review",
      payload: {
        action: "approve",
        candidateIds: ["candidate_interfaces", "candidate_tax_codes"],
        confirmationCount: 2,
        reason: "Explicitly selected and approved by a human reviewer"
      }
    });

    expect(bulk.statusCode).toBe(200);
    expect(bulk.json<CandidateBulkReviewResult>()).toMatchObject({
      processedIds: ["candidate_interfaces", "candidate_tax_codes"],
      skipped: []
    });
    await app.close();
  });

  it("rejects an incorrect explicit bulk confirmation count", async () => {
    const app = await createApp({ demoMode: true, logger: false });
    const response = await app.inject({
      method: "POST",
      url: "/api/knowledge-candidates/bulk-review",
      payload: {
        action: "ignore",
        candidateIds: ["candidate_interfaces"],
        confirmationCount: 2,
        reason: "Ignore obvious one-off activity"
      }
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("bounds list evidence but loads the complete selected candidate on demand", async () => {
    const store = new InMemoryLoreStore();
    const snapshot = await store.getSnapshot(DEMO_ORGANISATION_ID);
    const source = snapshot.candidates.find((candidate) => candidate.id === "candidate_tax_codes")!;
    const fullContent = "retained evidence ".repeat(200);
    await store.createKnowledgeCandidate(DEMO_ORGANISATION_ID, {
      ...structuredClone(source),
      id: "candidate_large_evidence",
      title: "Candidate with a large retained source",
      statement: "A large source remains available when the candidate detail is opened.",
      evidence: [{ ...source.evidence[0]!, content: fullContent }]
    });
    const app = await createApp({
      demoMode: true,
      logger: false,
      dependencies: { store, jobs: new InMemoryJobDispatcher() }
    });

    const list = await app.inject({ method: "GET", url: "/api/knowledge-candidates" });
    const preview = list
      .json<{ items: DashboardSnapshot["candidates"] }>()
      .items.find((candidate) => candidate.id === "candidate_large_evidence")!;
    expect(preview.evidence[0]!.content.length).toBeLessThan(fullContent.length);
    expect(preview.evidence[0]!.content).toContain("full retained source loads");

    const detail = await app.inject({
      method: "GET",
      url: "/api/knowledge-candidates/candidate_large_evidence"
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<DashboardSnapshot["candidates"][number]>().evidence[0]!.content).toBe(
      fullContent
    );
    await app.close();
  });
});
