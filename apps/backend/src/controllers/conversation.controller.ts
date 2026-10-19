import { Request, Response, NextFunction } from 'express';
import { ConversationService } from '../services/conversation/conversation.service.js';
import { SseStreamService } from '../services/sse/sse-stream.service.js';
import { BadRequestError } from '../utils/errors.js';
import { env } from '../config/env.js';

export class ConversationController {
  /**
   * POST /api/v1/conversations
   */
  public static async createConversation(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = (req as any).user;
      const conversation = await ConversationService.createConversation(user, req.body, {
        ip: req.ip,
        userAgent: req.headers['user-agent'] as string,
      });

      res.status(201).json({
        success: true,
        data: conversation,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/conversations
   */
  public static async listConversations(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = (req as any).user;
      const result = await ConversationService.getUserConversations(user, req.query as any);

      res.status(200).json({
        success: true,
        data: result.conversations,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/conversations/:conversationId
   */
  public static async getConversation(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = (req as any).user;
      const conversationId = req.params.conversationId as string;
      const conversation = await ConversationService.getConversationById(
        conversationId,
        user
      );

      res.status(200).json({
        success: true,
        data: ConversationService.formatConversation(conversation),
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/conversations/:conversationId
   */
  public static async deleteConversation(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = (req as any).user;
      const conversationId = req.params.conversationId as string;
      await ConversationService.deleteConversation(conversationId, user, {
        ip: req.ip,
        userAgent: req.headers['user-agent'] as string,
      });

      res.status(200).json({
        success: true,
        message: 'Conversation deleted successfully',
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/conversations/:conversationId/messages
   */
  public static async getMessages(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = (req as any).user;
      const conversationId = req.params.conversationId as string;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

      const result = await ConversationService.getMessages(
        conversationId,
        user,
        page,
        limit
      );

      res.status(200).json({
        success: true,
        data: result.messages,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/conversations/:conversationId/messages
   */
  public static async sendMessage(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = (req as any).user;
      const conversationId = req.params.conversationId as string;
      const content = req.body?.content;
      const idempotencyKey = req.body?.idempotencyKey;

      const result = await ConversationService.sendMessage(
        conversationId,
        user,
        content,
        idempotencyKey,
        {
          ip: req.ip,
          userAgent: req.headers['user-agent'] as string,
          requestId: (req as any).id,
        }
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/conversations/:conversationId/messages/stream
   */
  public static async streamMessage(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = (req as any).user;
      const content = req.body?.content?.trim();
      const idempotencyKey = req.body?.idempotencyKey;

      if (!content) {
        throw new BadRequestError('Message content cannot be empty');
      }

      if (content.length > env.CONVERSATION_MESSAGE_MAX_CHARS) {
        throw new BadRequestError(
          `Message content exceeds maximum allowed limit of ${env.CONVERSATION_MESSAGE_MAX_CHARS} characters`
        );
      }

      const conversationId = req.params.conversationId as string;
      // Verify conversation ownership before setting SSE headers or initiating stream
      const conversation = await ConversationService.getConversationById(
        conversationId,
        user
      );

      await SseStreamService.streamMessage(
        req,
        res,
        conversation,
        user,
        content,
        idempotencyKey
      );
    } catch (err) {
      next(err);
    }
  }
}
