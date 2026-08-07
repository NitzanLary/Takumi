/**
 * MCP tool adapter — re-shapes the existing agent tool registry
 * (`ai/tools/index.ts`) into Model Context Protocol tool definitions.
 *
 * Deliberately transport-agnostic: the local stdio server and the eventual
 * remote (OAuth) connector both consume this module, so the exposed surface,
 * the serialisation rules, and the usage instructions stay identical between
 * them. The only thing a transport supplies is the `userId`.
 */

import { Ajv, type ValidateFunction } from 'ajv';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { allToolSchemas, executeTool } from '../ai/tools/index.js';
import { logger } from '../lib/logger.js';

/**
 * Write-action tools, withheld from MCP for now. Anthropic advises disabling
 * write tools when a connector is used with Research, and `trigger_sync` is a
 * long-running job that would sit past the proxy timeout anyway. Read-only
 * also lets every tool be annotated `readOnlyHint`, which keeps the connector
 * out of confirmation prompts.
 */
const WRITE_TOOLS = new Set(['create_alert', 'delete_alert', 'trigger_sync']);

/** claude.ai and Claude Desktop cut tool results off at ~150k characters. */
const MAX_RESULT_CHARS = 150_000;

/**
 * Server-level usage notes, surfaced to the client at initialize.
 *
 * In-app, `ai/system-prompt.ts` supplies this framing alongside the tools. A
 * connector gets tools and nothing else, so the invariants that make the
 * numbers mean what they say have to travel with the server itself.
 */
export const INSTRUCTIONS = `Takumi exposes one investor's IBI brokerage portfolio — Israeli (TASE) and US equities. All tools are read-only.

Interpreting results:
- ILS is the home currency. Use the \`*Ils\` fields (marketValueIls, totalCostIls, unrealizedPnlIls) for EVERY cross-position total, weight, or comparison. Summing the native \`marketValue\` across ILS and USD holdings inflates TASE weights by roughly 3.7x. Native per-row values are for display only.
- Never combine currencies into a single figure. Realized P&L is reported per-currency (\`pnlByCurrency\`) — report it that way.
- TASE securities are keyed by IBI paper number rather than a ticker symbol, and their names are in Hebrew (right-to-left). US securities use standard symbols. A US ticker may have been renamed (FB -> META); \`priorNames\` records that.
- Prices are already normalised to ILS or USD. TASE agorot conversion happens at import time — do not divide again.
- Only BUY and SELL rows count as trades. Dividends, fees, taxes, transfers and FX conversions are separate transaction types and are excluded unless a tool documents otherwise.
- Data is only as fresh as the investor's last XLSX import. Call get_sync_status before making claims about "current" state.`;

/** The MCP-facing tool list, derived from the Anthropic tool schemas. */
export const mcpTools: Tool[] = allToolSchemas
  .filter((t) => !WRITE_TOOLS.has(t.name))
  .map((t) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: t.input_schema as Tool['inputSchema'],
    annotations: { readOnlyHint: true },
  }));

const exposed = new Set(mcpTools.map((t) => t.name));

/**
 * Neither the MCP `Server` nor the Anthropic tool loop validates arguments
 * against `inputSchema`, and the executors assume well-formed input. Unchecked,
 * a missing required field surfaces a raw `PrismaClientValidationError`, and an
 * out-of-enum value is worse: `get_pnl_breakdown {groupBy:"nonsense"}` silently
 * falls through to the default grouping and returns confidently wrong data.
 *
 * `coerceTypes` is on because MCP clients routinely send numbers as strings.
 */
const ajv = new Ajv({ allErrors: true, coerceTypes: true, useDefaults: true });
const validators = new Map<string, ValidateFunction>(
  mcpTools.map((t) => [t.name, ajv.compile(t.inputSchema)])
);

/**
 * Prisma hands back BigInt (`market_prices.volume`) and Decimal values.
 * Decimal defines `toJSON`, but BigInt makes `JSON.stringify` throw.
 */
function jsonSafe(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function serialize(result: unknown): string {
  const text = JSON.stringify(result, jsonSafe) ?? 'null';
  if (text.length <= MAX_RESULT_CHARS) return text;

  // Truncating leaves invalid JSON, which is the point: better a loud, legible
  // failure than a result the client silently clips mid-object.
  return `${text.slice(0, MAX_RESULT_CHARS)}

[TRUNCATED — result was ${text.length} characters, limit ${MAX_RESULT_CHARS}. The JSON above is incomplete. Re-run with a narrower query: a smaller \`limit\`, a date range, or a single ticker.]`;
}

/**
 * Execute a tool on behalf of `userId` and wrap the result as MCP content.
 * Errors come back as `isError` results rather than exceptions so the model
 * can see what failed and retry.
 */
export async function callMcpTool(
  userId: string,
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  if (!exposed.has(name)) {
    const reason = WRITE_TOOLS.has(name)
      ? `Tool "${name}" is a write action and is not exposed over MCP.`
      : `Unknown tool: ${name}`;
    return { content: [{ type: 'text', text: reason }], isError: true };
  }

  // Validated in place: ajv's coerceTypes/useDefaults mutate `args`.
  const validate = validators.get(name)!;
  if (!validate(args)) {
    const detail = (validate.errors ?? [])
      .map((e) => `\`${e.instancePath || '(root)'}\` ${e.message}${
        e.params && 'allowedValues' in e.params
          ? ` (allowed: ${(e.params.allowedValues as unknown[]).join(', ')})`
          : ''
      }`)
      .join('; ');
    return {
      content: [{ type: 'text', text: `Invalid arguments for ${name}: ${detail}` }],
      isError: true,
    };
  }

  try {
    const result = await executeTool(userId, name, args);
    return { content: [{ type: 'text', text: serialize(result) }] };
  } catch (err) {
    logger.error({ module: 'mcp', userId, tool: name, err }, 'MCP tool execution failed');
    return {
      content: [{ type: 'text', text: `Tool execution failed: ${(err as Error).message}` }],
      isError: true,
    };
  }
}
