/**
 * OAuth 2.1 authorization server endpoints: /register (RFC 7591 DCR),
 * /authorize (code + PKCE), /token (code exchange + refresh rotation).
 *
 * Mounted publicly at /api/oauth — these run *before* `requireAuth`, since
 * they are how a client gets credentials in the first place. /authorize does
 * its own user check against the existing `takumi_session` cookie, so the web
 * login doubles as the consent login and no second identity system exists.
 */

import { Router, urlencoded, json } from 'express';
import { parse as parseCookies } from 'cookie';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { SESSION_COOKIE, hashSessionToken } from '../middleware/require-auth.js';
import { ISSUER, MCP_RESOURCE, SCOPES } from './metadata.js';
import {
  AUTH_CODE_TTL_MS,
  hashToken,
  issueTokens,
  randomToken,
  verifyPkce,
} from './tokens.js';

export const oauthRouter: Router = Router();

// RFC 7591 registration is JSON; RFC 6749 token requests are form-encoded.
// Express's global express.json() covers the former, but the token endpoint
// 415s without an explicit urlencoded parser.
oauthRouter.use(json());
oauthRouter.use(urlencoded({ extended: false }));

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}

/** Only HTTPS, or loopback for native clients (RFC 8252). */
function isAllowedRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/**
 * Claude Code uses an ephemeral loopback port per session, so registered
 * loopback URIs are matched with the port ignored (RFC 8252 §7.3). Everything
 * else must match exactly.
 */
function redirectUriMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  try {
    const a = new URL(registered);
    const b = new URL(requested);
    const loopback = (h: string) => h === 'localhost' || h === '127.0.0.1';
    return (
      a.protocol === 'http:' &&
      b.protocol === 'http:' &&
      loopback(a.hostname) &&
      loopback(b.hostname) &&
      a.pathname === b.pathname
    );
  } catch {
    return false;
  }
}

function grantedScope(requested: string | undefined): string {
  if (!requested) return SCOPES.join(' ');
  const ok = requested.split(/\s+/).filter((s) => SCOPES.includes(s));
  return ok.length ? ok.join(' ') : SCOPES.join(' ');
}

async function userFromSession(cookieHeader: string | undefined) {
  const raw = parseCookies(cookieHeader ?? '')[SESSION_COOKIE];
  if (!raw) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(raw) },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

// ─── Dynamic Client Registration (RFC 7591) ──────────────────────

oauthRouter.post('/register', async (req, res) => {
  const body = req.body ?? {};
  const redirectUris: unknown = body.redirect_uris;

  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return res.status(400).json({
      error: 'invalid_redirect_uri',
      error_description: 'redirect_uris is required and must be a non-empty array',
    });
  }
  if (!redirectUris.every((u) => typeof u === 'string' && isAllowedRedirectUri(u))) {
    return res.status(400).json({
      error: 'invalid_redirect_uri',
      error_description: 'redirect_uris must be https, or http on localhost/127.0.0.1',
    });
  }

  const clientId = randomToken();
  const authMethod = body.token_endpoint_auth_method === 'client_secret_post'
    ? 'client_secret_post'
    : 'none';
  const clientSecret = authMethod === 'client_secret_post' ? randomToken() : null;

  await prisma.oAuthClient.create({
    data: {
      clientId,
      clientSecretHash: clientSecret ? hashToken(clientSecret) : null,
      clientName: typeof body.client_name === 'string' ? body.client_name.slice(0, 200) : null,
      redirectUris: redirectUris as string[],
      tokenEndpointAuthMethod: authMethod,
    },
  });

  logger.info(
    { module: 'oauth', clientId, clientName: body.client_name },
    'Registered OAuth client'
  );

  res.status(201).json({
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: authMethod,
  });
});

// ─── Authorization endpoint ──────────────────────────────────────

interface AuthzParams {
  clientId: string;
  redirectUri: string;
  state?: string;
  scope: string;
  codeChallenge: string;
  resource: string;
}

/** Render a terminal error. Used only when we must NOT redirect. */
function authzError(res: Parameters<typeof oauthRouter.get>[1] extends never ? never : any, message: string) {
  res.status(400).type('html').send(
    `<!doctype html><meta charset="utf-8"><title>Authorization error</title>
     <body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
     <h1 style="font-size:1.25rem">Authorization error</h1>
     <p>${esc(message)}</p></body>`
  );
}

