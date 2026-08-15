import type {
  AgentSession,
  CandidateRecord,
  DashboardSnapshot,
  EvidenceRecord,
  KnowledgeItem,
  PolicyRecord,
  RepositorySummary,
  ReviewerProfile,
  SafetyReport
} from "./types.js";

export const DEMO_ORGANISATION_ID = "org_acme";
export const DEMO_REPOSITORY_ID = "repo_soho_ecom";

const repository: RepositorySummary = {
  id: DEMO_REPOSITORY_ID,
  organisationId: DEMO_ORGANISATION_ID,
  provider: "github",
  providerRepositoryId: "73421009",
  providerInstallationId: "123",
  owner: "soho",
  name: "ecom",
  defaultBranch: "main",
  cloneUrl: "git@github.com:soho/ecom.git",
  localPath: "/clients/soho/ecom",
  languageSummary: { PHP: 68, TypeScript: 21, JavaScript: 8, Other: 3 },
  retentionConfig: {
    retainRawPullRequestDiff: false,
    retainSummariesOnly: false,
    retainReviewComments: true,
    retainCodeSnippets: false
  },
  lastIndexedCommit: "6b17d4a",
  indexedAt: "2026-08-15T20:56:00.000Z",
  entityCount: 18_462,
  relationshipCount: 74_921,
  status: "ready"
};

const evidence: Record<string, EvidenceRecord> = {
  ev1832: {
    id: "ev1832",
    organisationId: DEMO_ORGANISATION_ID,
    repositoryId: DEMO_REPOSITORY_ID,
    type: "review_comment",
    provider: "github",
    externalId: "review-comment-1832-4",
    url: "https://github.com/soho/ecom/pull/1832#discussion_r4",
    title: "PR #1832 review comment",
    content: "Let's keep service boundaries clean — depend on repository interfaces, not concrete implementations.",
    author: "Joe Hart",
    occurredAt: "2026-05-03T11:22:00.000Z",
    metadata: { pullRequest: 1832, path: "src/Order/Service/OrderCreator.php" }
  },
  ev1941: {
    id: "ev1941",
    organisationId: DEMO_ORGANISATION_ID,
    repositoryId: DEMO_REPOSITORY_ID,
    type: "pull_request",
    provider: "github",
    externalId: "pr-1941",
    url: "https://github.com/soho/ecom/pull/1941",
    title: "PR #1941 approved implementation",
    content: "Refactored OrderService to depend on IOrderRepository. Reviewed and approved.",
    author: "Casey Hall",
    occurredAt: "2026-06-17T14:08:00.000Z",
    metadata: { pullRequest: 1941, approved: true }
  },
  ev2017: {
    id: "ev2017",
    organisationId: DEMO_ORGANISATION_ID,
    repositoryId: DEMO_REPOSITORY_ID,
    type: "review_comment",
    provider: "github",
    externalId: "review-comment-2017-2",
    url: "https://github.com/soho/ecom/pull/2017#discussion_r2",
    title: "PR #2017 explicit confirmation",
    content: "Following the established pattern: application service depends on interface, infrastructure provides implementation.",
    author: "Rebecca Stone",
    occurredAt: "2026-07-02T09:14:00.000Z",
    metadata: { pullRequest: 2017, explicit: true }
  },
  ev782: {
    id: "ev782",
    organisationId: DEMO_ORGANISATION_ID,
    repositoryId: DEMO_REPOSITORY_ID,
    type: "incident",
    provider: "github",
    externalId: "regression-pr-782",
    url: "https://github.com/soho/ecom/pull/782",
    title: "PR #782 refund regression",
    content: "Changing AddressCode::fromRole caused refund tax requests to reuse the ShipTo code for ShipFrom.",
    author: "Engineering",
    occurredAt: "2025-11-12T15:36:00.000Z",
    metadata: { pullRequest: 782, fixedBy: 791, severity: "warning" }
  },
  ev918: {
    id: "ev918",
    organisationId: DEMO_ORGANISATION_ID,
    repositoryId: DEMO_REPOSITORY_ID,
    type: "pull_request",
    provider: "github",
    externalId: "pr-918",
    url: "https://github.com/soho/ecom/pull/918",
    title: "Preserve OMS basket search behaviour",
    content: "OMS basket search intentionally skips the storefront Active filter so customer service can add region-enabled priced SKUs.",
    author: "Rebecca Stone",
    occurredAt: "2025-12-04T10:31:00.000Z",
    metadata: { pullRequest: 918, ticket: "SS-2189" }
  },
  ev6160: {
    id: "ev6160",
    organisationId: DEMO_ORGANISATION_ID,
    repositoryId: DEMO_REPOSITORY_ID,
    type: "ticket",
    provider: "jira",
    externalId: "SS-6160",
    title: "Separate Avalara ShipFrom and ShipTo address codes",
    content: "Avalara address roles require distinct codes. Refund and create flows must map them independently.",
    author: "Product",
    occurredAt: "2026-02-15T08:00:00.000Z",
    metadata: { ticket: "SS-6160" }
  },
  evTaxMapper: {
    id: "evTaxMapper",
    organisationId: DEMO_ORGANISATION_ID,
    repositoryId: DEMO_REPOSITORY_ID,
    type: "code",
    provider: "local",
    externalId: "code-tax-mapper-v4",
    title: "Tax mapper boundary",
    content: "All three tax transaction flows construct their external payload through mapper classes.",
    occurredAt: "2026-08-15T20:54:00.000Z",
    metadata: { paths: ["src/Tax/Mappers/**"] }
  },
  evManualPolicy: {
    id: "evManualPolicy",
    organisationId: DEMO_ORGANISATION_ID,
    type: "manual_confirmation",
    provider: "lore",
    externalId: "policy-security-1",
    title: "Security policy approved by platform owner",
    content: "Authentication tokens and API credentials must never be logged.",
    author: "Amira Patel",
    occurredAt: "2026-01-10T09:00:00.000Z",
    metadata: { owner: "Platform Security" }
  }
};

