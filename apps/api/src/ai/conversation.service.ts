/**
 * Conversation Service — CRUD for AI conversations and messages.
 * All operations are scoped to a userId — conversations belong to one user.
 */

import { prisma } from '../lib/db.js';

export interface SavedMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: unknown[];
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/**
 * Get an existing conversation (verifying ownership) or create a new one for the user.
 */
export async function getOrCreateConversation(userId: string, id?: string) {
  if (id) {
    const conversation = await prisma.aiConversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (conversation && conversation.userId === userId) {
      return {
        id: conversation.id,
        isNew: false,
        messages: conversation.messages.map((m) => ({
          role: m.role as 'user' | 'assistant' | 'tool',
          content: m.content,
          toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
        })),
      };
    }
  }

  // Create new conversation
  const conversation = await prisma.aiConversation.create({
    data: { userId },
  });

  return { id: conversation.id, isNew: true, messages: [] as SavedMessage[] };
}

/**
 * Save messages to a conversation. Also sets the title if it's the first message.
 * Conversation ownership is enforced by the caller via getOrCreateConversation.
 */
export async function saveMessages(
  conversationId: string,
  messages: SavedMessage[],
  setTitle?: string
) {
  const ops = messages.map((m) =>
    prisma.aiMessage.create({
      data: {
        conversationId,
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls ? JSON.stringify(m.toolCalls) : null,
      },
    })
  );

  if (setTitle) {
    ops.push(
      prisma.aiConversation.update({
        where: { id: conversationId },
        data: { title: setTitle },
      }) as any
    );
  }

  await prisma.$transaction(ops);
}

/**
 * List all conversations for a user, newest first.
 */
export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const conversations = await prisma.aiConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { messages: true } },
    },
  });

  return conversations.map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    messageCount: c._count.messages,
  }));
}

/**
 * Get a single conversation with all messages — only if it belongs to the user.
 */
export async function getConversation(userId: string, id: string) {
  const conversation = await prisma.aiConversation.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!conversation || conversation.userId !== userId) return null;

  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    messages: conversation.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : null,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

/**
 * Delete a conversation (only if it belongs to the user) and all its messages.
 */
export async function deleteConversation(userId: string, id: string): Promise<boolean> {
  // Use deleteMany with both userId and id filters so deletion is atomic and
  // a user can't delete another user's conversation by guessing the id.
  const result = await prisma.aiConversation.deleteMany({
    where: { id, userId },
  });
  return result.count > 0;
}
