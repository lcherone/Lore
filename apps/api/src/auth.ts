import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { LoreStore } from "@lore/core/index.js";
import { ForbiddenError, LoreError } from "@lore/core/index.js";
import { DEMO_ORGANISATION_ID } from "@lore/shared/demo-data.js";
import type { AccountSession, GitHubUserIdentity, OrganisationRole } from "@lore/shared/types.js";

export const SESSION_COOKIE = "lore_session";
export const OAUTH_COOKIE = "lore_github_oauth";

export interface AuthContext {
  sessionId: string;
  userId: string;
  name: string;
  authType: "session" | "api_token" | "synthetic";
  activeOrganisationId?: string;
  role?: OrganisationRole;
  scopes?: Array<"read" | "write">;
  synthetic?: boolean;
}

export interface TenantContext {
  organisationId: string;
  userId: string;
  name: string;
  role: OrganisationRole;
}

declare module "fastify" {
  interface FastifyRequest {
    loreAuth?: AuthContext;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function resolveAuthentication(
  request: FastifyRequest,
  store: LoreStore,
  demoMode: boolean
): Promise<AuthContext | undefined> {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    const rawToken = authorization.slice("Bearer ".length).trim();
    if (rawToken.startsWith("lore_pat_") && rawToken.length >= 40) {
      const token = await store.getApiToken(hashToken(rawToken));
      if (token) {
        const [user, role] = await Promise.all([
          store.getUserProfile(token.userId),
          store.getMembershipRole(token.organisationId, token.userId)
        ]);
        return {
          sessionId: token.id,
          userId: token.userId,
          name: user.name,
          authType: "api_token",
          activeOrganisationId: token.organisationId,
          role,
          scopes: token.scopes
        };
      }
    }
  }

  const signed = request.cookies[SESSION_COOKIE];
  if (signed) {
    const result = request.unsignCookie(signed);
    if (result.valid && result.value) {
      const session = await store.getAuthSession(hashToken(result.value));
      if (session && !session.revokedAt && Date.parse(session.expiresAt) > Date.now()) {
        const user = await store.getUserProfile(session.userId);
        const organisations = await store.listOrganisationAccess(session.userId);
        const active = organisations.find((organisation) => organisation.id === session.activeOrganisationId);
        if (Date.now() - Date.parse(session.lastSeenAt) > 5 * 60 * 1000) {
          await store.touchAuthSession(session.id, new Date().toISOString());
        }
        return {
          sessionId: session.id,
          userId: user.id,
          name: user.name,
          authType: "session",
          ...(active ? { activeOrganisationId: active.id, role: active.role } : {})
        };
      }
    }
  }

  if (demoMode && process.env.DEMO_REQUIRE_LOGIN !== "true") {
    return {
      sessionId: "demo-auto-session",
      userId: "user_casey",
      name: "Casey Hall",
      authType: "synthetic",
      activeOrganisationId: DEMO_ORGANISATION_ID,
      role: "owner",
      synthetic: true
    };
  }

  return undefined;
}

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.loreAuth) throw new LoreError("Authentication is required", "UNAUTHENTICATED", 401);
  return request.loreAuth;
}

export function tenantContext(request: FastifyRequest, _demoMode?: boolean): TenantContext {
  void _demoMode;
  const auth = requireAuth(request);
  if (!auth.activeOrganisationId || !auth.role) {
    throw new LoreError("Choose or create an organisation to continue", "ORGANISATION_REQUIRED", 409);
  }
  return { organisationId: auth.activeOrganisationId, userId: auth.userId, name: auth.name, role: auth.role };
}

export async function accountSession(
  request: FastifyRequest,
  store: LoreStore,
  demoMode: boolean,
  githubLoginEnabled: boolean
): Promise<AccountSession> {
  const auth = request.loreAuth;
  if (!auth) return { authenticated: false, demoMode, githubLoginEnabled, organisations: [], pendingInvitations: [] };
  const [user, organisations, pendingInvitations] = await Promise.all([
    store.getUserProfile(auth.userId),
    store.listOrganisationAccess(auth.userId),
    store.listPendingInvitations(auth.userId)
  ]);
  const activeOrganisation = organisations.find((organisation) => organisation.id === auth.activeOrganisationId);
  return {
    authenticated: true,
    demoMode,
    githubLoginEnabled,
    user,
    ...(activeOrganisation ? { activeOrganisation } : {}),
    organisations,
    pendingInvitations
  };
}

export async function issueSession(
  request: FastifyRequest,
  store: LoreStore,
  userId: string,
  activeOrganisationId?: string
): Promise<{ token: string; sessionId: string; expiresAt: string }> {
  const token = newSessionToken();
  const configuredHours = Number.parseInt(process.env.AUTH_SESSION_TTL_HOURS ?? "24", 10);
  const ttlHours = Number.isFinite(configuredHours) ? Math.min(Math.max(configuredHours, 1), 720) : 24;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  const userAgent = String(request.headers["user-agent"] ?? "unknown");
  const forwarded = String(request.headers["x-forwarded-for"] ?? request.ip ?? "unknown").split(",")[0]!.trim();
  const session = await store.createAuthSession({
    userId,
    tokenHash: hashToken(token),
    ...(activeOrganisationId ? { activeOrganisationId } : {}),
    expiresAt,
    userAgentHash: hashToken(userAgent),
    ipHash: hashToken(forwarded)
  });
  return { token, sessionId: session.id, expiresAt };
}

export interface OAuthTransaction {
  state: string;
  verifier: string;
  returnTo: string;
  expiresAt: number;
}