const common = {
  organisationId: DEMO_ORGANISATION_ID,
  repositoryId: DEMO_REPOSITORY_ID,
  createdBy: "lore:historical-import",
  createdAt: "2026-08-10T09:00:00.000Z",
  updatedAt: "2026-08-15T18:00:00.000Z"
};

const knowledge: KnowledgeItem[] = [
  {
    ...common,
    id: "knowledge_oms_filter",
    kind: "decision",
    status: "active",
    title: "OMS basket search preserves inactive SKUs",
    statement: "OMS basket searches intentionally do not apply the normal storefront Active filter.",
    rationale: "Customer-service staff must add region-enabled, priced SKUs that are not visible on the storefront.",
    confidence: 0.97,
    severity: "warning",
    scope: { repository: "soho/ecom", paths: ["src/Search/Basket/**"], subsystem: "CP/POS" },
    lastConfirmedAt: "2026-07-29T12:00:00.000Z",
    evidenceIds: ["ev918"],
    contradictionCount: 0,
    health: "healthy"
  },
  {
    ...common,
    id: "knowledge_tax_mapper",
    kind: "rule",
    status: "active",
    title: "External tax payloads belong in mappers",
    statement: "External tax payloads must be created by mapper classes, not API clients.",
    rationale: "This keeps formatting rules shared between create and refund transaction flows.",
    confidence: 0.93,
    severity: "warning",
    scope: { repository: "soho/ecom", paths: ["src/Tax/**"], integration: "Avalara" },
    lastConfirmedAt: "2026-08-05T12:00:00.000Z",
    evidenceIds: ["evTaxMapper", "ev6160"],
    contradictionCount: 0,
    health: "healthy"
  },
  {
    ...common,
    id: "knowledge_avalara_codes",
    kind: "decision",
    status: "active",
    title: "Avalara address roles require distinct codes",
    statement: "ShipFrom and ShipTo addresses must receive independent address codes in Avalara payloads.",
    rationale: "Reusing the role code caused refund requests to resolve the wrong address.",
    confidence: 0.98,
    severity: "error",
    scope: {
      repository: "soho/ecom",
      paths: ["src/Tax/Avalara/**"],
      symbols: ["AddressCode::fromRole", "AvalaraTransactionMapper::mapAddresses"]
    },
    lastConfirmedAt: "2026-08-01T10:00:00.000Z",
    evidenceIds: ["ev6160", "ev782"],
    contradictionCount: 0,
    health: "healthy"
  },
  {
    ...common,
    id: "knowledge_joe_interfaces",
    kind: "preference",
    status: "active",
    title: "Joe prefers repository interfaces",
    statement: "Joe tends to prefer application services typed against repository interfaces.",
    rationale: "The same review request appeared in three independent pull requests.",
    confidence: 0.78,
    severity: "suggestion",
    scope: { repository: "soho/ecom", reviewer: "joe@acme.example", paths: ["src/**/Service/**"] },
    lastConfirmedAt: "2026-07-02T09:14:00.000Z",
    evidenceIds: ["ev1832", "ev1941", "ev2017"],
    contradictionCount: 0,
    health: "healthy"
  },
  {
    ...common,
    id: "knowledge_bc_address",
    kind: "warning",
    status: "challenged",
    title: "Delivery address return shape feeds Business Central",
    statement: "Changing Order::getDeliveryAddress return semantics can affect BusinessCentralOrderExporter.",
    rationale: "Static usage remains, but two new exporter paths have not yet been classified.",
    confidence: 0.68,
    severity: "warning",
    scope: { repository: "soho/ecom", symbols: ["Order::getDeliveryAddress"], integration: "Business Central" },
    lastConfirmedAt: "2025-11-21T11:00:00.000Z",
    evidenceIds: [],
    contradictionCount: 2,
    health: "conflicted"
  },
  {
    ...common,
    id: "knowledge_legacy_api",
    kind: "rule",
    status: "active",
    title: "Legacy API adapter owns date normalisation",
    statement: "Legacy API dates are normalised at the adapter boundary.",
    rationale: "Keeping normalisation at one boundary prevents timezone drift in consumers.",
    confidence: 0.59,
    severity: "suggestion",
    scope: { repository: "soho/ecom", paths: ["src/Integration/Legacy/**"] },
    lastConfirmedAt: "2024-09-15T11:00:00.000Z",
    evidenceIds: [],
    contradictionCount: 0,
    health: "stale"
  }
];

