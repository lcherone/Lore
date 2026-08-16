import type { EvidenceRecord } from "@lore/shared/types.js";

export interface KnowledgeExtractionBatchOptions {
  maxEvidence?: number;
  maxCharacters?: number;
}

const DEFAULT_MAX_EVIDENCE = 20;
const DEFAULT_MAX_CHARACTERS = 120_000;

const extractionSize = (record: EvidenceRecord): number => JSON.stringify({
  id: record.id,
  type: record.type,
  provider: record.provider,
  title: record.title,
  content: record.content,
  author: record.author,
  metadata: record.metadata
}).length;

/**
 * Builds stable, bounded batches without truncating source evidence. One very
 * large record is kept intact in its own batch so provenance remains exact.
 */
export function createKnowledgeExtractionBatches(
  evidence: EvidenceRecord[],
  evidenceIds: string[],
  options: KnowledgeExtractionBatchOptions = {}
): string[][] {
  const maxEvidence = Math.max(1, Math.floor(options.maxEvidence ?? DEFAULT_MAX_EVIDENCE));
  const maxCharacters = Math.max(1_000, Math.floor(options.maxCharacters ?? DEFAULT_MAX_CHARACTERS));
  const byId = new Map(evidence.map((record) => [record.id, record]));
  const batches: string[][] = [];
  let current: string[] = [];
  let currentCharacters = 0;

  for (const id of [...new Set(evidenceIds)]) {
    const record = byId.get(id);
    if (!record) continue;
    const characters = extractionSize(record);
    if (current.length > 0 && (current.length >= maxEvidence || currentCharacters + characters > maxCharacters)) {
      batches.push(current);
      current = [];
      currentCharacters = 0;
    }
    current.push(id);
    currentCharacters += characters;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
