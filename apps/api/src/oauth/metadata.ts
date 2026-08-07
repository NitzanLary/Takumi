/**
 * OAuth discovery documents.
 *
 * Claude finds the authorization server by reading the protected resource
 * metadata (RFC 9728) that our 401 points at, then the authorization server
 * metadata (RFC 8414) at the issuer's well-known path.
 *
 * Everything is anchored on `APP_URL` — the public web origin — because that
 * is the only host reachable from Anthropic's egress range. The Express API is
 * private on Railway and is reached through the Next.js rewrites.
 */

import { Router } from 'express';
import { config } from '../lib/config.js';

/** Public origin, no trailing slash (RFC 8707 canonical form). */
export const ISSUER = config.appUrl.replace(/\/+$/, '');

/** The MCP endpoint's canonical URI — the RFC 8707 audience for every token. */
export const MCP_RESOURCE = `${ISSUER}/api/mcp`;

export const SCOPES = ['takumi:read', 'offline_access'];

export const authorizationServerMetadata = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/api/oauth/authorize`,
  token_endpoint: `${ISSUER}/api/oauth/token`,
  registration_endpoint: `${ISSUER}/api/oauth/register`,
  scopes_supported: SCOPES,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  // Claude registers via DCR as a public client and authenticates at the token
  // endpoint with PKCE alone.
  token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
  // Required by the MCP auth spec so clients can verify S256 before starting.
  code_challenge_methods_supported: ['S256'],
  resource_indicators_supported: true,
};

export const protectedResourceMetadata = {
  resource: MCP_RESOURCE,
  authorization_servers: [ISSUER],
  scopes_supported: SCOPES,
  bearer_methods_supported: ['header'],
};

/**
 * Mounted at the root (not under /api) so the documents sit at the well-known
 * paths clients probe. `next.config.mjs` rewrites /.well-known/* here.
 *
 * The protected resource document is served at both the path-qualified
 * location (RFC 9728 §3.1, for a resource with a path component) and the bare
 * one, since Claude probes them in that order when no explicit pointer is
 * given. Our 401 does give an explicit pointer, so this is belt and braces.
 */
export const wellKnownRouter: Router = Router();

wellKnownRouter.get('/.well-known/oauth-authorization-server', (_req, res) => {
  res.json(authorizationServerMetadata);
});

wellKnownRouter.get(
  ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/mcp'],
  (_req, res) => {
    res.json(protectedResourceMetadata);
  }
);

/** The `WWW-Authenticate` value every unauthenticated MCP response carries. */
export function wwwAuthenticate(error?: string, description?: string): string {
  const parts = [
    `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/api/mcp"`,
  ];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description}"`);
  return parts.join(', ');
}
