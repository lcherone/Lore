import type { ContextPackage } from "@lore/shared/types.js";

const percent = (value: number): string => `${Math.round(value * 100)}%`;

export function formatContextPackage(context: ContextPackage): string {
  const lines = [
    "LORE CONTEXT PACKAGE",
    "",
    `Task: ${context.task.text}`,
    `Repository: ${context.repository.owner}/${context.repository.name}`,
    "",
    "Relevant files:"
  ];
  lines.push(...context.candidateFiles.map((file) => `- ${file.path} (${percent(file.confidence)}) — ${file.reason}`));
  lines.push("", "Potential impact:");
  lines.push(...(context.affectedAreas.length ? context.affectedAreas.map((area) => `- ${area.name} — ${area.reason}`) : ["- No downstream entity passed the confidence threshold."]));

  const knowledge = [...context.policies, ...context.rules, ...context.decisions, ...context.preferences];
  lines.push("", "Relevant knowledge:");
  lines.push(
    ...(knowledge.length
      ? knowledge.map((entry) => `- [${entry.priority.toUpperCase()}] ${"name" in entry.item ? entry.item.name : entry.item.title} (${percent(entry.confidence)})\n  ${entry.reason}`)
      : ["- No applicable knowledge found."])
  );
  lines.push("", "Historical regressions:");
  lines.push(...(context.historicalRegressions.length ? context.historicalRegressions.map((entry) => `- ${entry.item.title} — ${entry.reason}`) : ["- None found."]));
  lines.push("", "Recommended tests:");
  lines.push(...(context.recommendedTests.length ? context.recommendedTests.map((test) => `- ${test.path} — ${test.reason}`) : ["- None found."]));
  lines.push("", "Unknowns:");
  lines.push(...context.unknowns.map((unknown) => `- ${unknown.statement} ${unknown.suggestion}`));
  return lines.join("\n");
}

export function formatAgentInstructions(context: ContextPackage): string {
  return [
    "# Lore session context",
    "",
    "This context was prepared before repository changes. Treat policies as mandatory and verify the change before completion.",
    "",
    formatContextPackage(context),
    "",
    "Before completion: run `lore verify` and address any blockers."
  ].join("\n");
}