const candidateBase = {
  ...common,
  status: "candidate" as const,
  health: "needs_review" as const,
  contradictionCount: 0
};

const candidates: CandidateRecord[] = [
  {
    ...candidateBase,
    id: "candidate_interfaces",
    kind: "rule",
    title: "Use repository interfaces at service boundaries",
    statement: "Application services in soho/ecom should depend on repository interfaces rather than concrete implementations.",
    rationale: "Three independent approved PRs reinforce the same service-boundary pattern.",
    confidence: 0.82,
    severity: "warning",
    scope: { repository: "soho/ecom", paths: ["src/**/Service/**"], excludedPaths: ["src/Migrations/**"] },
    evidenceIds: ["ev1832", "ev1941", "ev2017"],
    evidence: [evidence.ev1832!, evidence.ev1941!, evidence.ev2017!],
    contradictionSummaries: [
      "2 approved migration commands use concrete repositories. The proposed exclusion keeps this scope narrow."
    ],
    confidenceFactors: {
      supportingObservations: 6,
      independentPullRequests: 3,
      independentReviewers: 2,
      recency: 0.94,
      explicitness: 0.86,
      sourceReliability: 0.9,
      contradictions: 2,
      humanConfirmed: false,
      scopeStable: true,
      codeStillMatches: true
    },
    proposedExclusion: "src/Migrations/**"
  },
  {
    ...candidateBase,
    id: "candidate_oms",
    kind: "decision",
    title: "OMS basket search preserves inactive SKUs",
    statement: "OMS basket search keeps region-enabled priced SKUs even when the storefront Active filter would hide them.",
    rationale: "PR and ticket evidence describe this as deliberate CP/POS behaviour.",
    confidence: 0.78,
    severity: "warning",
    scope: { repository: "soho/ecom", paths: ["src/Search/Basket/**"], subsystem: "CP/POS" },
    evidenceIds: ["ev918"],
    evidence: [evidence.ev918!],
    contradictionSummaries: [],
    confidenceFactors: {
      supportingObservations: 4,
      independentPullRequests: 2,
      independentReviewers: 2,
      recency: 0.82,
      explicitness: 0.95,
      sourceReliability: 0.92,
      contradictions: 0,
      humanConfirmed: true,
      scopeStable: true,
      codeStillMatches: true
    }
  },
  {
    ...candidateBase,
    id: "candidate_avalara",
    kind: "rule",
    title: "Avalara address roles require distinct codes",
    statement: "Avalara ShipFrom and ShipTo addresses should use independent address codes.",
    rationale: "A ticket and prior regression both concern reused role codes.",
    confidence: 0.74,
    severity: "error",
    scope: { repository: "soho/ecom", paths: ["src/Tax/Avalara/**"] },
    evidenceIds: ["ev6160", "ev782"],
    evidence: [evidence.ev6160!, evidence.ev782!],
    contradictionSummaries: [],
    confidenceFactors: {
      supportingObservations: 5,
      independentPullRequests: 2,
      independentReviewers: 1,
      recency: 0.89,
      explicitness: 0.94,
      sourceReliability: 0.91,
      contradictions: 0,
      humanConfirmed: false,
      scopeStable: true,
      codeStillMatches: true
    }
  },
  {
    ...candidateBase,
    id: "candidate_dtos",
    kind: "preference",
    title: "Joe prefers DTOs for external payloads",
    statement: "Joe tends to prefer typed DTOs for external service payloads.",
    rationale: "Three similarly worded review comments came from the same reviewer.",
    confidence: 0.69,
    severity: "suggestion",
    scope: { repository: "soho/ecom", reviewer: "joe@acme.example", integration: "external API" },
    evidenceIds: ["ev1832"],
    evidence: [evidence.ev1832!],
    contradictionSummaries: [],
    confidenceFactors: {
      supportingObservations: 3,
      independentPullRequests: 3,
      independentReviewers: 1,
      recency: 0.9,
      explicitness: 0.72,
      sourceReliability: 0.8,
      contradictions: 0,
      humanConfirmed: false,
      scopeStable: true,
      codeStillMatches: true
    }
  },
  {
    ...candidateBase,
    id: "candidate_refund_tests",
    kind: "rule",
    title: "Refund mappings need mirrored tests",
    statement: "Changes to create-transaction mapping should also exercise the corresponding refund mapping tests.",
    rationale: "Create and refund mappers changed together in seven of eight relevant commits.",
    confidence: 0.66,
    severity: "warning",
    scope: { repository: "soho/ecom", paths: ["src/Tax/**", "tests/Tax/**"] },
    evidenceIds: ["ev782"],
    evidence: [evidence.ev782!],
    contradictionSummaries: [],
    confidenceFactors: {
      supportingObservations: 7,
      independentPullRequests: 4,
      independentReviewers: 2,
      recency: 0.74,
      explicitness: 0.58,
      sourceReliability: 0.82,
      contradictions: 1,
      humanConfirmed: false,
      scopeStable: true,
      codeStillMatches: true
    }
  },
  {
    ...candidateBase,
    id: "candidate_migrations",
    kind: "rule",
    title: "Migration commands may use concrete repositories",
    statement: "Migration commands may depend on concrete repositories when the interface omits one-off migration operations.",
    rationale: "Two approved migrations are consistent exceptions to the wider service-boundary convention.",
    confidence: 0.58,
    severity: "suggestion",
    scope: { repository: "soho/ecom", paths: ["src/Migrations/**"] },
    evidenceIds: ["ev1941"],
    evidence: [evidence.ev1941!],
    contradictionSummaries: [],
    confidenceFactors: {
      supportingObservations: 2,
      independentPullRequests: 2,
      independentReviewers: 2,
      recency: 0.88,
      explicitness: 0.6,
      sourceReliability: 0.78,
      contradictions: 0,
      humanConfirmed: false,
      scopeStable: false,
      codeStillMatches: true
    }
  }
];

