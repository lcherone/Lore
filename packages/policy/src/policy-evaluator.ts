import { matchesPath, scopeApplies } from "@lore/core/index.js";
import type {
  ChangedFile,
  PolicyFinding,
  PolicyRecord,
  RepositorySummary
} from "@lore/shared/types.js";

const lineForIndex = (content: string, index: number): number => content.slice(0, index).split("\n").length;

const safeExpression = (pattern: string): RegExp | undefined => {
  try {
    return new RegExp(pattern, "gi");
  } catch {
    return undefined;
  }
};

const redact = (value: string): string =>
  value
    .replace(/(?:ghp_|github_pat_|sk-proj-|sk-)[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(/(authorization\s*[:=]\s*)\S+/gi, "$1[REDACTED]")
    .slice(0, 180);

export class PolicyEvaluator {
  evaluate(repository: RepositorySummary, policies: PolicyRecord[], changedFiles: ChangedFile[]): PolicyFinding[] {
    const findings: PolicyFinding[] = [];
    const changedPaths = changedFiles.map((file) => file.path);

    for (const policy of policies.filter((item) => item.enabled)) {
      if (!scopeApplies(policy.scope, { repository, paths: changedPaths })) continue;
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
          const patch = file.patch ?? "";
          for (const imported of detector.imports) {
            const index = patch.indexOf(imported);
            if (index < 0) continue;
            findings.push({
              policyId: policy.id,
              policyName: policy.name,
              severity: policy.severity,
              path: file.path,
              line: lineForIndex(patch, index),
              message: detector.message,
              evidence: `Import contains: ${imported}`
            });
          }
        }
      }

      if (detector.type === "forbidden_pattern" || detector.type === "secret_scan") {
        for (const file of changedFiles) {
          const patch = file.patch ?? "";
          const addedLines = patch
            .split("\n")
            .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
            .join("\n");
          for (const pattern of detector.patterns) {
            const expression = safeExpression(pattern);
            if (!expression) continue;
            const match = expression.exec(addedLines);
            if (!match) continue;
            const lineStart = addedLines.lastIndexOf("\n", match.index) + 1;
            const followingBreak = addedLines.indexOf("\n", match.index);
            const lineEnd = followingBreak < 0 ? addedLines.length : followingBreak;
            findings.push({
              policyId: policy.id,
              policyName: policy.name,
              severity: policy.severity,
              path: file.path,
              line: lineForIndex(addedLines, match.index),
              message: detector.message,
              evidence: redact(addedLines.slice(lineStart, lineEnd))
            });
          }
        }
      }
    }

    return findings;
  }
}
