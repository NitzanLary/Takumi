/**
 * Chat Handler — SSE streaming with agentic tool execution loop.
 *
 * Flow:
 * 1. Receive user message
 * 2. Load/create conversation, build message history
 * 3. Build system prompt with live portfolio context
 * 4. Stream Claude response via SSE
 * 5. If Claude calls a tool, execute it and loop back
 * 6. Persist all messages to DB on completion
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Request, Response } from 'express';
import { config } from '../lib/config.js';
import { buildSystemPrompt } from './system-prompt.js';
import {
  getOrCreateConversation,
  saveMessages,
  type SavedMessage,
} from './conversation.service.js';

const MAX_TOOL_CALLS = 10;
const MAX_TOKENS = 4096;
const MODEL = 'claude-sonnet-4-20250514';

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return anthropicClient;
}

// Tool schemas and executors are injected from the tool registry
let toolSchemas: Anthropic.Messages.Tool[] = [];
let executeToolFn:
  | ((userId: string, name: string, input: Record<string, unknown>) => Promise<unknown>)
  | null = null;

export function registerTools(
  schemas: Anthropic.Messages.Tool[],
  executor: (userId: string, name: string, input: Record<string, unknown>) => Promise<unknown>
) {
  toolSchemas = schemas;
  executeToolFn = executor;
}

/**
 * Send an SSE event to the client.
 */
function sendSSE(res: Response, data: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Convert DB message history to Anthropic message format.
 * Keeps the last 20 messages in full; truncates older ones.
 */
function buildMessageHistory(
  dbMessages: SavedMessage[]
): Anthropic.Messages.MessageParam[] {
  const messages: Anthropic.Messages.MessageParam[] = [];

  // Keep last 40 raw messages (which could be ~20 user/assistant turns)
  const recent = dbMessages.slice(-40);

  for (const msg of recent) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      if (msg.toolCalls && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
        // Assistant message with tool use
        const content: Anthropic.Messages.ContentBlockParam[] = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.toolCalls) {
          content.push({
            type: 'tool_use',
            id: (tc as any).id || `tool_${Date.now()}`,
            name: (tc as any).name,
            input: (tc as any).input || {},
          });
        }
        messages.push({ role: 'assistant', content });
      } else {
        messages.push({ role: 'assistant', content: msg.content });
      }
    } else if (msg.role === 'tool') {
      // Tool result message
      const parsed = tryParseJson(msg.content);
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: (parsed as any)?.tool_use_id || `tool_${Date.now()}`,
            content: JSON.stringify((parsed as any)?.result ?? msg.content),
          },
        ],
      });
    }
  }

  return messages;
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/**
 * Main chat handler — streams Claude's response via SSE.
 */
export async function handleChatStream(
  req: Request,
  res: Response,
  userId: string,
  userMessage: string,
  conversationId?: string
) {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  try {
    const client = getClient();

    // Load or create conversation (scoped to user)
    const conversation = await getOrCreateConversation(userId, conversationId);
    const isFirstMessage = conversation.isNew || conversation.messages.length === 0;

    // Build system prompt and message history
    const [systemPrompt] = await Promise.all([buildSystemPrompt(userId)]);

    const historyMessages = buildMessageHistory(conversation.messages);
    historyMessages.push({ role: 'user', content: userMessage });

    // Track new messages to persist
    const newMessages: SavedMessage[] = [
      { role: 'user', content: userMessage },
    ];

    // Agentic loop
    let currentMessages = historyMessages;
    let toolCallCount = 0;

    while (toolCallCount < MAX_TOOL_CALLS) {
      // Call Claude with streaming
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: currentMessages,
        ...(toolSchemas.length > 0 ? { tools: toolSchemas } : {}),
      });

      let fullText = '';
      const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
      let currentToolId = '';
      let currentToolName = '';
      let currentToolInputJson = '';
      let stopReason: string | null = null;

      // Stream events
      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            currentToolId = event.content_block.id;
            currentToolName = event.content_block.name;
            currentToolInputJson = '';
            sendSSE(res, {
              type: 'tool_call',
              toolName: currentToolName,
              conversationId: conversation.id,
            });
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            fullText += event.delta.text;
            sendSSE(res, {
              type: 'text_delta',
              text: event.delta.text,
              conversationId: conversation.id,
            });
          } else if (event.delta.type === 'input_json_delta') {
            currentToolInputJson += event.delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          if (currentToolName) {
            let parsedInput: Record<string, unknown> = {};
            try {
              parsedInput = currentToolInputJson
                ? JSON.parse(currentToolInputJson)
                : {};
            } catch {
              // malformed input
            }
            toolCalls.push({
              id: currentToolId,
              name: currentToolName,
              input: parsedInput,
            });
            currentToolName = '';
            currentToolInputJson = '';
          }
        } else if (event.type === 'message_delta') {
          stopReason = (event.delta as any).stop_reason || null;
        }
      }

      // Save assistant message
      const assistantMessage: SavedMessage = {
        role: 'assistant',
        content: fullText,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
      newMessages.push(assistantMessage);

      // If no tool calls or stop reason is end_turn, we're done
      if (toolCalls.length === 0 || stopReason === 'end_turn') {
        break;
      }

      // Execute tools and continue the loop
      // Build the assistant content block for the next request
      const assistantContent: Anthropic.Messages.ContentBlockParam[] = [];
      if (fullText) {
        assistantContent.push({ type: 'text', text: fullText });
      }
      for (const tc of toolCalls) {
        assistantContent.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.input,
        });
      }
      currentMessages.push({ role: 'assistant', content: assistantContent });

      // Execute each tool and build tool result messages
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const tc of toolCalls) {
        toolCallCount++;
        let result: unknown;
        try {
          if (executeToolFn) {
            result = await executeToolFn(userId, tc.name, tc.input);
          } else {
            result = { error: 'No tool executor registered' };
          }
        } catch (err) {
          result = { error: `Tool execution failed: ${(err as Error).message}` };
        }

        const resultStr = JSON.stringify(result);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: resultStr,
        });

        // Save tool result message
        newMessages.push({
          role: 'tool',
          content: JSON.stringify({ tool_use_id: tc.id, name: tc.name, result }),
        });

        sendSSE(res, {
          type: 'tool_result',
          toolName: tc.name,
          toolResult: result,
          conversationId: conversation.id,
        });
      }

      // Add tool results to messages for next iteration
      currentMessages.push({ role: 'user', content: toolResults });
    }

    // Persist all new messages
    const title = isFirstMessage
      ? userMessage.slice(0, 60) + (userMessage.length > 60 ? '...' : '')
      : undefined;
    await saveMessages(conversation.id, newMessages, title);

    // Send done event
    sendSSE(res, {
      type: 'done',
      conversationId: conversation.id,
    });
  } catch (err) {
    const message =
      err instanceof Anthropic.APIError
        ? `Claude API error: ${err.message}`
        : `Chat error: ${(err as Error).message}`;

    sendSSE(res, { type: 'error', error: message });
  } finally {
    res.end();
  }
}