const policies: PolicyRecord[] = [
  {
    id: "policy_secrets",
    organisationId: DEMO_ORGANISATION_ID,
    name: "Never log credentials",
    description: "Authentication tokens, API credentials, and private keys must never be written to logs.",
    owner: "Platform Security",
    severity: "blocker",
    scope: { organisation: "acme-engineering" },
    enabled: true,
    detector: {
      type: "secret_scan",
      patterns: ["authorization\\s*[:=]", "api[_-]?key\\s*[:=]", "private[_-]?key\\s*[:=]"],
      message: "Potential credential material was added to a log or source file."
    },
    createdAt: "2026-01-10T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z"
  },
  {
    id: "policy_tax_client",
    organisationId: DEMO_ORGANISATION_ID,
    repositoryId: DEMO_REPOSITORY_ID,
    name: "Tax clients do not build payloads",
    description: "Avalara client classes must delegate request payload construction to mapper classes.",
    owner: "Commerce Architecture",
    severity: "error",
    scope: { repository: "soho/ecom", paths: ["src/Tax/**/*Client*"], integration: "Avalara" },
    enabled: true,
    detector: {
      type: "forbidden_pattern",
      patterns: ["ShipFrom\\s*=>", "ShipTo\\s*=>"],
      message: "Move address payload construction into an Avalara mapper."
    },
    createdAt: "2026-02-18T09:00:00.000Z",
    updatedAt: "2026-07-30T09:00:00.000Z"
  },
  {
    id: "policy_production_tests",
    organisationId: DEMO_ORGANISATION_ID,
    name: "Tests never access production",
    description: "Test configuration must not contain production database or service endpoints.",
    owner: "Platform Security",
    severity: "blocker",
    scope: { organisation: "acme-engineering", paths: ["**/tests/**", "**/*.test.*"] },
    enabled: true,
    detector: {
      type: "forbidden_pattern",
      patterns: ["prod(?:uction)?\\.(?:db|internal)", "DATABASE_URL=.*prod"],
      message: "Production connection material is forbidden in tests."
    },
    createdAt: "2026-01-12T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z"
  }
];

