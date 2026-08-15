import type { SafetyReport } from "@lore/shared/types.js";

export function formatSafetyReport(report: SafetyReport): string {
  const section = (title: string, values: string[], fallback = "None"): string[] => [
    "",
    title,
    ...(values.length ? values.map((value) => `- ${value}`) : [`- ${fallback}`])
  ];

  return [
    "LORE CHANGE SAFETY REPORT",
    "",
    `Task: ${report.task}`,
    `Repository: ${report.repositoryName}`,
    `Overall risk: ${report.risk}`,
    ...section("Changed files", report.changedFiles.map((file) => `${file.path} (+${file.additions} / -${file.deletions})`)),
    ...section("Changed symbols", report.changedSymbols.map((symbol) => symbol.name)),
    ...section("Potentially affected", report.affectedCode.map((item) => `${item.name} — ${item.reason}`)),
    ...section("Applicable policies", report.applicablePolicies.map((policy) => `${policy.name} [${policy.severity}]`)),
    ...section("Applicable architecture rules", report.applicableRules.map((item) => item.title)),
    ...section("Relevant decisions", report.relevantDecisions.map((item) => item.title)),
    ...section("Historical regressions", report.historicalRegressions.map((item) => `${item.title} — ${item.description}`)),
    ...section("Tests changed", report.testsChanged),
    ...section("Tests recommended", report.testsRecommended.map((test) => `${test.path} — ${test.reason}`)),
    ...section("Warnings", report.warnings),
    ...section("Blockers", report.blockers),
    ...section("Unresolved uncertainty", report.unknowns),
    ...section("Why this risk level", report.riskReasons)
  ].join("\n");
}

