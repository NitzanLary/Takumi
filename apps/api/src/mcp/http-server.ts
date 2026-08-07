/**
 * Remote MCP endpoint — Streamable HTTP, mounted at /api/mcp.
 *
 * This is the resource server half of the custom connector. The authorization
 * server lives in `src/oauth/`; here we only validate the bearer token, map it
 * to a `userId`, and run the same tool adapter the stdio server uses.
 *
 * Two deliberate choices:
 *
 * 1. `enableJsonResponse` — replies are plain application/json, never SSE.
 *    Requests reach us through the Next.js rewrite, which does not flush SSE
 *    per event (that is why `app/api/chat/route.ts` exists as a hand-rolled
 *    route handler). Tool calls are request/response, so JSON costs nothing.
 *
 * 2. Stateless — a fresh Server and transport per request, with no session id.
 *    The connector holds no cross-request state, and this keeps the endpoint
 *    safe to run across multiple Railway replicas.
 */

import { Router, type Request, type Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../lib/logger.js';
import { MCP_RESOURCE, wwwAuthenticate } from '../oauth/metadata.js';
import { resolveAccessToken } from '../oauth/tokens.js';
import { INSTRUCTIONS, callMcpTool, mcpTools } from './tools.js';

export const mcpRouter: Router = Router();

/**
 * Bearer check. A missing or bad token MUST be a 401 carrying
 * `WWW-Authenticate` with a `resource_metadata` pointer — that header is how
 * Claude discovers the authorization server, and it is ignored on a 200.
 */
async function authenticate(req: Request, res: Response): Promise<string | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res
      .status(401)
      .set('WWW-Authenticate', wwwAuthenticate())
      .json({ error: 'unauthorized', message: 'Missing bearer token' });
    return null;
  }

  const resolved = await resolveAccessToken(header.slice(7).trim(), MCP_RESOURCE);
  if (!resolved) {
    res
      .status(401)
      .set('WWW-Authenticate', wwwAuthenticate('invalid_token', 'Token is expired, revoked, or issued for another resource'))
      .json({ error: 'invalid_token', message: 'Token is not valid for this resource' });
    return null;
  }

  return resolved.userId;
}

function buildServer(userId: string): Server {
  const server = new Server(
    { name: 'takumi', version: '0.1.0' },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: mcpTools }));
  server.setRequestHandler(CallToolRequestSchema, (r) =>
    callMcpTool(userId, r.params.name, r.params.arguments ?? {})
  );
  return server;
}

mcpRouter.post('/', async (req, res) => {
  const userId = await authenticate(req, res);
  if (!userId) return;

  const server = buildServer(userId);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    // express.json() already consumed the body, so hand it over explicitly.
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error({ module: 'mcp', userId, err }, 'MCP request failed');
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

/**
 * GET opens a server->client notification stream and DELETE ends a session.
 * A stateless, tools-only server needs neither, so both are refused — but the
 * 401 still comes first, so an unauthenticated probe gets the discovery hint
 * rather than a confusing 405.
 */
for (const method of ['get', 'delete'] as const) {
  mcpRouter[method]('/', async (req, res) => {
    const userId = await authenticate(req, res);
    if (!userId) return;
    res.status(405).set('Allow', 'POST').json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'This server is stateless; use POST.' },
      id: null,
    });
  });
}