async function parseAuthzRequest(
  src: Record<string, unknown>
): Promise<{ params: AuthzParams } | { fatal: string } | { redirect: string; error: string; description: string }> {
  const clientId = String(src.client_id ?? '');
  const redirectUri = String(src.redirect_uri ?? '');

  const client = clientId
    ? await prisma.oAuthClient.findUnique({ where: { clientId } })
    : null;
  if (!client) return { fatal: 'Unknown client_id. Try removing and re-adding the connector.' };
  if (!redirectUri || !client.redirectUris.some((u) => redirectUriMatches(u, redirectUri))) {
    return { fatal: 'redirect_uri does not match a registered value for this client.' };
  }

  // Past this point errors go back to the client via redirect (RFC 6749 §4.1.2.1).
  const state = src.state == null ? undefined : String(src.state);
  const fail = (error: string, description: string) => ({ redirect: redirectUri, error, description, state });

  if (String(src.response_type ?? '') !== 'code') {
    return fail('unsupported_response_type', 'Only response_type=code is supported');
  }
  const codeChallenge = String(src.code_challenge ?? '');
  if (!codeChallenge) return fail('invalid_request', 'code_challenge is required (PKCE)');
  if (String(src.code_challenge_method ?? '') !== 'S256') {
    return fail('invalid_request', 'code_challenge_method must be S256');
  }

  // RFC 8707: we host exactly one resource, so anything else is invalid_target.
  const resourceRaw = src.resource == null ? '' : String(src.resource);
  const resource = resourceRaw.replace(/\/+$/, '');
  if (resource && resource !== MCP_RESOURCE) {
    return fail('invalid_target', `Unknown resource "${resourceRaw}"; this server hosts ${MCP_RESOURCE}`);
  }

  return {
    params: {
      clientId,
      redirectUri,
      state,
      scope: grantedScope(src.scope == null ? undefined : String(src.scope)),
      codeChallenge,
      resource: MCP_RESOURCE,
    },
  };
}

function redirectWithError(
  res: any,
  redirectUri: string,
  error: string,
  description: string,
  state?: string
) {
  const u = new URL(redirectUri);
  u.searchParams.set('error', error);
  u.searchParams.set('error_description', description);
  if (state) u.searchParams.set('state', state);
  res.redirect(302, u.toString());
}

oauthRouter.get('/authorize', async (req, res) => {
  const parsed = await parseAuthzRequest(req.query as Record<string, unknown>);
  if ('fatal' in parsed) return authzError(res, parsed.fatal);
  if ('redirect' in parsed) {
    return redirectWithError(res, parsed.redirect, parsed.error, parsed.description, (parsed as any).state);
  }
  const { params } = parsed;

  const user = await userFromSession(req.headers.cookie);
  if (!user) {
    // Bounce through the existing web login, then back here. Same origin, so
    // the session cookie set by /login is present on the retry.
    const next = `/api/oauth/authorize?${new URLSearchParams(req.query as Record<string, string>).toString()}`;
    return res.redirect(302, `${ISSUER}/login?next=${encodeURIComponent(next)}`);
  }

  const client = await prisma.oAuthClient.findUnique({ where: { clientId: params.clientId } });
  const clientName = client?.clientName || 'An MCP client';
  const hidden = Object.entries(req.query as Record<string, string>)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(String(v))}">`)
    .join('');

  res.type('html').send(
    `<!doctype html><meta charset="utf-8"><title>Connect to Takumi</title>
<body style="font-family:system-ui;max-width:30rem;margin:4rem auto;padding:0 1.25rem;line-height:1.5">
  <h1 style="font-size:1.35rem;margin-bottom:.25rem">Connect to Takumi</h1>
  <p style="color:#555;margin-top:0">Signed in as <strong>${esc(user.email)}</strong></p>
  <p><strong>${esc(clientName)}</strong> is asking for read-only access to your portfolio:
     positions, trades, P&amp;L, analytics and market data.</p>
  <p style="color:#555;font-size:.9rem">It cannot place trades, modify data, or change your account.
     Requested scope: <code>${esc(params.scope)}</code>.</p>
  <p style="color:#555;font-size:.85rem">Redirects to <code>${esc(params.redirectUri)}</code></p>
  <form method="post" action="${ISSUER}/api/oauth/authorize" style="display:flex;gap:.75rem;margin-top:1.5rem">
    ${hidden}
    <button name="approve" value="yes" style="padding:.6rem 1.1rem;border:0;border-radius:.4rem;background:#111;color:#fff;font-size:1rem;cursor:pointer">Allow</button>
    <button name="approve" value="no" style="padding:.6rem 1.1rem;border:1px solid #ccc;border-radius:.4rem;background:#fff;font-size:1rem;cursor:pointer">Deny</button>
  </form>
</body>`
  );
});

