import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { LoreError } from "@lore/core/index.js";
import { DEMO_ORGANISATION_ID } from "@lore/shared/demo-data.js";

export interface TenantContext {
  organisationId: string;
  userId: string;
  name: string;
}

interface SessionCookie {
  organisationId: string;
  userId: string;
  name: string;
}

const decodeSession = (value: string): SessionCookie | undefined => {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<SessionCookie>;
    if (parsed.organisationId && parsed.userId && parsed.name) return parsed as SessionCookie;
  } catch {
    return undefined;
  }
  return undefined;
};

export function tenantContext(request: FastifyRequest, demoMode: boolean): TenantContext {
  const signed = request.cookies.lore_session;
  if (signed) {
    const result = request.unsignCookie(signed);
    if (result.valid && result.value) {
      const session = decodeSession(result.value);
      if (session) return session;
    }
  }
  if (demoMode) {
    return { organisationId: DEMO_ORGANISATION_ID, userId: "user_casey", name: "Casey Hall" };
  }
  if (process.env.LOCAL_DEV_AUTH === "true") {
    const appUrl = new URL(process.env.APP_URL ?? "http://localhost:5173");
    if (!new Set(["localhost", "127.0.0.1", "::1"]).has(appUrl.hostname)) {
      throw new LoreError("LOCAL_DEV_AUTH is restricted to loopback APP_URL values", "UNSAFE_LOCAL_AUTH", 500);
    }
    const organisationId = process.env.LOCAL_ORGANISATION_ID;
    const userId = process.env.LOCAL_USER_ID;
    if (!organisationId || !userId) {
      throw new LoreError("Local auth IDs are not configured", "NOT_CONFIGURED", 503);
    }
    return { organisationId, userId, name: process.env.LOCAL_USER_NAME ?? "Local Lore User" };
  }
  throw new LoreError("Authentication is required", "UNAUTHENTICATED", 401);
}

export function encodeSession(session: SessionCookie): string {
  return Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
}

export function createOAuthState(secret: string): string {
  const nonce = randomUUID();
  const signature = createHmac("sha256", secret).update(nonce).digest("base64url");
  return `${nonce}.${signature}`;
}

export function verifyOAuthState(secret: string, state: string): boolean {
  const [nonce, supplied] = state.split(".");
  if (!nonce || !supplied) return false;
  const expected = createHmac("sha256", secret).update(nonce).digest("base64url");
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}
