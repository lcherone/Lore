import { createHash } from "node:crypto";
import { newUuid } from "@lore/shared/ids.js";
import { createDemoSnapshot, getDemoEvidence } from "@lore/shared/demo-data.js";
import { createDemoCodeGraph } from "@lore/shared/demo-graph.js";
import type {
  AgentSession,
  CandidateRecord,
  CandidateTriageRecommendation,
  ChangeObservation,
  CodeEntity,
  CodeEntityListQuery,
  CodeGraphPage,
  CodeRelationship,
  CodeRelationshipListQuery,
  CodeRelationshipView,
  ContextPackage,
  ContextPackageRecord,
  DashboardSnapshot,
  EvidenceRecord,
  EvidenceRevisionRecord,
  KnowledgeItem,
  KnowledgeProposalRecord,
  AuthSessionSummary,
  ApiTokenSummary,
  GitHubUserIdentity,
  OrganisationAccess,
  OrganisationInvitation,
  OrganisationMember,
  OrganisationRole,
  OrganisationSettings,
  PolicyRecord,
  RepositoryRetentionConfig,
  RepositorySummary,
  RegressionRecord,
  SafetyReport,
  SessionEvent,
  UserProfile,
  UserSettings
} from "@lore/shared/types.js";
import { DEFAULT_ORGANISATION_SETTINGS, DEFAULT_USER_SETTINGS } from "@lore/shared/schemas.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type AuthSessionRecord,
  type ApiTokenRecord,
  type LoreStore,
  type ManualKnowledgeInput,
  type RepositoryAnalysisOutput,
  type UserProfileUpdate
} from "@lore/core/index.js";
import { createChangeObservation } from "./change-observation.js";

export class InMemoryLoreStore implements LoreStore {
  readonly #snapshots = new Map<string, DashboardSnapshot>();
  readonly #evidence: EvidenceRecord[];
  readonly #evidenceRevisions = new Map<string, EvidenceRevisionRecord[]>();
  readonly #syncCheckpoints = new Map<string, string>();
  readonly #receipts = new Set<string>();
  readonly #proposals: KnowledgeProposalRecord[] = [];
  readonly #observations: ChangeObservation[] = [];
  readonly #contexts = new Map<string, ContextPackageRecord[]>();
  readonly #sessionEvents = new Map<string, SessionEvent[]>();
  readonly #graphs = new Map<
    string,
    { entities: CodeEntity[]; relationships: CodeRelationship[]; regressions: RegressionRecord[] }
  >();
  readonly #users = new Map<string, UserProfile>();
  readonly #identityUsers = new Map<string, string>();
  readonly #memberships = new Map<
    string,
    { organisationId: string; userId: string; role: OrganisationRole; createdAt: string }
  >();
  readonly #authSessions = new Map<string, AuthSessionRecord>();
  readonly #invitations = new Map<
    string,
    OrganisationInvitation & { invitedByUserId: string; acceptedAt?: string; revokedAt?: string }
  >();
  readonly #userSettings = new Map<string, UserSettings>();
  readonly #organisationSettings = new Map<string, OrganisationSettings>();
  readonly #apiTokens = new Map<string, ApiTokenRecord>();

