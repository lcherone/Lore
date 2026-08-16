import type { EvidenceRecord, KnowledgeKind } from "@lore/shared/types.js";
import { MockAIProvider } from "./mock-provider.js";

const emptyWireScope = {
  organisation: null,
  repository: null,
  paths: null,
  excludedPaths: null,
  symbols: null,
  subsystem: null,
  language: null,
  framework: null,
  team: null,
  reviewer: null,
  integration: null,
  ticketType: null
};

const signal = /\b(?:decision\s*:|rule\s*:|fact\s*:|warning\s*:|regression\s*:|we (?:decided|agreed)|must(?:\s+not)?|never|do not|should|need to|remember\s*:|prefer(?:s|red)?|broke|regression|risk\s*:)/i;

const classify = (value: string): KnowledgeKind => {
  if (/\b(?:regression|broke)\b/i.test(value)) return "regression";
  if (/\b(?:warning\s*:|risk\s*:)/i.test(value)) return "warning";
  if (/\b(?:we decided|we agreed|decision\s*:|agreed)\b/i.test(value)) return "decision";
  if (/\b(?:must(?:\s+not)?|never|do not|rule\s*:|need to|required)\b/i.test(value)) return "rule";
  if (/\b(?:should|prefer(?:s|red)?)\b/i.test(value)) return "preference";
  return "fact";
};

const normalise = (value: string): string => {
  const withoutSpeaker = value.replace(/^\s*[A-Za-z][\w .'-]{0,60}:\s*/, "");
  const withoutMarker = withoutSpeaker
    .replace(/^\s*(?:decision|rule|fact|warning|regression|risk|remember)\s*:\s*/i, "")
    .replace(/^\s*we\s+(?:decided|agreed)(?:\s+that)?\s+/i, "")
    .trim();
  if (!withoutMarker) return "";
  const sentence = `${withoutMarker[0]!.toUpperCase()}${withoutMarker.slice(1)}`;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
};

const titleFor = (statement: string): string => {
  const words = statement.replace(/[.!?]+$/, "").split(/\s+/).slice(0, 9);
  const title = words.join(" ");
  return title.length > 90 ? `${title.slice(0, 87)}…` : title;
};

function parseEvidence(raw: string): EvidenceRecord[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as EvidenceRecord[]) : [];
  } catch {
    return [];
  }
}

/** Deterministic local extractor used by demo mode and tests. It makes no network calls. */
export function createBundledMockAIProvider(): MockAIProvider {
  return new MockAIProvider((request) => {
    const evidence = parseEvidence(request.untrustedSourceContent);
    const ids = evidence.map((record) => record.id);
    const combined = evidence.map((record) => record.content).join("\n").toLowerCase();

    if (ids.length >= 2 && combined.includes("repository interface")) {
      return {
        candidates: [
          {
            kind: "preference",
            title: "Prefer repository interfaces at service boundaries",
            statement: "The observed reviewer tends to prefer repository interfaces at application service boundaries.",
            rationale: "The same explicit review request appears in independent evidence.",
            proposedScope: { ...emptyWireScope, paths: ["src/**/Service/**"] },
            evidenceIds: ids.slice(0, 5),
            possibleContradictionIds: []
          }
        ]
      };
    }

    const candidates = evidence
      .filter((record) => record.type === "communication")
      .flatMap((record) =>
        record.content
          .split(/\r?\n|(?<=[.!?])\s+(?=[A-Z])/)
          .map((part) => part.trim())
          .filter((part) => part.length >= 8 && signal.test(part))
          .map((part) => {
            const statement = normalise(part);
            return {
              kind: classify(part),
              title: titleFor(statement),
              statement,
              rationale: `Extracted from the human-submitted communication “${record.title ?? record.externalId}”; verify wording, context, and scope before approval.`,
              proposedScope: emptyWireScope,
              evidenceIds: [record.id],
              possibleContradictionIds: []
            };
          })
          .filter((candidate) => candidate.statement.length >= 8)
      )
      .slice(0, 50);

    return { candidates };
  });
}