const reports: SafetyReport[] = [
  {
    id: "report_avalara",
    task: "SS-6160 Update Avalara ShipFrom and ShipTo addresses",
    repositoryId: DEMO_REPOSITORY_ID,
    repositoryName: "soho/ecom",
    changedFiles: [
      { path: "src/Tax/Avalara/AvalaraTransactionMapper.php", status: "modified", additions: 18, deletions: 7 },
      { path: "src/Tax/Avalara/AddressCode.php", status: "modified", additions: 6, deletions: 2 }
    ],
    changedSymbols: [
      { name: "AvalaraTransactionMapper::mapAddresses", path: "src/Tax/Avalara/AvalaraTransactionMapper.php" },
      { name: "AddressCode::fromRole", path: "src/Tax/Avalara/AddressCode.php" }
    ],
    affectedCode: [
      { name: "CreateTaxTransaction", path: "src/Tax/CreateTaxTransaction.php", reason: "Direct mapper consumer", confidence: 0.97 },
      { name: "RefundTaxTransaction", path: "src/Tax/RefundTaxTransaction.php", reason: "Consumes AddressCode::fromRole", confidence: 0.94 }
    ],
    applicablePolicies: [policies[1]!],
    applicableRules: [knowledge[1]!],
    relevantDecisions: [knowledge[2]!],
    historicalRegressions: [
      {
        id: "regression_refund",
        repositoryId: DEMO_REPOSITORY_ID,
        title: "Address role mapping broke refund tax requests",
        description: evidence.ev782!.content,
        pullRequestId: "782",
        affectedEntities: ["AddressCode::fromRole", "RefundTaxTransaction"],
        evidenceIds: ["ev782"],
        severity: "warning",
        createdAt: "2025-11-12T15:36:00.000Z"
      }
    ],
    testsChanged: ["tests/Tax/AvalaraTransactionMapperTest.php"],
    testsRecommended: [
      { path: "tests/Tax/RefundTaxTransactionTest.php", reason: "Historically changes with AddressCode and covers the previous regression" }
    ],
    potentialMissingTests: [
      { path: "tests/Tax/RefundTaxTransactionTest.php", reason: "Affected direct consumer has not changed" }
    ],
    findings: [],
    warnings: ["RefundTaxTransaction uses AddressCode::fromRole but its focused test is unchanged."],
    blockers: [],
    unknowns: ["Dynamic container aliases may expose additional mapper consumers."],
    risk: "MEDIUM",
    riskReasons: ["Historical regression on the same symbol", "One affected consumer test is missing"],
    evidenceCount: 12,
    createdAt: "2026-08-15T19:02:00.000Z"
  },
  {
    id: "report_basket",
    task: "Preserve OMS basket search active-filter behaviour",
    repositoryId: DEMO_REPOSITORY_ID,
    repositoryName: "soho/ecom",
    changedFiles: [{ path: "src/Search/Basket/BasketSearch.php", status: "modified", additions: 4, deletions: 3 }],
    changedSymbols: [{ name: "BasketSearch::applyActiveFilter", path: "src/Search/Basket/BasketSearch.php" }],
    affectedCode: [],
    applicablePolicies: [],
    applicableRules: [],
    relevantDecisions: [knowledge[0]!],
    historicalRegressions: [],
    testsChanged: ["tests/Search/BasketSearchTest.php"],
    testsRecommended: [],
    potentialMissingTests: [],
    findings: [],
    warnings: [],
    blockers: [],
    unknowns: [],
    risk: "LOW",
    riskReasons: ["Relevant decision followed and focused test changed"],
    evidenceCount: 7,
    createdAt: "2026-08-15T15:02:00.000Z"
  },
  {
    id: "report_token",
    task: "Add checkout diagnostics",
    repositoryId: DEMO_REPOSITORY_ID,
    repositoryName: "soho/ecom",
    changedFiles: [{ path: "src/Checkout/AuthClient.php", status: "modified", additions: 11, deletions: 0 }],
    changedSymbols: [{ name: "AuthClient::send", path: "src/Checkout/AuthClient.php" }],
    affectedCode: [],
    applicablePolicies: [policies[0]!],
    applicableRules: [],
    relevantDecisions: [],
    historicalRegressions: [],
    testsChanged: [],
    testsRecommended: [],
    potentialMissingTests: [],
    findings: [
      {
        policyId: "policy_secrets",
        policyName: "Never log credentials",
        severity: "blocker",
        path: "src/Checkout/AuthClient.php",
        line: 88,
        message: "Potential credential material was added to a log or source file.",
        evidence: "logger->debug('authorization=' . $token)"
      }
    ],
    warnings: [],
    blockers: ["A blocker security policy detected credential logging."],
    unknowns: [],
    risk: "CRITICAL",
    riskReasons: ["Blocker security policy violation"],
    evidenceCount: 15,
    createdAt: "2026-08-14T18:10:00.000Z"
  }
];

