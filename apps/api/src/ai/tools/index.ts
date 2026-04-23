/**
 * Tool Registry — combines all tool schemas and executors into a single registry.
 * Imported by chat-handler.ts to register tools with the Claude API.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { coreToolSchemas, coreToolExecutors, type ToolExecutor } from './core-tools.js';
import { tier1ToolSchemas, tier1ToolExecutors } from './tier1-tools.js';
import { tier2ToolSchemas, tier2ToolExecutors } from './tier2-tools.js';

// All tool schemas for the Claude API
export const allToolSchemas: Anthropic.Messages.Tool[] = [
  ...coreToolSchemas,
  ...tier1ToolSchemas,
  ...tier2ToolSchemas,
];

// Combined executor map
const allExecutors: Map<string, ToolExecutor> = new Map([
  ...coreToolExecutors,
  ...tier1ToolExecutors,
  ...tier2ToolExecutors,
]);

/**
 * Execute a tool by name with the given input, scoped to a userId.
 */
export async function executeTool(
  userId: string,
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const executor = allExecutors.get(name);
  if (!executor) {
    return { error: `Unknown tool: ${name}` };
  }
  return executor(userId, input);
}

export { type ToolExecutor };
