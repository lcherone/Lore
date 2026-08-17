import { deterministicUuid } from "@lore/shared/ids.js";
import type { KnowledgeItem, ReviewerProfile } from "@lore/shared/types.js";

export interface ReviewerEvidenceObservation {
  type: "pull_request" | "review_comment";
  author?: string | null;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

const reviewerKey = (value: string): string => value.trim().replace(/^@/, "").toLowerCase();

const safeAvatarUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "avatars.githubusercontent.com"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

export const githubReviewerAvatarUrl = (identity: string): string =>
  `https://avatars.githubusercontent.com/${encodeURIComponent(identity.trim().replace(/^@/, ""))}?size=96`;

const isHumanReviewer = (value: string): boolean => {
  const key = reviewerKey(value);
  return (
    Boolean(key) && !key.endsWith("[bot]") && !key.endsWith("-bot") && key !== "github-actions"
  );
};

const reviewerName = (identity: string): string =>
  identity
    .replace(/^@/, "")
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");

const laterTimestamp = (left: string, right: string): string =>
  left.localeCompare(right) >= 0 ? left : right;

export function buildReviewerProfiles(input: {
  organisationId: string;
  existing: ReviewerProfile[];
  evidence: ReviewerEvidenceObservation[];
  knowledge: KnowledgeItem[];
}): ReviewerProfile[] {
  const observed = new Map<
    string,
    { identity: string; avatarUrl?: string; count: number; lastObservedAt: string }
  >();

  const observe = (identity: unknown, occurredAt: string, avatarUrl?: unknown): void => {
    if (typeof identity !== "string" || !isHumanReviewer(identity)) return;
    const key = reviewerKey(identity);
    const current = observed.get(key);
    const safeAvatar = safeAvatarUrl(avatarUrl);
    observed.set(key, {
      identity: identity.trim().replace(/^@/, ""),
      ...(safeAvatar ?? current?.avatarUrl
        ? { avatarUrl: safeAvatar ?? current?.avatarUrl }
        : {}),
      count: (current?.count ?? 0) + 1,
      lastObservedAt: current ? laterTimestamp(current.lastObservedAt, occurredAt) : occurredAt
    });
  };

  for (const item of input.evidence) {
    if (item.type === "review_comment")
      observe(item.author, item.occurredAt, item.metadata.avatarUrl);
    if (item.type === "pull_request" && Array.isArray(item.metadata.reviewers)) {
      const avatars =
        item.metadata.reviewerAvatars &&
        typeof item.metadata.reviewerAvatars === "object" &&
        !Array.isArray(item.metadata.reviewerAvatars)
          ? (item.metadata.reviewerAvatars as Record<string, unknown>)
          : {};
      for (const identity of item.metadata.reviewers) {
        const avatar =
          typeof identity === "string"
            ? Object.entries(avatars).find(
                ([candidate]) => reviewerKey(candidate) === reviewerKey(identity)
              )?.[1]
            : undefined;
        observe(identity, item.occurredAt, avatar);
      }
    }
  }

  const profiles = new Map(
    input.existing.map((profile) => [reviewerKey(profile.providerIdentity), profile])
  );
  for (const [key, item] of observed) {
    const existing = profiles.get(key);
    const identities = new Set([key, existing?.email ? reviewerKey(existing.email) : ""]);
    const preferenceCount = input.knowledge.filter(
      (knowledge) =>
        knowledge.kind === "preference" &&
        typeof knowledge.scope.reviewer === "string" &&
        identities.has(reviewerKey(knowledge.scope.reviewer))
    ).length;
    profiles.set(key, {
      id:
        existing?.id ??
        deterministicUuid("lore.reviewer-profile", `${input.organisationId}:${key}`),
      name: existing?.name ?? reviewerName(item.identity),
      providerIdentity: existing?.providerIdentity ?? item.identity,
      ...(item.avatarUrl ?? existing?.avatarUrl
        ? { avatarUrl: item.avatarUrl ?? existing?.avatarUrl }
        : {}),
      ...(existing?.email ? { email: existing.email } : {}),
      preferenceCount: Math.max(existing?.preferenceCount ?? 0, preferenceCount),
      reinforcedCount: Math.max(existing?.reinforcedCount ?? 0, item.count),
      lastObservedAt: existing
        ? laterTimestamp(existing.lastObservedAt, item.lastObservedAt)
        : item.lastObservedAt
    });
  }

  return [...profiles.values()]
    .map((profile) =>
      profile.avatarUrl
        ? profile
        : { ...profile, avatarUrl: githubReviewerAvatarUrl(profile.providerIdentity) }
    )
    .toSorted(
      (left, right) =>
        right.lastObservedAt.localeCompare(left.lastObservedAt) ||
        left.name.localeCompare(right.name)
    );
}
