/**
 * Chat Routes — AI agent conversation endpoints.
 *
 * POST /api/chat              — Send message, receive SSE stream
 * GET  /api/chat/conversations — List all conversations
 * GET  /api/chat/conversations/:id — Get conversation with messages
 * DELETE /api/chat/conversations/:id — Delete conversation
 */

import { Router } from 'express';
import { handleChatStream } from '../ai/chat-handler.js';
import {
  listConversations,
  getConversation,
  deleteConversation,
} from '../ai/conversation.service.js';
import type { AiChatRequest } from '@takumi/types';

const router = Router();

/**
 * POST /api/chat — Send a message and stream the response via SSE.
 */
router.post('/', async (req, res) => {
  const { message, conversationId } = req.body as AiChatRequest;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  await handleChatStream(req, res, req.user!.id, message.trim(), conversationId);
});

/**
 * GET /api/chat/conversations — List all conversations for the current user.
 */
router.get('/conversations', async (req, res) => {
  const conversations = await listConversations(req.user!.id);
  res.json(conversations);
});

/**
 * GET /api/chat/conversations/:id — Get a single conversation with messages.
 */
router.get('/conversations/:id', async (req, res) => {
  const conversation = await getConversation(req.user!.id, req.params.id);
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }
  res.json(conversation);
});

/**
 * DELETE /api/chat/conversations/:id — Delete a conversation.
 */
router.delete('/conversations/:id', async (req, res) => {
  const deleted = await deleteConversation(req.user!.id, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }
  res.json({ success: true });
});

export default router;
