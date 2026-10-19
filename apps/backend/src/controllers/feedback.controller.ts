import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { FeedbackService } from '../services/feedback/feedback.service.js';
import { FeedbackRating, FeedbackCategory } from '@enterprise-ai/shared-types';
import { BadRequestError, UnauthorizedError, NotFoundError } from '../utils/errors.js';

const feedbackSchema = z.object({
  conversationId: z.string().min(1, 'conversationId is required'),
  messageId: z.string().min(1, 'messageId is required'),
  rating: z.nativeEnum(FeedbackRating, {
    errorMap: () => ({ message: "rating must be either 'thumbs_up' or 'thumbs_down'" }),
  }),
  category: z.nativeEnum(FeedbackCategory).optional(),
  userComment: z
    .string()
    .max(1000, 'Comment cannot exceed 1000 characters')
    .optional(),
});

export class FeedbackController {
  public static async submitFeedback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as any).user;
      if (!user?.sub) {
        throw new UnauthorizedError('Authentication required');
      }

      const parseResult = feedbackSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new BadRequestError(parseResult.error.errors[0]?.message || 'Invalid feedback payload');
      }

      const result = await FeedbackService.submitFeedback(user, parseResult.data, {
        ip: req.ip,
        userAgent: req.headers['user-agent'] as string,
      });

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async getFeedbackByMessageId(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as any).user;
      if (!user?.sub) {
        throw new UnauthorizedError('Authentication required');
      }

      const messageId = String(req.params.messageId);
      const feedback = await FeedbackService.getFeedbackForMessage(user, messageId);

      if (!feedback) {
        throw new NotFoundError('Feedback not found for this message');
      }

      res.status(200).json({
        success: true,
        data: feedback,
      });
    } catch (error) {
      next(error);
    }
  }
}
