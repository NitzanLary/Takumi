/**
 * Local stdio MCP server — exposes Takumi's read-only tools to any local MCP
 * client (Claude Code, MCP Inspector) with no auth plumbing at all.
 *
 * This is the validation step before the remote connector: it exercises the
 * real tool surface, descriptions, and result sizes, while the user is simply
 * pinned at startup via `MCP_USER_ID` (or `AUTH_DEV_BYPASS_USER_ID`). The
 * remote server will resolve that same `userId` per request from an OAuth
 * access token instead; everything below the transport is shared.
 *
 * Run: `MCP_USER_ID=<id> pnpm --silent --filter @takumi/api mcp`
 * `--silent` matters — pnpm's default banner goes to stdout, which is the
 * JSON-RPC transport. MCP clients are better pointed at `tsx` directly.
 */

// The low-level `Server` rather than `McpServer`: our tool definitions are
// already JSON Schema (they are Anthropic tool schemas), and `registerTool`
// accepts only Zod. `setRequestHandler` passes them through untouched.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// stdout is the JSON-RPC transport here, so pino must be pushed to stderr.
// Set before the dynamic imports below: static imports are hoisted and would
// initialise `lib/logger.ts` before this line ever runs.
process.env.LOG_TO_STDERR = '1';

const { config } = await import('../lib/config.js');
const { prisma } = await import('../lib/db.js');
const { mcpTools, callMcpTool, INSTRUCTIONS } = await import('./tools.js');

function fail(message: string): never {
  process.stderr.write(`takumi-mcp: ${message}\n`);
  process.exit(1);
}

const userId = process.env.MCP_USER_ID || config.authDevBypassUserId;
if (!userId) {
  fail('set MCP_USER_ID to the id of the user whose portfolio to expose');
}

const user = await prisma.user.findUnique({
  where: { id: userId },
  select: { email: true },
});
if (!user) {
  fail(`no user with id "${userId}"`);
}

const server = new Server(
  { name: 'takumi', version: '0.1.0' },
  { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
);

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: mcpTools }));
server.setRequestHandler(CallToolRequestSchema, (req) =>
  callMcpTool(userId, req.params.name, req.params.arguments ?? {})
);

await server.connect(new StdioServerTransport());
process.stderr.write(
  `takumi-mcp: ready — ${mcpTools.length} read-only tools for ${user.email}\n`
);
