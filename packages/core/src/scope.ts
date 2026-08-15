import type { KnowledgeItem, KnowledgeScope, RepositorySummary } from "@lore/shared/types.js";

const PRECEDENCE: Record<string, number> = {
  policy: 100,
  compliance: 95,
  security: 90,
  symbol: 80,
  file: 70,
  directory: 60,
  repository: 50,
  team: 40,
  organisation: 30,
  preference: 20,
  inference: 10
};

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const source = escaped.replace(/\*\*/g, "§§DOUBLE§§").replace(/\*/g, "[^/]*").replace(/§§DOUBLE§§/g, ".*");
  return new RegExp(`^${source}$`);
}

export function matchesPath(path: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

export function scopeApplies(
  scope: KnowledgeScope,
  input: {
    repository: RepositorySummary;
    organisation?: string;
    paths?: string[];
    symbols?: string[];
    reviewer?: string;
    language?: string;
    framework?: string;
    team?: string;
    subsystem?: string;
    integration?: string;
    ticketType?: string;
  }
): boolean {
  if (scope.organisation && scope.organisation !== input.repository.organisationId && scope.organisation !== input.organisation) return false;
  if (scope.repository && scope.repository !== `${input.repository.owner}/${input.repository.name}` && scope.repository !== input.repository.id) {
    return false;
  }

  if (scope.reviewer && scope.reviewer !== input.reviewer) return false;

  const paths = input.paths ?? [];
  if (scope.paths && (paths.length === 0 || !paths.some((path) => matchesPath(path, scope.paths)))) return false;
  if (scope.excludedPaths && paths.some((path) => matchesPath(path, scope.excludedPaths))) return false;

  const symbols = input.symbols ?? [];
  if (scope.symbols && (symbols.length === 0 || !symbols.some((symbol) => scope.symbols?.includes(symbol)))) return false;

  const contextualText = [...paths, ...symbols].join(" ").toLowerCase();
  const dimensionMatches = (required: string | undefined, provided: string | undefined): boolean =>
    !required || provided?.toLowerCase().includes(required.toLowerCase()) || contextualText.includes(required.toLowerCase());
  if (!dimensionMatches(scope.language, input.language)) return false;
  if (!dimensionMatches(scope.framework, input.framework)) return false;
  if (!dimensionMatches(scope.team, input.team)) return false;
  if (!dimensionMatches(scope.subsystem, input.subsystem)) return false;
  if (!dimensionMatches(scope.integration, input.integration)) return false;
  if (!dimensionMatches(scope.ticketType, input.ticketType)) return false;

  return true;
}

export function scopeSpecificity(scope: KnowledgeScope): number {
  if (scope.symbols?.length) return PRECEDENCE.symbol!;
  if (scope.paths?.some((path) => !path.includes("*"))) return PRECEDENCE.file!;
  if (scope.paths?.length) return PRECEDENCE.directory!;
  if (scope.repository) return PRECEDENCE.repository!;
  if (scope.team) return PRECEDENCE.team!;
  if (scope.organisation) return PRECEDENCE.organisation!;
  return 0;
}

export function knowledgePrecedence(item: KnowledgeItem): number {
  if (item.kind === "policy") return PRECEDENCE.policy!;
  if (item.kind === "preference") return PRECEDENCE.preference! + scopeSpecificity(item.scope) / 100;
  if (item.kind === "inference") return PRECEDENCE.inference! + scopeSpecificity(item.scope) / 100;
  return scopeSpecificity(item.scope);
}

export function sortByPrecedence(items: KnowledgeItem[]): KnowledgeItem[] {
  return [...items].sort((left, right) => {
    const precedenceDelta = knowledgePrecedence(right) - knowledgePrecedence(left);
    return precedenceDelta || right.confidence - left.confidence || left.id.localeCompare(right.id);
  });
}
