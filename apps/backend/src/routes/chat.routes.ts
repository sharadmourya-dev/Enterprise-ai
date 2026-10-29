import { Router } from 'express';
import { RagController } from '../controllers/rag.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { createRateLimiter } from '../middlewares/rate-limit.middleware.js';
import { env } from '../config/env.js';

const router = Router();

// POST /api/v1/chat - Backward-compatible single-turn RAG chat alias
router.post(
  '/',
  authenticate,
  createRateLimiter({
    category: 'chat',
    windowMs: env.RATE_LIMIT_CHAT_WINDOW_MS,
    maxRequests: env.RATE_LIMIT_CHAT_MAX_REQUESTS,
  }),
  RagController.query
);

export default router;
