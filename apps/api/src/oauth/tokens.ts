/**
 * Token minting, hashing and verification for the OAuth 2.1 authorization
 * server. Nothing here is ever persisted in the clear — the DB stores SHA-256
 * hashes, mirroring how `sessions.token_hash` works for the web session.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { prisma } from '../lib/db.js';

/** Access tokens are short-lived; Claude refreshes reactively on 401. */
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const AUTH_CODE_TTL_MS = 60 * 1000; // 1 minute

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * PKCE S256 check (RFC 7636). `plain` is deliberately unsupported — OAuth 2.1
 * requires S256, and Claude always sends `code_challenge_method=S256`.
 */
export function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface IssuedTokens {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

/**
 * Mint an access token (plus a refresh token when `offline_access` was
 * granted) bound to the user, client and RFC 8707 resource.
 */
export async function issueTokens(params: {
  clientId: string;
  userId: string;
  scope: string;
  resource: string | null;
}): Promise<IssuedTokens> {
  const accessToken = randomToken();
  const withRefresh = params.scope.split(' ').includes('offline_access');
  const refreshToken = withRefresh ? randomToken() : null;
  const now = Date.now();

  await prisma.oAuthToken.create({
    data: {
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: refreshToken ? hashToken(refreshToken) : null,
      clientId: params.clientId,
      userId: params.userId,
      scope: params.scope,
      resource: params.resource,
      expiresAt: new Date(now + ACCESS_TOKEN_TTL_MS),
      refreshExpiresAt: refreshToken ? new Date(now + REFRESH_TOKEN_TTL_MS) : null,
    },
  });

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    scope: params.scope,
  };
}

export interface ResolvedToken {
  userId: string;
  clientId: string;
  scope: string;
  resource: string | null;
}

/**
 * Validate a bearer access token. `expectedResource` enforces RFC 8707
 * audience binding: a token minted for a different resource must be rejected,
 * never merely ignored.
 */
export async function resolveAccessToken(
  token: string,
  expectedResource: string
): Promise<ResolvedToken | null> {
  const row = await prisma.oAuthToken.findUnique({
    where: { accessTokenHash: hashToken(token) },
    select: {
      userId: true,
      clientId: true,
      scope: true,
      resource: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  if (!row || row.revokedAt || row.expiresAt < new Date()) return null;
  // Tokens minted before a resource was recorded are not accepted for a
  // specific resource — no implicit audience widening.
  if (row.resource !== expectedResource) return null;

  return {
    userId: row.userId,
    clientId: row.clientId,
    scope: row.scope,
    resource: row.resource,
  };
}
