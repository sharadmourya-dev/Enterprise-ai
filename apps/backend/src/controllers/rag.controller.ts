import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { RagService } from '../services/rag/rag.service.js';
import { BadRequestError, UnauthorizedError } from '../utils/errors.js';

const queryRequestSchema = z
  .object({
    query: z
      .string({ required_error: 'Query string is required' })
      .trim()
      .min(1, 'Query string cannot be empty')
      .max(1000, 'Query cannot exceed 1000 characters'),
    topK: z.number().int().min(1).max(20).optional(),
    similarityThreshold: z.number().min(0).max(1).optional(),
  })
  .strict(); // Rejects extra client-controlled fields (e.g. filters, collection, dimensions)

export class RagController {
  /**
   * POST /api/v1/rag/query
   * Executes secure, grounded question answering with ACL authorization and citation validation.
   */
  public static async query(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('User authentication required');
      }

      const parseResult = queryRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        const errorDetails = parseResult.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        throw new BadRequestError('Invalid query request parameters', 'BAD_REQUEST', errorDetails);
      }

      const validatedBody = parseResult.data;

      const clientContext = {
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'] as string | undefined,
        requestId: req.requestId || crypto.randomUUID(),
      };

      const result = await RagService.query(validatedBody, req.user, clientContext);

      res.status(200).json({
        success: true,
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: clientContext.requestId,
        },
      });
    } catch (err) {
      next(err);
    }
  }
}
