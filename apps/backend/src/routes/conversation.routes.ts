import { Router } from 'express';
import { ConversationController } from '../controllers/conversation.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { createRateLimiter } from '../middlewares/rate-limit.middleware.js';
import { env } from '../config/env.js';

const router = Router();

// Enforce authentication across all conversation endpoints
router.use(authenticate);

// POST /api/v1/conversations - Create a new conversation
router.post(
  '/',
  createRateLimiter({
    category: 'conversation_create',
    maxRequests: env.RATE_LIMIT_CONVERSATION_MAX_REQUESTS,
  }),
  ConversationController.createConversation
);

// GET /api/v1/conversations - List authenticated user's conversations
router.get(
  '/',
  createRateLimiter({
    category: 'conversation_list',
    maxRequests: env.RATE_LIMIT_HISTORY_MAX_REQUESTS,
  }),
  ConversationController.listConversations
);

// GET /api/v1/conversations/:conversationId - Get conversation metadata
router.get(
  '/:conversationId',
  createRateLimiter({
    category: 'conversation_read',
    maxRequests: env.RATE_LIMIT_HISTORY_MAX_REQUESTS,
  }),
  ConversationController.getConversation
);

// DELETE /api/v1/conversations/:conversationId - Soft-delete conversation
router.delete(
  '/:conversationId',
  createRateLimiter({
    category: 'conversation_delete',
    maxRequests: env.RATE_LIMIT_CONVERSATION_MAX_REQUESTS,
  }),
  ConversationController.deleteConversation
);

// GET /api/v1/conversations/:conversationId/messages - Get paginated message history
router.get(
  '/:conversationId/messages',
  createRateLimiter({
    category: 'history',
    maxRequests: env.RATE_LIMIT_HISTORY_MAX_REQUESTS,
  }),
  ConversationController.getMessages
);

// POST /api/v1/conversations/:conversationId/messages - Submit synchronous message
router.post(
  '/:conversationId/messages',
  createRateLimiter({
    category: 'chat',
    windowMs: env.RATE_LIMIT_CHAT_WINDOW_MS,
    maxRequests: env.RATE_LIMIT_CHAT_MAX_REQUESTS,
  }),
  ConversationController.sendMessage
);

// POST /api/v1/conversations/:conversationId/messages/stream - Server-Sent Events stream
router.post(
  '/:conversationId/messages/stream',
  createRateLimiter({
    category: 'chat',
    windowMs: env.RATE_LIMIT_CHAT_WINDOW_MS,
    maxRequests: env.RATE_LIMIT_CHAT_MAX_REQUESTS,
  }),
  ConversationController.streamMessage
);

export default router;