export function createOAuthTransaction(returnTo: string): OAuthTransaction {
  return {
    state: randomBytes(32).toString("base64url"),
    verifier: randomBytes(48).toString("base64url"),
    returnTo,
    expiresAt: Date.now() + 10 * 60 * 1000
  };
}

export function encodeOAuthTransaction(transaction: OAuthTransaction): string {
  return Buffer.from(JSON.stringify(transaction), "utf8").toString("base64url");
}

export function decodeOAuthTransaction(value: string): OAuthTransaction | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<OAuthTransaction>;
    if (typeof parsed.state === "string" && typeof parsed.verifier === "string" && typeof parsed.returnTo === "string" && typeof parsed.expiresAt === "number") {
      return parsed as OAuthTransaction;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function verifyOAuthTransaction(transaction: OAuthTransaction, suppliedState: string): boolean {
  return transaction.expiresAt > Date.now() && safeEqual(transaction.state, suppliedState);
}

export interface GitHubIdentityProvider {
  readonly configured: boolean;
  authorizationUrl(transaction: OAuthTransaction): string;
  authenticate(code: string, verifier: string): Promise<GitHubUserIdentity>;
}

export class GitHubOAuthProvider implements GitHubIdentityProvider {
  readonly #clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  readonly #clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  readonly #callbackUrl = process.env.GITHUB_OAUTH_CALLBACK_URL
    ?? `${(process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "")}/api/auth/github/callback`;

  get configured(): boolean {
    return Boolean(this.#clientId && this.#clientSecret);
  }

  authorizationUrl(transaction: OAuthTransaction): string {
    if (!this.configured) throw new LoreError("GitHub sign-in is not configured", "AUTH_NOT_CONFIGURED", 503);
    const challenge = createHash("sha256").update(transaction.verifier).digest("base64url");
    const query = new URLSearchParams({
      client_id: this.#clientId!,
      redirect_uri: this.#callbackUrl,
      scope: "read:user user:email",
      state: transaction.state,
      code_challenge: challenge,
      code_challenge_method: "S256"
    });
    return `https://github.com/login/oauth/authorize?${query.toString()}`;
  }

  async authenticate(code: string, verifier: string): Promise<GitHubUserIdentity> {
    if (!this.configured) throw new LoreError("GitHub sign-in is not configured", "AUTH_NOT_CONFIGURED", 503);
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "user-agent": "Lore" },
      body: JSON.stringify({ client_id: this.#clientId, client_secret: this.#clientSecret, code, redirect_uri: this.#callbackUrl, code_verifier: verifier })
    });
    const tokenBody = await tokenResponse.json() as { access_token?: string; error_description?: string };
    if (!tokenResponse.ok || !tokenBody.access_token) {
      throw new LoreError(tokenBody.error_description ?? "GitHub did not accept the sign-in code", "GITHUB_AUTH_FAILED", 401);
    }
    const headers = { accept: "application/vnd.github+json", authorization: `Bearer ${tokenBody.access_token}`, "user-agent": "Lore", "x-github-api-version": "2022-11-28" };
    const [userResponse, emailResponse] = await Promise.all([
      fetch("https://api.github.com/user", { headers }),
      fetch("https://api.github.com/user/emails", { headers })
    ]);
    if (!userResponse.ok || !emailResponse.ok) throw new LoreError("GitHub profile details could not be read", "GITHUB_PROFILE_FAILED", 502);
    const user = await userResponse.json() as Record<string, unknown>;
    const emails = await emailResponse.json() as Array<Record<string, unknown>>;
    const email = emails.find((item) => item.primary === true && item.verified === true)
      ?? emails.find((item) => item.verified === true);
    if (!email || typeof email.email !== "string") {
      throw new LoreError("A verified email address is required on your GitHub account", "VERIFIED_EMAIL_REQUIRED", 403);
    }
    if ((typeof user.id !== "number" && typeof user.id !== "string") || typeof user.login !== "string") {
      throw new LoreError("GitHub returned an invalid user profile", "GITHUB_PROFILE_FAILED", 502);
    }
    const optionalString = (key: string): string | undefined => typeof user[key] === "string" && user[key] ? String(user[key]) : undefined;
    return {
      providerUserId: String(user.id),
      login: user.login,
      email: email.email,
      name: optionalString("name") ?? user.login,
      profileUrl: optionalString("html_url") ?? `https://github.com/${user.login}`,
      ...(optionalString("avatar_url") ? { avatarUrl: optionalString("avatar_url") } : {}),
      ...(optionalString("bio") ? { bio: optionalString("bio") } : {}),
      ...(optionalString("company") ? { company: optionalString("company") } : {}),
      ...(optionalString("location") ? { location: optionalString("location") } : {}),
      ...(optionalString("blog") ? { websiteUrl: optionalString("blog") } : {})
    };
  }
}

// The repository GitHub App installation flow uses this separate signed state.
export function createOAuthState(secret: string): string {
  const nonce = randomUUID();
  const signature = createHmac("sha256", secret).update(nonce).digest("base64url");
  return `${nonce}.${signature}`;
}

export function verifyOAuthState(secret: string, state: string): boolean {
  const [nonce, supplied] = state.split(".");
  if (!nonce || !supplied) return false;
  const expected = createHmac("sha256", secret).update(nonce).digest("base64url");
  return safeEqual(expected, supplied);
}

export function assertRole(role: OrganisationRole, allowed: OrganisationRole[]): void {
  if (!allowed.includes(role)) throw new ForbiddenError(`This action requires ${allowed.join(" or ")} access`);
}
