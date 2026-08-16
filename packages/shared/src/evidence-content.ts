import type { EvidenceRecord } from "./types.js";

export interface KnowledgeEvidenceView {
  text: string;
  omittedSourceContent: boolean;
}

const TEMPLATE_SECTION_NAMES = new Set([
  "checks",
  "checked",
  "checklist",
  "compliance",
  "deployment checklist",
  "functional",
  "links",
  "related links",
  "review checklist",
  "screenshots",
  "sox",
  "staging",
  "test plan",
  "testing"
]);

const contentLimitFor = (type: EvidenceRecord["type"]): number => {
  if (type === "communication") return 40_000;
  if (type === "review_comment") return 16_000;
  return 24_000;
};

const withoutRawDiff = (content: string): { text: string; omitted: boolean } => {
  const diffStart = content.search(/(?:^|\n)diff --git /m);
  if (diffStart < 0) return { text: content, omitted: false };
  return { text: content.slice(0, diffStart), omitted: true };
};

const heading = (line: string): { level: number; name: string } | undefined => {
  const match = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
  if (!match) return undefined;
  return {
    level: match[1]!.length,
    name: match[2]!.replace(/[*_`]/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase()
  };
};

const withoutPullRequestTemplate = (content: string): { text: string; omitted: boolean } => {
  const retained: string[] = [];
  let skippedSectionLevel: number | undefined;
  let omitted = false;

  for (const line of content.split("\n")) {
    const currentHeading = heading(line);
    if (currentHeading) {
      if (skippedSectionLevel !== undefined && currentHeading.level <= skippedSectionLevel) {
        skippedSectionLevel = undefined;
      }
      if (TEMPLATE_SECTION_NAMES.has(currentHeading.name)) {
        skippedSectionLevel = currentHeading.level;
        omitted = true;
        continue;
      }
      if (currentHeading.name === "change summary") {
        omitted = true;
        continue;
      }
      if (skippedSectionLevel !== undefined) {
        omitted = true;
        continue;
      }
    } else if (skippedSectionLevel !== undefined) {
      omitted = true;
      continue;
    }

    if (/^\s*[-*]\s+\[[ xX]\]\s+/.test(line)) {
      omitted = true;
      continue;
    }
    if (/\bwhat have you changed and why\b/i.test(line)) {
      omitted = true;
      continue;
    }
    if (/^\s*jira\s*:\s*https?:\/\/\S+\s*$/i.test(line)) {
      omitted = true;
      continue;
    }
    if (/^\s*\[[^\]]+\]:\s+https?:\/\/\S+\s*$/.test(line)) {
      omitted = true;
      continue;
    }
    retained.push(line);
  }

  return { text: retained.join("\n"), omitted };
};

export function createKnowledgeEvidenceView(
  record: Pick<EvidenceRecord, "type" | "content">,
  maxCharacters = contentLimitFor(record.type)
): KnowledgeEvidenceView {
  let text = record.content
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  let omittedSourceContent = text !== record.content.trim();

  if (record.type === "pull_request") {
    const diffFree = withoutRawDiff(text);
    const templateFree = withoutPullRequestTemplate(diffFree.text);
    text = templateFree.text;
    omittedSourceContent ||= diffFree.omitted || templateFree.omitted;
  }

  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (text.length > maxCharacters) {
    const boundary = text.lastIndexOf("\n", maxCharacters);
    text = text.slice(0, boundary > maxCharacters / 2 ? boundary : maxCharacters).trimEnd();
    omittedSourceContent = true;
  }

  return { text, omittedSourceContent };
}