oauthRouter.post('/authorize', async (req, res) => {
  const parsed = await parseAuthzRequest(req.body ?? {});
  if ('fatal' in parsed) return authzError(res, parsed.fatal);
  if ('redirect' in parsed) {
    return redirectWithError(res, parsed.redirect, parsed.error, parsed.description, (parsed as any).state);
  }
  const { params } = parsed;

  const user = await userFromSession(req.headers.cookie);
  if (!user) return authzError(res, 'Your session expired. Please retry the connection.');

  if (req.body?.approve !== 'yes') {
    return redirectWithError(res, params.redirectUri, 'access_denied', 'User denied the request', params.state);
  }

  const code = randomToken();
  await prisma.oAuthGrant.create({
    data: {
      codeHash: hashToken(code),
      clientId: params.clientId,
      userId: user.id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scope: params.scope,
      resource: params.resource,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    },
  });

  logger.info(
    { module: 'oauth', userId: user.id, clientId: params.clientId },
    'Authorization code issued'
  );

  const u = new URL(params.redirectUri);
  u.searchParams.set('code', code);
  if (params.state) u.searchParams.set('state', params.state);
  res.redirect(302, u.toString());
});

// ─── Token endpoint ──────────────────────────────────────────────

function tokenError(res: any, status: number, error: string, description: string) {
  res.status(status).json({ error, error_description: description });
}

oauthRouter.post('/token', async (req, res) => {
  // Never let a client cache a token response.
  res.set('Cache-Control', 'no-store');

  const body = req.body ?? {};
  const grantType = String(body.grant_type ?? '');

  if (grantType === 'authorization_code') {
    const code = String(body.code ?? '');
    const grant = code
      ? await prisma.oAuthGrant.findUnique({ where: { codeHash: hashToken(code) } })
      : null;
    if (!grant) return tokenError(res, 400, 'invalid_grant', 'Unknown or expired authorization code');

    if (grant.consumedAt) {
      // OAuth 2.1 replay defence: a reused code invalidates everything it
      // produced, since we cannot tell the attacker from the legitimate client.
      await prisma.oAuthToken.updateMany({
        where: { clientId: grant.clientId, userId: grant.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      logger.warn(
        { module: 'oauth', clientId: grant.clientId, userId: grant.userId },
        'Authorization code replayed — revoked all tokens for this client/user'
      );
      return tokenError(res, 400, 'invalid_grant', 'Authorization code already used');
    }
    if (grant.expiresAt < new Date()) {
      return tokenError(res, 400, 'invalid_grant', 'Authorization code expired');
    }
    if (String(body.client_id ?? '') !== grant.clientId) {
      return tokenError(res, 400, 'invalid_grant', 'client_id does not match the authorization code');
    }
    if (String(body.redirect_uri ?? '') !== grant.redirectUri) {
      return tokenError(res, 400, 'invalid_grant', 'redirect_uri does not match the authorization request');
    }
    const verifier = String(body.code_verifier ?? '');
    if (!verifier || !verifyPkce(verifier, grant.codeChallenge)) {
      return tokenError(res, 400, 'invalid_grant', 'PKCE verification failed');
    }

    await prisma.oAuthGrant.update({
      where: { id: grant.id },
      data: { consumedAt: new Date() },
    });

    const tokens = await issueTokens({
      clientId: grant.clientId,
      userId: grant.userId,
      scope: grant.scope,
      resource: grant.resource,
    });
    return res.json(tokens);
  }

  if (grantType === 'refresh_token') {
    const refresh = String(body.refresh_token ?? '');
    const existing = refresh
      ? await prisma.oAuthToken.findUnique({ where: { refreshTokenHash: hashToken(refresh) } })
      : null;
    if (!existing || existing.revokedAt) {
      return tokenError(res, 400, 'invalid_grant', 'Unknown or revoked refresh token');
    }
    if (existing.refreshExpiresAt && existing.refreshExpiresAt < new Date()) {
      return tokenError(res, 400, 'invalid_grant', 'Refresh token expired');
    }
    if (String(body.client_id ?? '') !== existing.clientId) {
      return tokenError(res, 400, 'invalid_grant', 'client_id does not match the refresh token');
    }

    // Rotate: the old pair dies in the same transaction that mints the new one.
    await prisma.oAuthToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    const tokens = await issueTokens({
      clientId: existing.clientId,
      userId: existing.userId,
      scope: existing.scope,
      resource: existing.resource,
    });
    return res.json(tokens);
  }

  return tokenError(res, 400, 'unsupported_grant_type', `grant_type "${grantType}" is not supported`);
});
