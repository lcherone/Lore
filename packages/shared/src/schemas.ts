import { z } from "zod";

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

export type PrepareTaskInput = z.infer<typeof prepareTaskSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type VerifyChangeInput = z.infer<typeof verifyChangeSchema>;
export type ProposalPayload = z.infer<typeof proposalPayloadSchema>;
