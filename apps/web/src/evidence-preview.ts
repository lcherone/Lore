import { createKnowledgeEvidenceView } from "@lore/shared/evidence-content.js";
import type { EvidenceRecord } from "@lore/shared/types.js";

const DEFAULT_MAX_CHARACTERS = 420;

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "also", "because", "been", "before", "being",
  "between", "candidate", "could", "does", "from", "have", "into", "itself", "knowledge",
  "lore", "must", "only", "other", "should", "that", "their", "there", "these", "they",
  "this", "those", "through", "under", "using", "very", "what", "when", "where", "which",
  "while", "with", "would"
]);

export interface EvidencePreview {
  text: string;
  truncated: boolean;
}

const readableText = (content: string): string => content
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/\r\n?/g, "\n")
  .replace(/[ \t]+/g, " ")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const termsFor = (context: string): string[] => [...new Set(
  context
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_./:-]{2,}/g)
    ?.filter((term) => !STOP_WORDS.has(term)) ?? []
)];

const segmentsFor = (content: string): string[] => content
  .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"'`])/)
  .map((segment) => segment.replace(/^[-+*>#\s]+/, "").trim())
  .filter((segment) => segment.length >= 12);

const excerptAroundMatch = (text: string, terms: string[], limit: number): string => {
  if (text.length <= limit) return text;
  const lower = text.toLowerCase();
  const match = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? 0;
  const start = Math.max(0, Math.min(match - Math.floor(limit / 3), text.length - limit));
  const prefix = start > 0 ? "…" : "";
  const suffix = start + limit < text.length ? "…" : "";
  const excerpt = text.slice(start, start + limit - prefix.length - suffix.length).trim();
  return `${prefix}${excerpt}${suffix}`;
};

export function createEvidencePreview(
  content: string,
  context: string,
  maxCharacters = DEFAULT_MAX_CHARACTERS,
  type: EvidenceRecord["type"] = "documentation"
): EvidencePreview {
  const evidenceView = createKnowledgeEvidenceView({ content, type }, 50_000);
  const readable = readableText(evidenceView.text);
  if (!readable) return { text: "No readable source text was retained.", truncated: false };
  if (readable.length <= maxCharacters) {
    return { text: readable, truncated: evidenceView.omittedSourceContent };
  }

  const terms = termsFor(context);
  const segments = segmentsFor(readable);
  const ranked = segments
    .map((segment, index) => {
      const lower = segment.toLowerCase();
      const matches = terms.filter((term) => lower.includes(term));
      return {
        segment,
        index,
        score: matches.reduce((score, term) => score + Math.min(term.length, 18), 0)
      };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  if (!ranked.length) {
    return {
      text: excerptAroundMatch(readable, terms, maxCharacters),
      truncated: true
    };
  }

  const selected: typeof ranked = [];
  let used = 0;
  for (const item of ranked) {
    if (selected.length >= 3) break;
    const remaining = maxCharacters - used - (selected.length ? 3 : 0);
    if (remaining < 40) break;
    selected.push({
      ...item,
      segment: excerptAroundMatch(item.segment, terms, remaining)
    });
    used += Math.min(item.segment.length, remaining) + (selected.length > 1 ? 3 : 0);
  }

  return {
    text: selected
      .sort((left, right) => left.index - right.index)
      .map(({ segment }) => segment)
      .join(" … "),
    truncated: true
  };
}
