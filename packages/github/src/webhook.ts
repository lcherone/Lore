import { createHmac, timingSafeEqual } from "node:crypto";
import { deterministicUuid } from "@lore/shared/ids.js";
import type { EvidenceRecord } from "@lore/shared/types.js";

type JsonObject = Record<string, unknown>;

const object = (value: unknown): JsonObject => (value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {});
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const number = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);
const identifier = (value: unknown, fallback: string): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : fallback;

export function verifyGitHubWebhook(secret: string, body: Buffer, signatureHeader: string | undefined): boolean {
  if (!secret || !signatureHeader?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("hex"), "utf8");
  const supplied = Buffer.from(signatureHeader.slice(7), "utf8");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function webhookEvidence(input: {
  organisationId: string;
  repositoryId: string;
  eventName: string;
  deliveryId: string;
  payload: unknown;
}): EvidenceRecord[] {
  const payload = object(input.payload);
  const repository = object(payload.repository);
  const pullRequest = object(payload.pull_request);
  const review = object(payload.review);
  const comment = object(payload.comment);
  const sender = object(payload.sender);
  const repoName = text(repository.full_name) || "unknown/repository";
  const prNumber = number(pullRequest.number) ?? number(payload.number);
  const base = {
    organisationId: input.organisationId,
    repositoryId: input.repositoryId,
    provider: "github",
    author: text(sender.login) || "unknown",
    occurredAt: text(payload.updated_at) || text(pullRequest.updated_at) || new Date().toISOString()
  } as const;

  if (input.eventName === "pull_request" && text(payload.action) === "closed" && Boolean(pullRequest.merged)) {
    return [
      {
        ...base,
        id: deterministicUuid("lore.evidence.github-delivery", input.deliveryId),
        type: "pull_request",
        externalId: `${repoName}:pr:${prNumber ?? "unknown"}`,
        url: text(pullRequest.html_url),
        title: `PR #${prNumber ?? "?"}: ${text(pullRequest.title)}`,
        content: text(pullRequest.body),
        metadata: { merged: true, deliveryId: input.deliveryId }
      }
    ];
  }

  if (input.eventName === "pull_request_review" && text(payload.action) === "submitted") {
    return [
      {
        ...base,
        id: deterministicUuid("lore.evidence.github-delivery", input.deliveryId),
        type: "review_comment",
        externalId: `${repoName}:review:${identifier(review.id, input.deliveryId)}`,
        url: text(review.html_url),
        title: `Review on PR #${prNumber ?? "?"}`,
        content: text(review.body),
        metadata: { pullRequest: prNumber, state: review.state, deliveryId: input.deliveryId }
      }
    ];
  }

  if (input.eventName === "pull_request_review_comment" && ["created", "edited"].includes(text(payload.action))) {
    return [
      {
        ...base,
        id: deterministicUuid("lore.evidence.github-delivery", input.deliveryId),
        type: "review_comment",
        externalId: `${repoName}:review-comment:${identifier(comment.id, input.deliveryId)}`,
        url: text(comment.html_url),
        title: `Review comment on PR #${prNumber ?? "?"}`,
        content: text(comment.body),
        metadata: { pullRequest: prNumber, path: comment.path, deliveryId: input.deliveryId }
      }
    ];
  }

  return [];
}
