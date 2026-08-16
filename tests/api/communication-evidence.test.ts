import { describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/app.js";
import { InMemoryJobDispatcher, InMemoryLoreStore } from "@lore/database/index.js";
import type { CommunicationEvidenceAnalysis, EvidenceRecord } from "@lore/shared/types.js";

describe("ad-hoc communication evidence API", () => {
  it("retains a transcript, compares suggestions, and remains idempotent", async () => {
    const store = new InMemoryLoreStore();
    const initialKnowledgeCount = (await store.getSnapshot("org_acme")).knowledge.length;
    const app = await createApp({
      demoMode: true,
      logger: false,
      dependencies: { store, jobs: new InMemoryJobDispatcher() }
    });
    const payload = {
      repositoryId: "repo_soho_ecom",
      sourceType: "standup",
      title: "Payments engineering standup",
      content: `Alex: Decision: ShipFrom and ShipTo addresses must receive independent address codes in Avalara payloads.
Sam: We should add a regression test before changing refund tax mapping.
Priya: Yesterday I finished release notes and today I am reviewing deployment.`,
      participants: ["Alex", "Sam", "Priya"],
      occurredAt: "2026-08-16T09:00:00.000Z",
      sourceReference: "#payments-eng",
      authorityConfirmed: true
    } as const;

    const created = await app.inject({ method: "POST", url: "/api/evidence/communications", payload });
    expect(created.statusCode).toBe(201);
    const analysis = created.json<CommunicationEvidenceAnalysis>();
    expect(analysis).toMatchObject({ evidenceAdded: true, evidence: { type: "communication" } });
    expect(analysis.candidates).toHaveLength(2);
    expect(analysis.candidates[0]).toMatchObject({
      disposition: "already_added",
      matches: [{ id: "knowledge_avalara_codes" }]
    });
    expect(analysis.counts.already_added).toBe(1);
    expect((await store.getSnapshot("org_acme")).knowledge).toHaveLength(initialKnowledgeCount);
    const candidateCount = (await store.getSnapshot("org_acme")).candidates.length;

    const duplicate = await app.inject({ method: "POST", url: "/api/evidence/communications", payload });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json<CommunicationEvidenceAnalysis>().evidenceAdded).toBe(false);
    expect((await store.getSnapshot("org_acme")).candidates).toHaveLength(candidateCount);

    const merged = await app.inject({
      method: "POST",
      url: `/api/knowledge-candidates/${analysis.candidates[0]!.candidate.id}/merge`,
      payload: {
        targetId: "knowledge_avalara_codes",
        reason: "Standup confirms the existing address-code decision"
      }
    });
    expect(merged.statusCode).toBe(200);
    expect(merged.json<{ evidenceIds: string[] }>().evidenceIds).toContain(analysis.evidence.id);

    const listed = await app.inject({ method: "GET", url: "/api/evidence?type=communication&limit=10" });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ items: EvidenceRecord[]; total: number }>()).toMatchObject({
      total: 1,
      items: [{ id: analysis.evidence.id, type: "communication", contentHash: analysis.evidence.contentHash }]
    });

    const unsafe = await app.inject({
      method: "POST",
      url: "/api/evidence/communications",
      payload: { ...payload, title: "Another standup", authorityConfirmed: false }
    });
    expect(unsafe.statusCode).toBe(400);
    await app.close();
  });
});