  public constructor(snapshot = createDemoSnapshot(), evidence = getDemoEvidence()) {
    this.#snapshots.set(snapshot.organisation.id, structuredClone(snapshot));
    this.#evidence = structuredClone(evidence).map((record) => ({
      ...record,
      contentHash: this.#evidenceHash(record)
    }));
    const createdAt = new Date().toISOString();
    for (const record of this.#evidence) {
      this.#evidenceRevisions.set(record.id, [this.#revision(record, 1, createdAt)]);
    }
    this.#graphs.set("repo_soho_ecom", createDemoCodeGraph());
    const now = new Date().toISOString();
    this.#users.set("user_casey", {
      id: "user_casey",
      email: "casey@acme.example",
      name: "Casey Hall",
      githubLogin: "casey-hall",
      githubProfileUrl: "https://github.com/casey-hall",
      avatarUrl: "/demo-avatar.svg",
      bio: "Engineering leader building safer software systems.",
      company: "Acme Engineering",
      jobTitle: "Engineering Lead",
      location: "London, UK",
      timezone: "Europe/London",
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now
    });
    this.#identityUsers.set("github:1", "user_casey");
    this.#memberships.set(`${snapshot.organisation.id}:user_casey`, {
      organisationId: snapshot.organisation.id,
      userId: "user_casey",
      role: "owner",
      createdAt: now
    });
  }

  async health(): Promise<void> {}

  async validateMembership(organisationId: string, userId: string): Promise<void> {
    this.#assertOrganisation(organisationId);
    if (userId === "system") return;
    if (!this.#memberships.has(`${organisationId}:${userId}`))
      throw new ForbiddenError("The current user is not an active organisation member");
  }

  async getMembershipRole(organisationId: string, userId: string): Promise<OrganisationRole> {
    await this.validateMembership(organisationId, userId);
    return this.#memberships.get(`${organisationId}:${userId}`)?.role ?? "owner";
  }

  async signInWithGitHub(identity: GitHubUserIdentity): Promise<UserProfile> {
    const identityKey = `github:${identity.providerUserId}`;
    const normalizedEmail = identity.email.trim().toLowerCase();
    const identityUserId = this.#identityUsers.get(identityKey);
    const emailUserId = [...this.#users.values()].find(
      (user) => user.email.toLowerCase() === normalizedEmail
    )?.id;
    if (identityUserId && emailUserId && identityUserId !== emailUserId) {
      throw new ConflictError("This verified email is already linked to another Lore account");
    }
    const existingUserId = identityUserId ?? emailUserId;
    const now = new Date().toISOString();
    const existing = existingUserId ? this.#users.get(existingUserId) : undefined;
    const id = existing?.id ?? newUuid();
    const user: UserProfile = {
      id,
      email: identity.email,
      name: existing?.profileEditedAt ? existing.name : identity.name,
      githubLogin: identity.login,
      githubProfileUrl: identity.profileUrl,
      ...(identity.avatarUrl
        ? { avatarUrl: identity.avatarUrl }
        : existing?.avatarUrl
          ? { avatarUrl: existing.avatarUrl }
          : {}),
      ...(existing?.profileEditedAt
        ? existing.bio
          ? { bio: existing.bio }
          : {}
        : identity.bio
          ? { bio: identity.bio }
          : {}),
      ...(existing?.profileEditedAt
        ? existing.company
          ? { company: existing.company }
          : {}
        : identity.company
          ? { company: identity.company }
          : {}),
      ...(existing?.jobTitle ? { jobTitle: existing.jobTitle } : {}),
      ...(existing?.profileEditedAt
        ? existing.location
          ? { location: existing.location }
          : {}
        : identity.location
          ? { location: identity.location }
          : {}),
      ...(existing?.profileEditedAt
        ? existing.websiteUrl
          ? { websiteUrl: existing.websiteUrl }
          : {}
        : identity.websiteUrl
          ? { websiteUrl: identity.websiteUrl }
          : {}),
      ...(existing?.timezone ? { timezone: existing.timezone } : {}),
      ...(existing?.profileEditedAt ? { profileEditedAt: existing.profileEditedAt } : {}),
      lastLoginAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.#users.set(id, user);
    this.#identityUsers.set(identityKey, id);
    return structuredClone(user);
  }

  async getLocalGitHubUser(credentialFingerprint: string): Promise<UserProfile | undefined> {
    const userId = this.#identityUsers.get(`github-local-token:${credentialFingerprint}`);
    return userId ? this.getUserProfile(userId) : undefined;
  }

  async getSoleGitHubUser(): Promise<UserProfile | undefined> {
    const userIds = new Set(
      [...this.#identityUsers.entries()]
        .filter(([identity]) => identity.startsWith("github:"))
        .map(([, userId]) => userId)
    );
    if (userIds.size !== 1) return undefined;
    return this.getUserProfile([...userIds][0]!);
  }

  async linkLocalGitHubCredential(userId: string, credentialFingerprint: string): Promise<void> {
    await this.getUserProfile(userId);
    const key = `github-local-token:${credentialFingerprint}`;
    const existing = this.#identityUsers.get(key);
    if (existing && existing !== userId)
      throw new ConflictError("This local GitHub credential is linked to another Lore account");
    this.#identityUsers.set(key, userId);
  }

  async getUserProfile(userId: string): Promise<UserProfile> {
    const user = this.#users.get(userId);
    if (!user) throw new NotFoundError("User", userId);
    return structuredClone(user);
  }

  async updateUserProfile(userId: string, input: UserProfileUpdate): Promise<UserProfile> {
    const user = await this.getUserProfile(userId);
    const now = new Date().toISOString();
    const updated = { ...user, ...input, profileEditedAt: now, updatedAt: now };
    this.#users.set(userId, updated);
    return structuredClone(updated);
  }

  async getUserSettings(userId: string): Promise<UserSettings> {
    await this.getUserProfile(userId);
    return structuredClone(this.#userSettings.get(userId) ?? DEFAULT_USER_SETTINGS);
  }

  async updateUserSettings(userId: string, input: UserSettings): Promise<UserSettings> {
    await this.getUserProfile(userId);
    this.#userSettings.set(userId, structuredClone(input));
    return structuredClone(input);
  }

  async createAuthSession(input: {
    userId: string;
    tokenHash: string;
    activeOrganisationId?: string;
    expiresAt: string;
    userAgentHash?: string;
    ipHash?: string;
  }): Promise<AuthSessionRecord> {
    await this.getUserProfile(input.userId);
    if (input.activeOrganisationId)
      await this.validateMembership(input.activeOrganisationId, input.userId);
    const now = new Date().toISOString();
    const session: AuthSessionRecord = {
      id: newUuid(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      ...(input.activeOrganisationId ? { activeOrganisationId: input.activeOrganisationId } : {}),
      expiresAt: input.expiresAt,
      lastSeenAt: now,
      createdAt: now
    };
    this.#authSessions.set(input.tokenHash, session);
    return structuredClone(session);
  }

  async getAuthSession(tokenHash: string): Promise<AuthSessionRecord | undefined> {
    const session = this.#authSessions.get(tokenHash);
    return session ? structuredClone(session) : undefined;
  }

  async touchAuthSession(sessionId: string, seenAt: string): Promise<void> {
    const session = [...this.#authSessions.values()].find((item) => item.id === sessionId);
    if (session) session.lastSeenAt = seenAt;
  }

  async revokeAuthSession(sessionId: string, userId: string): Promise<void> {
    const session = [...this.#authSessions.values()].find(
      (item) => item.id === sessionId && item.userId === userId
    );
    if (session) session.revokedAt = new Date().toISOString();
  }

  async revokeOtherAuthSessions(userId: string, currentSessionId: string): Promise<number> {
    let count = 0;
    for (const session of this.#authSessions.values()) {
      if (session.userId === userId && session.id !== currentSessionId && !session.revokedAt) {
        session.revokedAt = new Date().toISOString();
        count += 1;
      }
    }
    return count;
  }

  async listAuthSessions(userId: string, currentSessionId: string): Promise<AuthSessionSummary[]> {
    return [...this.#authSessions.values()]
      .filter(
        (session) =>
          session.userId === userId &&
          !session.revokedAt &&
          Date.parse(session.expiresAt) > Date.now()
      )
      .map((session) => ({
        id: session.id,
        ...(session.activeOrganisationId
          ? { activeOrganisationId: session.activeOrganisationId }
          : {}),
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        current: session.id === currentSessionId
      }));
  }

  async listOrganisationAccess(userId: string): Promise<OrganisationAccess[]> {
    return [...this.#memberships.values()]
      .filter((membership) => membership.userId === userId)
      .map((membership) => {
        const snapshot = this.#snapshotFor(membership.organisationId);
        return {
          ...snapshot.organisation,
          role: membership.role,
          memberCount: [...this.#memberships.values()].filter(
            (item) => item.organisationId === membership.organisationId
          ).length,
          createdAt: membership.createdAt
        };
      });
  }

  async getOrganisationSettings(organisationId: string): Promise<OrganisationSettings> {
    this.#assertOrganisation(organisationId);
    return structuredClone(
      this.#organisationSettings.get(organisationId) ?? DEFAULT_ORGANISATION_SETTINGS
    );
  }

  async updateOrganisationSettings(
    organisationId: string,
    input: OrganisationSettings,
    actorUserId: string
  ): Promise<OrganisationSettings> {
    const role = await this.getMembershipRole(organisationId, actorUserId);
    if (role !== "owner" && role !== "admin")
      throw new ForbiddenError("Owner or admin access is required");
    this.#organisationSettings.set(organisationId, structuredClone(input));
    return structuredClone(input);
  }

  async createApiToken(input: {
    organisationId: string;
    userId: string;
    name: string;
    prefix: string;
    tokenHash: string;
    scopes: Array<"read" | "write">;
    expiresAt?: string;
  }): Promise<ApiTokenSummary> {
    await this.validateMembership(input.organisationId, input.userId);
    const record: ApiTokenRecord = {
      id: newUuid(),
      organisationId: input.organisationId,
      userId: input.userId,
      name: input.name,
      prefix: input.prefix,
      tokenHash: input.tokenHash,
      scopes: [...input.scopes],
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      createdAt: new Date().toISOString()
    };
    this.#apiTokens.set(input.tokenHash, record);
    return this.#apiTokenSummary(record);
  }

  async getApiToken(tokenHash: string): Promise<ApiTokenRecord | undefined> {
    const token = this.#apiTokens.get(tokenHash);
    if (!token || token.revokedAt || (token.expiresAt && Date.parse(token.expiresAt) <= Date.now()))
      return undefined;
    token.lastUsedAt = new Date().toISOString();
    return structuredClone(token);
  }

  async listApiTokens(userId: string, organisationId: string): Promise<ApiTokenSummary[]> {
    await this.validateMembership(organisationId, userId);
    return [...this.#apiTokens.values()]
      .filter(
        (token) =>
          token.userId === userId && token.organisationId === organisationId && !token.revokedAt
      )
      .map((token) => this.#apiTokenSummary(token));
  }

  async revokeApiToken(tokenId: string, userId: string, organisationId: string): Promise<void> {
    const token = [...this.#apiTokens.values()].find(
      (candidate) =>
        candidate.id === tokenId &&
        candidate.userId === userId &&
        candidate.organisationId === organisationId
    );
    if (!token) throw new NotFoundError("API token", tokenId);
    token.revokedAt = new Date().toISOString();
  }

  async createOrganisation(
    userId: string,
    input: { name: string; slug: string }
  ): Promise<OrganisationAccess> {
    await this.getUserProfile(userId);
    if (
      [...this.#snapshots.values()].some((snapshot) => snapshot.organisation.slug === input.slug)
    ) {
      throw new ConflictError("That organisation URL is already in use");
    }
    const id = newUuid();
    const now = new Date().toISOString();
    this.#snapshots.set(id, {
      organisation: { id, name: input.name, slug: input.slug },
      repositories: [],
      knowledge: [],
      candidates: [],
      policies: [],
      reports: [],
      reviewers: [],
      sessions: []
    });
    this.#memberships.set(`${id}:${userId}`, {
      organisationId: id,
      userId,
      role: "owner",
      createdAt: now
    });
    return {
      id,
      name: input.name,
      slug: input.slug,
      role: "owner",
      memberCount: 1,
      createdAt: now
    };
  }

  async updateOrganisation(
    organisationId: string,
    input: { name?: string; slug?: string },
    actorUserId: string
  ): Promise<OrganisationAccess> {
    const role = await this.getMembershipRole(organisationId, actorUserId);
    if (role !== "owner" && role !== "admin")
      throw new ForbiddenError("Owner or admin access is required");
    const snapshot = this.#snapshotFor(organisationId);
    if (
      input.slug &&
      [...this.#snapshots.values()].some(
        (item) => item.organisation.id !== organisationId && item.organisation.slug === input.slug
      )
    ) {
      throw new ConflictError("That organisation URL is already in use");
    }
    snapshot.organisation = { ...snapshot.organisation, ...input };
    return (await this.listOrganisationAccess(actorUserId)).find(
      (item) => item.id === organisationId
    )!;
  }

  async listOrganisationMembers(organisationId: string): Promise<OrganisationMember[]> {
    this.#assertOrganisation(organisationId);
    return [...this.#memberships.values()]
      .filter((item) => item.organisationId === organisationId)
      .map((membership) => {
        const user = this.#users.get(membership.userId)!;
        return {
          membershipId: `${membership.organisationId}:${membership.userId}`,
          userId: user.id,
          name: user.name,
          email: user.email,
          ...(user.githubLogin ? { githubLogin: user.githubLogin } : {}),
          ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
          role: membership.role,
          joinedAt: membership.createdAt
        };
      });
  }

  async listOrganisationInvitations(organisationId: string): Promise<OrganisationInvitation[]> {
    this.#assertOrganisation(organisationId);
    return [...this.#invitations.values()]
      .filter(
        (item) =>
          item.organisationId === organisationId &&
          !item.acceptedAt &&
          !item.revokedAt &&
          Date.parse(item.expiresAt) > Date.now()
      )
      .map((item) => structuredClone(item));
  }

  async listPendingInvitations(userId: string): Promise<OrganisationInvitation[]> {
    const user = await this.getUserProfile(userId);
    return [...this.#invitations.values()]
      .filter(
        (item) =>
          item.email.toLowerCase() === user.email.toLowerCase() &&
          !item.acceptedAt &&
          !item.revokedAt &&
          Date.parse(item.expiresAt) > Date.now()
      )
      .map((item) => structuredClone(item));
  }

  async createOrganisationInvitation(
    organisationId: string,
    input: { email: string; role: Exclude<OrganisationRole, "owner">; expiresAt: string },
    invitedByUserId: string
  ): Promise<OrganisationInvitation> {
    const inviter = await this.getUserProfile(invitedByUserId);
    const snapshot = this.#snapshotFor(organisationId);
    const email = input.email.trim().toLowerCase();
    const existingUser = [...this.#users.values()].find(
      (user) => user.email.toLowerCase() === email
    );
    if (existingUser && this.#memberships.has(`${organisationId}:${existingUser.id}`)) {
      throw new ConflictError("This person is already an organisation member");
    }
    if (
      [...this.#invitations.values()].some(
        (item) =>
          item.organisationId === organisationId &&
          item.email.toLowerCase() === email &&
          !item.acceptedAt &&
          !item.revokedAt
      )
    ) {
      throw new ConflictError("A pending invitation already exists for this email");
    }
    const invitation = {
      id: newUuid(),
      organisationId,
      organisationName: snapshot.organisation.name,
      email,
      role: input.role,
      invitedByName: inviter.name,
      invitedByUserId,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString()
    };
    this.#invitations.set(invitation.id, invitation);
    return structuredClone(invitation);
  }

  async revokeOrganisationInvitation(organisationId: string, invitationId: string): Promise<void> {
    const invitation = this.#invitations.get(invitationId);
    if (!invitation || invitation.organisationId !== organisationId)
      throw new NotFoundError("Invitation", invitationId);
    invitation.revokedAt = new Date().toISOString();
  }

  async acceptOrganisationInvitation(
    invitationId: string,
    userId: string
  ): Promise<OrganisationAccess> {
    const invitation = this.#invitations.get(invitationId);
    const user = await this.getUserProfile(userId);
    if (
      !invitation ||
      invitation.revokedAt ||
      invitation.acceptedAt ||
      Date.parse(invitation.expiresAt) <= Date.now()
    )
      throw new NotFoundError("Invitation", invitationId);
    if (invitation.email.toLowerCase() !== user.email.toLowerCase())
      throw new ForbiddenError("Sign in with the GitHub account matching the invited email");
    const now = new Date().toISOString();
    this.#memberships.set(`${invitation.organisationId}:${userId}`, {
      organisationId: invitation.organisationId,
      userId,
      role: invitation.role,
      createdAt: now
    });
    invitation.acceptedAt = now;
    return (await this.listOrganisationAccess(userId)).find(
      (item) => item.id === invitation.organisationId
    )!;
  }

  async updateOrganisationMemberRole(
    organisationId: string,
    memberUserId: string,
    role: Exclude<OrganisationRole, "owner">
  ): Promise<OrganisationMember> {
    const membership = this.#memberships.get(`${organisationId}:${memberUserId}`);
    if (!membership) throw new NotFoundError("Organisation member", memberUserId);
    if (membership.role === "owner")
      throw new ConflictError("The organisation owner role cannot be changed here");
    membership.role = role;
    return (await this.listOrganisationMembers(organisationId)).find(
      (item) => item.userId === memberUserId
    )!;
  }

  async removeOrganisationMember(organisationId: string, memberUserId: string): Promise<void> {
    const membership = this.#memberships.get(`${organisationId}:${memberUserId}`);
    if (!membership) throw new NotFoundError("Organisation member", memberUserId);
    if (membership.role === "owner")
      throw new ConflictError("The organisation owner cannot be removed");
    this.#memberships.delete(`${organisationId}:${memberUserId}`);
  }

  async getSnapshot(organisationId: string): Promise<DashboardSnapshot> {
    return structuredClone(this.#snapshotFor(organisationId));
  }

  async getEvidence(organisationId: string): Promise<EvidenceRecord[]> {
    this.#assertOrganisation(organisationId);
    return structuredClone(
      this.#evidence.filter((record) => record.organisationId === organisationId)
    );
  }

  async getEvidenceRevisions(
    organisationId: string,
    evidenceId: string
  ): Promise<EvidenceRevisionRecord[]> {
    this.#assertOrganisation(organisationId);
    const evidence = this.#evidence.find(
      (record) => record.id === evidenceId && record.organisationId === organisationId
    );
    if (!evidence) throw new NotFoundError("Evidence", evidenceId);
    return structuredClone(this.#evidenceRevisions.get(evidenceId) ?? []);
  }

  async getSyncSourceVersions(
    organisationId: string,
    repositoryId: string,
    provider: string,
    stream: string
  ): Promise<Record<string, string>> {
    await this.getRepository(organisationId, repositoryId);
    const prefix = `${organisationId}:${repositoryId}:${provider}:${stream}:`;
    return Object.fromEntries(
      [...this.#syncCheckpoints.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, sourceVersion]) => [key.slice(prefix.length), sourceVersion])
    );
  }

  async saveSyncCheckpoint(input: {
    organisationId: string;
    repositoryId: string;
    provider: string;
    stream: string;
    externalId: string;
    sourceVersion: string;
  }): Promise<void> {
    await this.getRepository(input.organisationId, input.repositoryId);
    this.#syncCheckpoints.set(
      `${input.organisationId}:${input.repositoryId}:${input.provider}:${input.stream}:${input.externalId}`,
      input.sourceVersion
    );
  }

  async getRepository(organisationId: string, repositoryId: string) {
    this.#assertOrganisation(organisationId);
    const repository = this.#snapshotFor(organisationId).repositories.find(
      (item) => item.id === repositoryId
    );
    if (!repository) throw new NotFoundError("Repository", repositoryId);
    return structuredClone(repository);
  }

  async resolveProviderRepository(
    provider: RepositorySummary["provider"],
    providerInstallationId: string,
    providerRepositoryId: string,
    owner: string,
    name: string
  ): Promise<RepositorySummary> {
    const repository = [...this.#snapshots.values()]
      .flatMap((snapshot) => snapshot.repositories)
      .find(
        (item) =>
          item.provider === provider &&
          item.providerInstallationId === providerInstallationId &&
          ((item.providerRepositoryId && item.providerRepositoryId === providerRepositoryId) ||
            (item.owner.toLowerCase() === owner.toLowerCase() &&
              item.name.toLowerCase() === name.toLowerCase()))
      );
    if (!repository) throw new NotFoundError("Provider repository", `${owner}/${name}`);
    return structuredClone(repository);
  }

  async getCodeGraph(
    organisationId: string,
    repositoryId: string
  ): Promise<{ entities: CodeEntity[]; relationships: CodeRelationship[] }> {
    await this.getRepository(organisationId, repositoryId);
    const graph = this.#graphs.get(repositoryId) ?? {
      entities: [],
      relationships: [],
      regressions: []
    };
    return structuredClone({ entities: graph.entities, relationships: graph.relationships });
  }

  async listCodeEntities(
    organisationId: string,
    repositoryId: string,
    query: CodeEntityListQuery
  ): Promise<CodeGraphPage<CodeEntity>> {
    const graph = await this.getCodeGraph(organisationId, repositoryId);
    const search = query.search?.trim().toLowerCase();
    const filtered = graph.entities
      .filter((entity) => !query.type || entity.type === query.type)
      .filter(
        (entity) =>
          !search ||
          `${entity.name} ${entity.qualifiedName} ${entity.path}`.toLowerCase().includes(search)
      )
      .toSorted(
        (left, right) =>
          left.path.localeCompare(right.path) || (left.startLine ?? 0) - (right.startLine ?? 0)
      );
    const offset = (query.page - 1) * query.pageSize;
    const items = filtered.slice(offset, offset + query.pageSize);
    return {
      items,
      count: items.length,
      total: filtered.length,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: offset + items.length < filtered.length
    };
  }

  async listCodeRelationships(
    organisationId: string,
    repositoryId: string,
    query: CodeRelationshipListQuery
  ): Promise<CodeGraphPage<CodeRelationshipView>> {
    const graph = await this.getCodeGraph(organisationId, repositoryId);
    const entities = new Map(graph.entities.map((entity) => [entity.id, entity]));
    const search = query.search?.trim().toLowerCase();
    const filtered = graph.relationships
      .flatMap((relationship): CodeRelationshipView[] => {
        const sourceEntity = entities.get(relationship.sourceEntityId);
        const targetEntity = entities.get(relationship.targetEntityId);
        if (!sourceEntity || !targetEntity) return [];
        if (
          query.entityId &&
          relationship.sourceEntityId !== query.entityId &&
          relationship.targetEntityId !== query.entityId
        )
          return [];
        if (
          search &&
          !`${relationship.relationshipType} ${sourceEntity.qualifiedName} ${targetEntity.qualifiedName} ${sourceEntity.path} ${targetEntity.path}`
            .toLowerCase()
            .includes(search)
        )
          return [];
        return [
          {
            ...relationship,
            sourceEntity,
            targetEntity
          }
        ];
      })
      .toSorted((left, right) => left.relationshipType.localeCompare(right.relationshipType));
    const offset = (query.page - 1) * query.pageSize;
    const items = filtered.slice(offset, offset + query.pageSize);
    return {
      items,
      count: items.length,
      total: filtered.length,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: offset + items.length < filtered.length
    };
  }

  async getRegressions(organisationId: string, repositoryId: string): Promise<RegressionRecord[]> {
    await this.getRepository(organisationId, repositoryId);
    return structuredClone(this.#graphs.get(repositoryId)?.regressions ?? []);
  }

  async saveAnalysis(organisationId: string, output: RepositoryAnalysisOutput): Promise<void> {
    await this.getRepository(organisationId, output.repository.id);
    const current = this.#graphs.get(output.repository.id);
    this.#graphs.set(output.repository.id, {
      entities: structuredClone(output.entities),
      relationships: structuredClone(output.relationships),
      regressions: current?.regressions ?? []
    });
    const snapshot = this.#snapshotFor(organisationId);
    const index = snapshot.repositories.findIndex(
      (repository) => repository.id === output.repository.id
    );
    if (index >= 0)
      snapshot.repositories[index] = structuredClone({ ...output.repository, status: "ready" });
  }

  async saveKnowledgeProposal(
    organisationId: string,
    input: Omit<KnowledgeProposalRecord, "id" | "organisationId" | "createdAt">
  ): Promise<KnowledgeProposalRecord> {
    this.#assertOrganisation(organisationId);
    const proposal: KnowledgeProposalRecord = {
      ...input,
      id: this.createId("proposal"),
      organisationId,
      createdAt: new Date().toISOString()
    };
    this.#proposals.unshift(proposal);
    return structuredClone(proposal);
  }

  async createKnowledgeCandidate(
    organisationId: string,
    candidate: CandidateRecord
  ): Promise<CandidateRecord> {
    this.#assertOrganisation(organisationId);
    const snapshot = this.#snapshotFor(organisationId);
    const duplicate = snapshot.candidates.find(
      (item) => item.id === candidate.id || item.statement === candidate.statement
    );
    if (duplicate) {
      duplicate.evidenceIds = [...new Set([...duplicate.evidenceIds, ...candidate.evidenceIds])];
      const evidenceIds = new Set(duplicate.evidence.map((item) => item.id));
      duplicate.evidence.push(...candidate.evidence.filter((item) => !evidenceIds.has(item.id)));
      duplicate.updatedAt = new Date().toISOString();
      return structuredClone(duplicate);
    }
    snapshot.candidates.unshift(structuredClone(candidate));
    return structuredClone(candidate);
  }

  async getCandidate(organisationId: string, candidateId: string): Promise<CandidateRecord> {
    this.#assertOrganisation(organisationId);
    const candidate = this.#snapshotFor(organisationId).candidates.find(
      (item) => item.id === candidateId
    );
    if (!candidate) throw new NotFoundError("Knowledge candidate", candidateId);
    return structuredClone(candidate);
  }

  async saveCandidateTriage(
    organisationId: string,
    candidateId: string,
    recommendation: CandidateTriageRecommendation
  ): Promise<CandidateRecord> {
    this.#assertOrganisation(organisationId);
    const candidate = this.#snapshotFor(organisationId).candidates.find(
      (item) => item.id === candidateId
    );
    if (!candidate) throw new NotFoundError("Knowledge candidate", candidateId);
    candidate.triage = structuredClone(recommendation);
    return structuredClone(candidate);
  }

  async addRepository(
    organisationId: string,
    input: Omit<
      RepositorySummary,
      "id" | "organisationId" | "entityCount" | "relationshipCount" | "status"
    >,
    actor = "system"
  ): Promise<RepositorySummary> {
    void actor;
    this.#assertOrganisation(organisationId);
    const snapshot = this.#snapshotFor(organisationId);
    const duplicate = snapshot.repositories.find(
      (repository) =>
        repository.owner === input.owner &&
        repository.name === input.name &&
        repository.provider === input.provider
    );
    if (duplicate)
      throw new ConflictError("Repository is already connected", { repositoryId: duplicate.id });
    const repository: RepositorySummary = {
      ...input,
      id: this.createId("repo"),
      organisationId,
      entityCount: 0,
      relationshipCount: 0,
      status: "attention"
    };
    snapshot.repositories.push(repository);
    return structuredClone(repository);
  }

  async createManualKnowledge(
    organisationId: string,
    input: ManualKnowledgeInput,
    actor: string
  ): Promise<KnowledgeItem> {
    this.#assertOrganisation(organisationId);
    if (input.repositoryId) await this.getRepository(organisationId, input.repositoryId);
    const now = new Date().toISOString();
    const evidenceId = this.createId("evidence");
    this.#evidence.unshift({
      id: evidenceId,
      organisationId,
      ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
      type: "manual_confirmation",
      provider: "lore",
      externalId: evidenceId,
      ...(input.sourceUrl ? { url: input.sourceUrl } : {}),
      title: `Manual confirmation: ${input.title}`,
      content: `${input.statement}\n\nRationale: ${input.rationale}`,
      author: actor,
      occurredAt: now,
      metadata: {
        humanConfirmed: true,
        ...(input.sourceName ? { sourceName: input.sourceName } : {})
      }
    });
    const item: KnowledgeItem = {
      id: this.createId("knowledge"),
      organisationId,
      ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
      kind: input.kind,
      status: "active",
      title: input.title,
      statement: input.statement,
      rationale: input.rationale,
      confidence: 1,
      severity: input.severity,
      scope: input.scope,
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
      lastConfirmedAt: now,
      evidenceIds: [evidenceId],
      contradictionCount: 0,
      health: "healthy"
    };
    this.#snapshotFor(organisationId).knowledge.unshift(item);
    return structuredClone(item);
  }

  async approveCandidate(
    organisationId: string,
    candidateId: string,
    input: {
      statement?: string;
      kind?: CandidateRecord["kind"];
      scope?: CandidateRecord["scope"];
      reason: string;
    },
    actor: string
  ): Promise<KnowledgeItem> {
    const candidate = await this.getCandidate(organisationId, candidateId);
    const snapshot = this.#snapshotFor(organisationId);
    const index = snapshot.candidates.findIndex((item) => item.id === candidateId);
    if (index < 0) throw new NotFoundError("Knowledge candidate", candidateId);

    const approved: KnowledgeItem = {
      ...candidate,
      statement: input.statement ?? candidate.statement,
      kind: input.kind ?? candidate.kind,
      scope: input.scope ?? candidate.scope,
      status: "active",
      confidence: Math.max(candidate.confidence, 0.86),
      health: "healthy",
      createdBy: actor,
      updatedAt: new Date().toISOString(),
      lastConfirmedAt: new Date().toISOString()
    };
    snapshot.candidates.splice(index, 1);
    snapshot.knowledge.unshift(approved);
    const proposal = candidate.proposalId
      ? this.#proposals.find((item) => item.id === candidate.proposalId)
      : undefined;
    if (proposal) {
      proposal.status = "approved";
      proposal.reviewedAt = new Date().toISOString();
      proposal.reviewedBy = actor;
    }
    return structuredClone(approved);
  }

  async rejectCandidate(
    organisationId: string,
    candidateId: string,
    reason: string,
    actor: string
  ): Promise<void> {
    void reason;
    this.#assertOrganisation(organisationId);
    const snapshot = this.#snapshotFor(organisationId);
    const index = snapshot.candidates.findIndex((item) => item.id === candidateId);
    if (index < 0) throw new NotFoundError("Knowledge candidate", candidateId);
    const candidate = snapshot.candidates[index]!;
    snapshot.candidates.splice(index, 1);
    const proposal = candidate.proposalId
      ? this.#proposals.find((item) => item.id === candidate.proposalId)
      : undefined;
    if (proposal) {
      proposal.status = "rejected";
      proposal.reviewedAt = new Date().toISOString();
      proposal.reviewedBy = actor;
    }
  }

  async mergeCandidate(
    organisationId: string,
    candidateId: string,
    targetId: string,
    reason: string,
    actor: string
  ): Promise<KnowledgeItem> {
    void reason;
    if (candidateId === targetId)
      throw new ConflictError("A candidate cannot be merged into itself");
    const source = await this.getCandidate(organisationId, candidateId);
    const snapshot = this.#snapshotFor(organisationId);
    const candidateTarget = snapshot.candidates.find((item) => item.id === targetId);
    const target: KnowledgeItem | undefined =
      candidateTarget ??
      snapshot.knowledge.find((item) => item.id === targetId && item.status === "active");
    if (!target) throw new NotFoundError("Merge target", targetId);

    target.evidenceIds = [...new Set([...target.evidenceIds, ...source.evidenceIds])];
    target.confidence = Math.max(target.confidence, source.confidence);
    target.updatedAt = new Date().toISOString();
    if (candidateTarget) {
      candidateTarget.evidence = [
        ...candidateTarget.evidence,
        ...source.evidence.filter(
          (record) => !candidateTarget.evidence.some((item) => item.id === record.id)
        )
      ];
      candidateTarget.confidenceFactors.supportingObservations = Math.max(
        candidateTarget.confidenceFactors.supportingObservations,
        candidateTarget.evidenceIds.length
      );
    }
    const sourceIndex = snapshot.candidates.findIndex((item) => item.id === candidateId);
    snapshot.candidates.splice(sourceIndex, 1);
    const proposal = source.proposalId
      ? this.#proposals.find((item) => item.id === source.proposalId)
      : undefined;
    if (proposal) {
      proposal.status = "approved";
      proposal.reviewedAt = new Date().toISOString();
      proposal.reviewedBy = actor;
    }
    return structuredClone(target);
  }

  async deleteRepository(
    organisationId: string,
    repositoryId: string,
    actor: string
  ): Promise<{ deletedId: string; challengedKnowledgeIds: string[] }> {
    void actor;
    await this.getRepository(organisationId, repositoryId);
    const repositoryEvidenceIds = new Set(
      this.#evidence
        .filter((record) => record.repositoryId === repositoryId)
        .map((record) => record.id)
    );
    const challengedKnowledgeIds: string[] = [];
    const snapshot = this.#snapshotFor(organisationId);
    for (const item of snapshot.knowledge) {
      if (!item.repositoryId && item.evidenceIds.some((id) => repositoryEvidenceIds.has(id))) {
        item.status = "challenged";
        item.health = "conflicted";
        item.contradictionCount += 1;
        item.updatedAt = new Date().toISOString();
        challengedKnowledgeIds.push(item.id);
      }
    }

    const removeWhere = <T>(items: T[], predicate: (item: T) => boolean): void => {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (predicate(items[index]!)) items.splice(index, 1);
      }
    };
    removeWhere(snapshot.repositories, (item) => item.id === repositoryId);
    removeWhere(snapshot.knowledge, (item) => item.repositoryId === repositoryId);
    removeWhere(snapshot.candidates, (item) => item.repositoryId === repositoryId);
    removeWhere(snapshot.policies, (item) => item.repositoryId === repositoryId);
    removeWhere(snapshot.sessions, (item) => item.repositoryId === repositoryId);
    removeWhere(snapshot.reports, (item) => item.repositoryId === repositoryId);
    removeWhere(this.#evidence, (item) => item.repositoryId === repositoryId);
    removeWhere(this.#proposals, (item) => item.repositoryId === repositoryId);
    this.#graphs.delete(repositoryId);
    return { deletedId: repositoryId, challengedKnowledgeIds };
  }

  async updateRepositoryRetention(
    organisationId: string,
    repositoryId: string,
    retentionConfig: RepositoryRetentionConfig,
    actor: string
  ): Promise<RepositorySummary> {
    void actor;
    await this.getRepository(organisationId, repositoryId);
    const repository = this.#snapshotFor(organisationId).repositories.find(
      (item) => item.id === repositoryId
    )!;
    repository.retentionConfig = structuredClone(retentionConfig);
    return structuredClone(repository);
  }

  async updateKnowledgeStatus(
    organisationId: string,
    knowledgeId: string,
    status: "challenged" | "archived",
    reason: string,
    actor: string
  ): Promise<KnowledgeItem> {
    void reason;
    void actor;
    this.#assertOrganisation(organisationId);
    const item = this.#snapshotFor(organisationId).knowledge.find(
      (knowledge) => knowledge.id === knowledgeId
    );
    if (!item) throw new NotFoundError("Knowledge item", knowledgeId);
    item.status = status;
    item.updatedAt = new Date().toISOString();
    item.health = status === "challenged" ? "conflicted" : item.health;
    return structuredClone(item);
  }

  async createPolicy(
    organisationId: string,
    input: Omit<PolicyRecord, "id" | "organisationId" | "createdAt" | "updatedAt">,
    actor = "system"
  ): Promise<PolicyRecord> {
    void actor;
    this.#assertOrganisation(organisationId);
    const now = new Date().toISOString();
    const policy: PolicyRecord = {
      ...input,
      id: this.createId("policy"),
      organisationId,
      createdAt: now,
      updatedAt: now
    };
    this.#snapshotFor(organisationId).policies.unshift(policy);
    return structuredClone(policy);
  }

  async createSession(session: AgentSession): Promise<AgentSession> {
    this.#assertOrganisation(session.organisationId);
    const snapshot = this.#snapshotFor(session.organisationId);
    if (snapshot.sessions.some((item) => item.id === session.id)) {
      throw new ConflictError("Session already exists", { sessionId: session.id });
    }
    snapshot.sessions.unshift(structuredClone(session));
    this.#appendSessionEvent(session.id, "started", {
      status: session.status,
      agentType: session.agentType
    });
    return structuredClone(session);
  }

  async updateSession(organisationId: string, session: AgentSession): Promise<AgentSession> {
    this.#assertOrganisation(organisationId);
    const snapshot = this.#snapshotFor(organisationId);
    const index = snapshot.sessions.findIndex((item) => item.id === session.id);
    if (index < 0) throw new NotFoundError("Agent session", session.id);
    const previous = snapshot.sessions[index]!;
    if (previous.organisationId !== organisationId) throw new ForbiddenError();
    snapshot.sessions[index] = structuredClone(session);
    if (previous.status !== session.status && session.status === "abandoned") {
      this.#appendSessionEvent(session.id, "abandoned", { previousStatus: previous.status });
    }
    return structuredClone(session);
  }

  async getSessionEvents(organisationId: string, sessionId: string): Promise<SessionEvent[]> {
    this.#assertOrganisation(organisationId);
    if (
      !this.#snapshotFor(organisationId).sessions.some(
        (item) => item.id === sessionId && item.organisationId === organisationId
      )
    ) {
      throw new NotFoundError("Agent session", sessionId);
    }
    return structuredClone(this.#sessionEvents.get(sessionId) ?? []);
  }

  async abandonSession(
    organisationId: string,
    sessionId: string,
    reason: string
  ): Promise<AgentSession> {
    this.#assertOrganisation(organisationId);
    const session = this.#snapshotFor(organisationId).sessions.find(
      (item) => item.id === sessionId && item.organisationId === organisationId
    );
    if (!session) throw new NotFoundError("Agent session", sessionId);
    if (["completed", "abandoned"].includes(session.status))
      throw new ConflictError("Only an open session can be abandoned");
    const previousStatus = session.status;
    session.status = "abandoned";
    session.completedAt = new Date().toISOString();
    this.#appendSessionEvent(sessionId, "abandoned", { previousStatus, reason });
    return structuredClone(session);
  }

  async saveContextPackage(
    organisationId: string,
    sessionId: string,
    context: ContextPackage
  ): Promise<ContextPackageRecord> {
    this.#assertOrganisation(organisationId);
    const session = this.#snapshotFor(organisationId).sessions.find(
      (item) => item.id === sessionId && item.organisationId === organisationId
    );
    if (!session) throw new NotFoundError("Agent session", sessionId);
    if (session.repositoryId !== context.repository.id)
      throw new ForbiddenError("Context repository does not belong to the session");
    const records = this.#contexts.get(sessionId) ?? [];
    const record: ContextPackageRecord = {
      id: context.id,
      sessionId,
      revision: records.length + 1,
      payload: structuredClone(context),
      createdAt: new Date().toISOString()
    };
    records.push(record);
    this.#contexts.set(sessionId, records);
    session.status = "active";
    session.filesObserved = context.candidateFiles.map((file) => file.path);
    this.#appendSessionEvent(
      sessionId,
      record.revision === 1 ? "context_prepared" : "context_refreshed",
      {
        contextId: context.id,
        revision: record.revision,
        filesObserved: session.filesObserved.length
      }
    );
    return structuredClone(record);
  }

  async getLatestContextPackage(
    organisationId: string,
    sessionId: string
  ): Promise<ContextPackageRecord | undefined> {
    this.#assertOrganisation(organisationId);
    const session = this.#snapshotFor(organisationId).sessions.find(
      (item) => item.id === sessionId && item.organisationId === organisationId
    );
    if (!session) throw new NotFoundError("Agent session", sessionId);
    return structuredClone(this.#contexts.get(sessionId)?.at(-1));
  }

  async saveReport(
    organisationId: string,
    report: SafetyReport,
    sessionId?: string,
    contextRevision?: number
  ): Promise<SafetyReport> {
    this.#assertOrganisation(organisationId);
    let linked = sessionId ? { ...report, sessionId } : report;
    if (sessionId) {
      const session = this.#snapshotFor(organisationId).sessions.find(
        (item) => item.id === sessionId && item.organisationId === organisationId
      );
      if (!session) throw new NotFoundError("Agent session", sessionId);
      if (session.repositoryId !== report.repositoryId)
        throw new ForbiddenError("Report repository does not belong to the session");
      if (!report.contextId || !contextRevision)
        throw new ConflictError(
          "A persisted context revision is required before saving a session report"
        );
      const context = this.#contexts
        .get(sessionId)
        ?.find((record) => record.id === report.contextId && record.revision === contextRevision);
      if (!context)
        throw new ForbiddenError("Report context does not belong to the session revision");
      const observation = createChangeObservation({
        organisationId,
        sessionId,
        contextId: report.contextId,
        contextRevision,
        report
      });
      this.#observations.unshift(observation);
      linked = { ...linked, contextRevision, observationId: observation.id };
      session.status = "completed";
      session.currentCommit = report.currentCommit;
      session.completedAt = new Date().toISOString();
      session.warningCount = report.warnings.length;
      session.filesChanged = report.changedFiles.map((file) => file.path);
      this.#appendSessionEvent(sessionId, "verification_started", {
        contextId: report.contextId,
        contextRevision,
        observationId: observation.id
      });
      this.#appendSessionEvent(sessionId, "verification_finished", {
        reportId: report.id,
        observationId: observation.id,
        risk: report.risk
      });
      this.#appendSessionEvent(sessionId, "completed", { reportId: report.id });
    }
    this.#snapshotFor(organisationId).reports.unshift(structuredClone(linked));
    return structuredClone(linked);
  }

  async getChangeObservation(
    organisationId: string,
    observationId: string
  ): Promise<ChangeObservation> {
    this.#assertOrganisation(organisationId);
    const observation = this.#observations.find(
      (item) => item.id === observationId && item.organisationId === organisationId
    );
    if (!observation) throw new NotFoundError("Change observation", observationId);
    return structuredClone(observation);
  }

  async ingestEvidence(records: EvidenceRecord[]): Promise<number> {
    let changed = 0;
    for (const record of records) {
      this.#assertOrganisation(record.organisationId);
      const index = this.#evidence.findIndex(
        (existing) =>
          existing.organisationId === record.organisationId &&
          existing.provider === record.provider &&
          existing.externalId === record.externalId
      );
      const normalized = { ...structuredClone(record), contentHash: this.#evidenceHash(record) };
      if (index < 0) {
        this.#evidence.push(normalized);
        this.#evidenceRevisions.set(record.id, [this.#revision(normalized, 1)]);
        changed += 1;
        continue;
      }
      const existing = this.#evidence[index]!;
      if (this.#evidenceHash(existing) === normalized.contentHash) continue;
      const revisions = this.#evidenceRevisions.get(existing.id) ?? [this.#revision(existing, 1)];
      revisions.push(this.#revision({ ...normalized, id: existing.id }, revisions.length + 1));
      this.#evidenceRevisions.set(existing.id, revisions);
      this.#evidence[index] = { ...normalized, id: existing.id };
      changed += 1;
    }
    return changed;
  }

  async hasIngestionReceipt(
    organisationId: string,
    provider: string,
    externalId: string
  ): Promise<boolean> {
    this.#assertOrganisation(organisationId);
    return this.#receipts.has(`${organisationId}:${provider}:${externalId}`);
  }

  async saveIngestionReceipt(
    organisationId: string,
    provider: string,
    externalId: string,
    eventType: string
  ): Promise<void> {
    void eventType;
    this.#assertOrganisation(organisationId);
    this.#receipts.add(`${organisationId}:${provider}:${externalId}`);
  }

  public createId(prefix: string): string {
    void prefix;
    return newUuid();
  }

  #evidenceHash(record: EvidenceRecord): string {
    return (
      record.contentHash ??
      createHash("sha256")
        .update(
          JSON.stringify({
            url: record.url ?? null,
            title: record.title ?? null,
            content: record.content,
            author: record.author ?? null,
            occurredAt: record.occurredAt,
            metadata: record.metadata
          })
        )
        .digest("hex")
    );
  }

  #revision(
    record: EvidenceRecord,
    version: number,
    createdAt = new Date().toISOString()
  ): EvidenceRevisionRecord {
    return {
      id: newUuid(),
      evidenceId: record.id,
      version,
      contentHash: this.#evidenceHash(record),
      ...(record.url ? { url: record.url } : {}),
      ...(record.title ? { title: record.title } : {}),
      content: record.content,
      ...(record.author ? { author: record.author } : {}),
      occurredAt: record.occurredAt,
      metadata: structuredClone(record.metadata),
      createdAt
    };
  }

  #apiTokenSummary(token: ApiTokenRecord): ApiTokenSummary {
    return {
      id: token.id,
      organisationId: token.organisationId,
      name: token.name,
      prefix: token.prefix,
      scopes: [...token.scopes],
      ...(token.expiresAt ? { expiresAt: token.expiresAt } : {}),
      ...(token.lastUsedAt ? { lastUsedAt: token.lastUsedAt } : {}),
      createdAt: token.createdAt
    };
  }

  #appendSessionEvent(
    sessionId: string,
    type: SessionEvent["type"],
    data: Record<string, unknown>
  ): void {
    const events = this.#sessionEvents.get(sessionId) ?? [];
    events.push({
      id: newUuid(),
      sessionId,
      sequence: events.length + 1,
      type,
      data,
      createdAt: new Date().toISOString()
    });
    this.#sessionEvents.set(sessionId, events);
  }

  #assertOrganisation(organisationId: string): void {
    if (!this.#snapshots.has(organisationId)) throw new ForbiddenError();
  }

  #snapshotFor(organisationId: string): DashboardSnapshot {
    this.#assertOrganisation(organisationId);
    return this.#snapshots.get(organisationId)!;
  }
}
