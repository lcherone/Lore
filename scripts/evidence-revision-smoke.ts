import "dotenv/config";
import { createPrismaClient, PrismaLoreStore } from "../packages/database/src/index.js";
import { newUuid } from "../packages/shared/src/ids.js";
import type { EvidenceRecord } from "../packages/shared/src/types.js";

const prisma = createPrismaClient();
const store = new PrismaLoreStore(prisma);
const suffix = newUuid().slice(0, 8);
const organisation = await prisma.organisation.create({
  data: { name: `Evidence revision smoke ${suffix}`, slug: `evidence-revision-smoke-${suffix}` }
});

try {
  const evidenceId = newUuid();
  const base: EvidenceRecord = {
    id: evidenceId,
    organisationId: organisation.id,
    type: "pull_request",
    provider: "github",
    externalId: `lore/smoke:pr:${suffix}`,
    title: "PR evidence revision smoke",
    content: "The original retained pull request body.",
    author: "lore-smoke",
    occurredAt: new Date().toISOString(),
    metadata: { smoke: true }
  };

  const created = await store.ingestEvidence([base]);
  const unchanged = await store.ingestEvidence([base]);
  const updated = await store.ingestEvidence([{
    ...base,
    content: "The edited retained pull request body.",
    metadata: { smoke: true, edit: 1 }
  }]);
  const revisions = await store.getEvidenceRevisions(organisation.id, evidenceId);
  const latest = (await store.getEvidence(organisation.id)).find((record) => record.id === evidenceId);

  if (created !== 1 || unchanged !== 0 || updated !== 1) {
    throw new Error(`Unexpected write counts: ${JSON.stringify({ created, unchanged, updated })}`);
  }
  if (revisions.length !== 2 || revisions[0]?.version !== 1 || revisions[1]?.version !== 2) {
    throw new Error(`Expected two ordered immutable revisions, received ${revisions.length}`);
  }
  if (revisions[0]?.contentHash === revisions[1]?.contentHash) {
    throw new Error("Edited evidence reused the original revision hash");
  }
  if (latest?.content !== "The edited retained pull request body.") {
    throw new Error("The current evidence snapshot was not updated");
  }

  process.stdout.write("✓ PostgreSQL created one evidence snapshot and immutable revision 1\n");
  process.stdout.write("✓ Unchanged replay was idempotent\n");
  process.stdout.write("✓ Edited evidence appended revision 2 and updated the current snapshot\n");
} finally {
  await prisma.organisation.delete({ where: { id: organisation.id } }).catch(() => undefined);
  await prisma.$disconnect();
}
