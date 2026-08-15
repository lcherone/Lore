import { newUuid } from "@lore/shared/ids.js";
import { scopeApplies } from "@lore/core/index.js";
import { ImpactGraph } from "@lore/impact/index.js";
import { PolicyEvaluator } from "@lore/policy/index.js";
import type {
  ChangedFile,
  CodeEntity,
  CodeRelationship,
  DashboardSnapshot,
  RegressionRecord,
  RepositorySummary,
  RiskLevel,
  SafetyReport
} from "@lore/shared/types.js";

const isTestPath = (path: string): boolean => /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i.test(path);

const riskFromScore = (score: number, blocker: boolean): RiskLevel => {
  if (blocker || score >= 8) return "CRITICAL";
  if (score >= 5) return "HIGH";
  if (score >= 2) return "MEDIUM";
  return "LOW";
};

export class ChangeVerificationService {
  readonly #policyEvaluator = new PolicyEvaluator();

  verify(input: {
    task: string;
    repository: RepositorySummary;
    snapshot: DashboardSnapshot;
    changedFiles: ChangedFile[];
    entities: CodeEntity[];
    relationships: CodeRelationship[];
    regressions: RegressionRecord[];
  }): SafetyReport {
    const changedPaths = input.changedFiles.map((file) => file.path);
    const changedEntities = input.entities.filter((entity) => changedPaths.includes(entity.path));
    const graph = new ImpactGraph(input.entities, input.relationships);
    const impact = graph
      .traverse(
        changedEntities.map((entity) => entity.id),
        { maxDepth: 3, maximumNodes: 60, minimumConfidence: 0.36 }
      )
      .filter((node) => !changedPaths.includes(node.entity.path));
    const impactedTests = graph.testsFor(changedEntities.map((entity) => entity.id));
    const testsChanged = changedPaths.filter(isTestPath);
    const recommendedTests = [...new Map(impactedTests.map((node) => [node.entity.path, node])).values()].map((node) => ({
      path: node.entity.path,
      reason: node.viaRelationship === "historically_changes_with" ? "Git history links this test to a changed symbol." : node.reason
    }));
    const potentialMissingTests = recommendedTests.filter((test) => !testsChanged.includes(test.path));
    const applicableKnowledge = input.snapshot.knowledge.filter(
      (item) =>
        ["active", "challenged"].includes(item.status) &&
        scopeApplies(item.scope, {
          repository: input.repository,
          organisation: input.snapshot.organisation.slug,
          paths: changedPaths,
          symbols: changedEntities.map((entity) => entity.qualifiedName)
        })
    );
    const applicablePolicies = input.snapshot.policies.filter(
      (policy) => policy.enabled && scopeApplies(policy.scope, { repository: input.repository, organisation: input.snapshot.organisation.slug, paths: changedPaths })
    );
    const findings = this.#policyEvaluator.evaluate(input.repository, applicablePolicies, input.changedFiles, input.snapshot.organisation.slug);
    const relevantRegressions = input.regressions.filter((regression) =>
      regression.affectedEntities.some((affected) =>
        changedEntities.some(
          (entity) => entity.qualifiedName.includes(affected) || affected.includes(entity.qualifiedName) || entity.name === affected
        )
      )
    );
    const blockers = findings
      .filter((finding) => finding.severity === "blocker")
      .map((finding) => `${finding.policyName}: ${finding.message}`);
    const warnings = [
      ...findings
        .filter((finding) => finding.severity === "warning" || finding.severity === "error")
        .map((finding) => `${finding.policyName}: ${finding.message}`),
      ...potentialMissingTests.map((test) => `${test.path} is related to changed code but was not changed.`),
      ...relevantRegressions.map((regression) => `${regression.title}: ${regression.description}`)
    ];

    let riskScore = 0;
    const riskReasons: string[] = [];
    if (blockers.length > 0) riskReasons.push("A blocker policy was violated");
    if (findings.some((finding) => finding.severity === "error")) {
      riskScore += 3;
      riskReasons.push("An error-severity policy finding applies");
    }
    if (relevantRegressions.length > 0) {
      riskScore += 2 + Math.min(2, relevantRegressions.length - 1);
      riskReasons.push("A historical regression touches the same entities");
    }
    if (potentialMissingTests.length > 0) {
      riskScore += Math.min(3, potentialMissingTests.length);
      riskReasons.push(`${potentialMissingTests.length} related test${potentialMissingTests.length === 1 ? " is" : "s are"} not part of the change`);
    }
    if (impact.length > 10) {
      riskScore += 2;
      riskReasons.push("The bounded graph found more than ten affected entities");
    }
    if (changedEntities.some((entity) => entity.type === "interface" || entity.type === "external_api" || entity.type === "database_table")) {
      riskScore += 2;
      riskReasons.push("A public contract or persistent boundary changed");
    }
    if (riskReasons.length === 0) riskReasons.push("No policy, regression, impact, or test gap raised the risk level");

    return {
      id: newUuid(),
      task: input.task,
      repositoryId: input.repository.id,
      repositoryName: `${input.repository.owner}/${input.repository.name}`,
      changedFiles: input.changedFiles,
      changedSymbols: changedEntities
        .filter((entity) => entity.type !== "file")
        .map((entity) => ({ name: entity.qualifiedName, path: entity.path })),
      affectedCode: impact.slice(0, 30).map((node) => ({
        name: node.entity.qualifiedName,
        path: node.entity.path,
        reason: node.reason,
        confidence: node.confidence
      })),
      applicablePolicies,
      applicableRules: applicableKnowledge.filter((item) => item.kind === "rule"),
      relevantDecisions: applicableKnowledge.filter((item) => item.kind === "decision"),
      historicalRegressions: relevantRegressions,
      testsChanged,
      testsRecommended: recommendedTests,
      potentialMissingTests,
      findings,
      warnings,
      blockers,
      unknowns: impact.length === 0 ? ["No downstream consumers passed the confidence threshold; dynamic resolution remains unproven."] : [],
      risk: riskFromScore(riskScore, blockers.length > 0),
      riskReasons,
      evidenceCount: new Set([
        ...applicableKnowledge.flatMap((item) => item.evidenceIds),
        ...relevantRegressions.flatMap((regression) => regression.evidenceIds)
      ]).size,
      createdAt: new Date().toISOString()
    };
  }
}
