import { z } from "zod";

export const pullRequestImportLimitSchema = z.union([
  z.literal(50),
  z.literal(100),
  z.literal(250),
  z.literal(500),
  z.literal(1000),
  z.literal("all")
]);

export const repositoryRetentionConfigSchema = z.object({
  retainRawPullRequestDiff: z.boolean().default(false),
  retainSummariesOnly: z.boolean().default(false),
  retainReviewComments: z.boolean().default(true),
  retainCodeSnippets: z.boolean().default(false)
}).strict().superRefine((value, context) => {
  if (value.retainSummariesOnly && (value.retainRawPullRequestDiff || value.retainCodeSnippets)) {
    context.addIssue({ code: "custom", message: "Summary-only retention cannot also retain raw diffs or code snippets" });
  }
});

export const userSettingsSchema = z.object({
  theme: z.enum(["system", "light", "dark"]).default("system"),
  startPage: z.enum(["dashboard", "repositories", "knowledge", "evidence", "candidates", "sessions"]).default("dashboard"),
  defaultImportLimit: pullRequestImportLimitSchema.default(50),
  showGettingStarted: z.boolean().default(true),
  notifyImportCompleted: z.boolean().default(true),
  notifyCandidateReview: z.boolean().default(true)
}).strict();

export const organisationSettingsSchema = z.object({
  autoImportGitHub: z.boolean().default(true),
  githubImportLimit: pullRequestImportLimitSchema.default("all"),
  githubSyncIntervalMinutes: z.number().int().min(15).max(1440).default(60),
  autoExtractKnowledge: z.boolean().default(true),
  communicationEvidenceEnabled: z.boolean().default(true),
  memberCanConnectRepositories: z.boolean().default(true),
  mcpAccessEnabled: z.boolean().default(true),
  repositoryRetention: repositoryRetentionConfigSchema.default({
    retainRawPullRequestDiff: false,
    retainSummariesOnly: false,
    retainReviewComments: true,
    retainCodeSnippets: false
  })
}).strict();

export const DEFAULT_USER_SETTINGS = userSettingsSchema.parse({});
export const DEFAULT_ORGANISATION_SETTINGS = organisationSettingsSchema.parse({});

export const knowledgeScopeSchema = z
  .object({
    organisation: z.string().min(1).optional(),
    repository: z.string().min(1).optional(),
    paths: z.array(z.string().min(1)).optional(),
    excludedPaths: z.array(z.string().min(1)).optional(),
    symbols: z.array(z.string().min(1)).optional(),
    subsystem: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
    framework: z.string().min(1).optional(),
    team: z.string().min(1).optional(),
    reviewer: z.string().min(1).optional(),
    integration: z.string().min(1).optional(),
    ticketType: z.string().min(1).optional()
  })
  .strict();

export const prepareTaskSchema = z.object({
  repositoryId: z.string().min(1),
  task: z.string().min(3).max(10_000),
  paths: z.array(z.string()).max(100).optional()
});

export const createSessionSchema = z.object({
  repositoryId: z.string().min(1),
  task: z.string().min(3).max(10_000),
  agentType: z.enum(["codex", "claude", "cursor", "copilot", "other"]).default("codex"),
  baseCommit: z.string().max(128).optional()
});

export const verifyChangeSchema = z.object({
  task: z.string().min(3).max(10_000),
  changedFiles: z.array(
    z.object({
      path: z.string().min(1),
      previousPath: z.string().min(1).optional(),
      status: z.enum(["added", "modified", "deleted", "renamed"]),
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
      patch: z.string().max(2_000_000).optional()
    })
  )
});

export const proposalPayloadSchema = z.object({
  kind: z.enum(["fact", "decision", "rule", "preference", "inference", "regression", "warning"]),
  title: z.string().min(3).max(200),
  statement: z.string().min(8).max(4_000),
  rationale: z.string().min(3).max(8_000),
  scope: knowledgeScopeSchema,
  evidenceIds: z.array(z.string().min(1)).min(1),
  suggestedConfidence: z.number().min(0).max(1).optional()
});

export const approveCandidateSchema = z.object({
  statement: z.string().min(8).max(4_000).optional(),
  kind: z.enum(["fact", "decision", "rule", "preference", "inference", "regression", "warning"]).optional(),
  scope: knowledgeScopeSchema.optional(),
  reason: z.string().min(3).max(1_000).default("Approved after evidence review")
});

export const communicationEvidenceSchema = z
  .object({
    repositoryId: z.string().min(1).optional(),
    sourceType: z.enum(["slack", "standup", "meeting", "call", "in_person", "email", "note", "other"]),
    title: z.string().trim().min(3).max(200),
    content: z.string().trim().min(8).max(500_000),
    participants: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    occurredAt: z.string().datetime().optional(),
    sourceUrl: z.string().url().max(2_000).optional(),
    sourceReference: z.string().trim().min(1).max(500).optional(),
    authorityConfirmed: z.literal(true)
  })
  .strict();

export type PrepareTaskInput = z.infer<typeof prepareTaskSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type VerifyChangeInput = z.infer<typeof verifyChangeSchema>;
export type ProposalPayload = z.infer<typeof proposalPayloadSchema>;
export type CommunicationEvidencePayload = z.infer<typeof communicationEvidenceSchema>;
