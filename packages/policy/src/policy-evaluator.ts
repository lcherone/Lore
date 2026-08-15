import { matchesPath, scopeApplies } from "@lore/core/index.js";
import type {
  ChangedFile,
  PolicyFinding,
  PolicyRecord,
  RepositorySummary
} from "@lore/shared/types.js";
import { policyPatternError } from "@lore/shared/policy-patterns.js";

const safeExpression = (pattern: string): RegExp | undefined => {
  if (policyPatternError(pattern)) return undefined;
  try {
    return new RegExp(pattern, "i");
  } catch {
    return undefined;
  }
};

const addedSourceLines = (patch: string): Array<{ content: string; line: number }> => {
  const added: Array<{ content: string; line: number }> = [];
  let targetLine = 0;
  for (const line of patch.split("\n")) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      targetLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith("+++")) continue;
    if (line.startsWith("+")) {
      targetLine = targetLine || 1;
      added.push({ content: line.slice(1), line: targetLine });
      targetLine += 1;
    } else if (!line.startsWith("-") && targetLine > 0) {
      targetLine += 1;
    }
  }
  return added;
};

const redact = (value: string): string =>
  value
    .replace(/(?:ghp_|github_pat_|sk-proj-|sk-)[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(/(authorization\s*[:=]\s*)\S+/gi, "$1[REDACTED]")
    .slice(0, 180);

export class PolicyEvaluator {
  evaluate(repository: RepositorySummary, policies: PolicyRecord[], changedFiles: ChangedFile[], organisation?: string): PolicyFinding[] {
    const findings: PolicyFinding[] = [];
    const changedPaths = changedFiles.map((file) => file.path);

    for (const policy of policies.filter((item) => item.enabled)) {
      if (!scopeApplies(policy.scope, { repository, organisation, paths: changedPaths })) continue;
      const detector = policy.detector;

      if (detector.type === "forbidden_path") {
        for (const file of changedFiles.filter((item) => matchesPath(item.path, detector.paths))) {
          findings.push({
            policyId: policy.id,
            policyName: policy.name,
            severity: policy.severity,
            path: file.path,
            message: detector.message,
            evidence: `Changed forbidden path: ${file.path}`
          });
        }
      }

      if (detector.type === "required_test") {
        const trigger = changedPaths.some((path) => matchesPath(path, detector.whenPaths));
        const satisfied = changedPaths.some((path) => matchesPath(path, detector.testPaths));
        if (trigger && !satisfied) {
          findings.push({
            policyId: policy.id,
            policyName: policy.name,
            severity: policy.severity,
            path: changedPaths.find((path) => matchesPath(path, detector.whenPaths)) ?? changedPaths[0] ?? "unknown",
            message: detector.message,
            evidence: `No changed path matched required tests: ${detector.testPaths.join(", ")}`
          });
        }
      }

      if (detector.type === "forbidden_import") {
        for (const file of changedFiles) {
          const added = addedSourceLines(file.patch ?? "");
          for (const imported of detector.imports) {
            const match = added.find((line) => line.content.includes(imported));
            if (!match) continue;
            findings.push({
              policyId: policy.id,
              policyName: policy.name,
              severity: policy.severity,
              path: file.path,
              line: match.line,
              message: detector.message,
              evidence: `Import contains: ${imported}`
            });
          }
        }
      }

      if (detector.type === "forbidden_pattern" || detector.type === "secret_scan") {
        for (const file of changedFiles) {
          const added = addedSourceLines(file.patch ?? "");
          for (const pattern of detector.patterns) {
            const expression = safeExpression(pattern);
            if (!expression) continue;
            const match = added.find((line) => expression.test(line.content));
            if (!match) continue;
            findings.push({
              policyId: policy.id,
              policyName: policy.name,
              severity: policy.severity,
              path: file.path,
              line: match.line,
              message: detector.message,
              evidence: redact(match.content)
            });
          }
        }
      }
    }

    return findings;
  }
}