const reviewers: ReviewerProfile[] = [
  {
    id: "reviewer_joe",
    name: "Joe Hart",
    providerIdentity: "joe-hart",
    email: "joe@acme.example",
    preferenceCount: 4,
    reinforcedCount: 18,
    lastObservedAt: "2026-08-12T13:10:00.000Z"
  },
  {
    id: "reviewer_rebecca",
    name: "Rebecca Stone",
    providerIdentity: "rebecca-stone",
    email: "rebecca@acme.example",
    preferenceCount: 2,
    reinforcedCount: 11,
    lastObservedAt: "2026-08-14T09:42:00.000Z"
  }
];

const sessions: AgentSession[] = [
  {
    id: "session_6160",
    organisationId: DEMO_ORGANISATION_ID,
    repositoryId: DEMO_REPOSITORY_ID,
    task: "SS-6160 Update Avalara ShipFrom and ShipTo addresses",
    status: "active",
    baseCommit: "6b17d4a",
    currentCommit: "6b17d4a",
    startedAt: "2026-08-15T18:32:00.000Z",
    agentType: "codex",
    filesObserved: ["src/Tax/Avalara/AvalaraTransactionMapper.php", "src/Tax/Avalara/AddressCode.php"],
    filesChanged: ["src/Tax/Avalara/AvalaraTransactionMapper.php"],
    warningCount: 1
  },
  {
    id: "session_basket",
    organisationId: DEMO_ORGANISATION_ID,
    repositoryId: DEMO_REPOSITORY_ID,
    task: "Preserve OMS basket search behaviour",
    status: "completed",
    baseCommit: "3fa89dd",
    currentCommit: "f119c2e",
    startedAt: "2026-08-15T12:05:00.000Z",
    completedAt: "2026-08-15T14:58:00.000Z",
    agentType: "claude",
    filesObserved: ["src/Search/Basket/BasketSearch.php"],
    filesChanged: ["src/Search/Basket/BasketSearch.php", "tests/Search/BasketSearchTest.php"],
    warningCount: 0
  }
];

const snapshot: DashboardSnapshot = {
  organisation: { id: DEMO_ORGANISATION_ID, name: "Acme Engineering", slug: "acme-engineering" },
  repositories: [repository],
  knowledge,
  candidates,
  policies,
  reports,
  reviewers,
  sessions
};

export function createDemoSnapshot(): DashboardSnapshot {
  return structuredClone(snapshot);
}

export function getDemoEvidence(): EvidenceRecord[] {
  return structuredClone(Object.values(evidence));
}
