import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import {
  AuditAction,
  AuditResourceType,
  ISearchResponse,
  ISearchResultItem,
} from '@enterprise-ai/shared-types';
import { RagService } from '../services/rag/rag.service.js';
import { RetrievalService } from '../services/retrieval.service.js';
import { AuditService } from '../services/audit.service.js';
import { BadRequestError, UnauthorizedError } from '../utils/errors.js';
import logger from '../utils/logger.js';

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

  /**
   * POST /api/v1/search (and POST /api/v1/rag/search)
   * Executes secure vector retrieval and candidate validation without LLM answer synthesis.
   * Preserves all server-side ACL, security clearance, and active revision checks.
   * Strips internal ACL metadata and internal IDs before returning sanitized candidates.
   */
  public static async search(req: Request, res: Response, next: NextFunction): Promise<void> {
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
        throw new BadRequestError('Invalid search request parameters', 'BAD_REQUEST', errorDetails);
      }

      const validatedBody = parseResult.data;

      const clientContext = {
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'] as string | undefined,
        requestId: req.requestId || crypto.randomUUID(),
      };

      const searchRes = await RetrievalService.search(
        validatedBody.query,
        req.user,
        {
          topK: validatedBody.topK,
          similarityThreshold: validatedBody.similarityThreshold,
        }
      );

      // Sanitize candidates: return authorized content snippets, metadata, and score/rank.
      // Do NOT expose internal vectorId, private ACLs (minimumClearanceLevel, allowedRoles, allowedDepartments, allowedUserIds), or internal flags.
      const sanitizedResults: ISearchResultItem[] = searchRes.candidates.map((c, index) => ({
        chunkId: c.chunkId,
        documentId: c.documentId,
        revision: c.revision,
        title: c.title,
        content: c.content,
        pageNumber: c.pageNumber,
        sectionHeader: c.sectionHeader,
        score: c.score,
        rank: index + 1,
      }));

      // Safe audit logging (non-blocking)
      try {
        await AuditService.log({
          userId: req.user.sub,
          action: AuditAction.RAG_QUERY,
          resourceType: AuditResourceType.SYSTEM,
          resourceId: 'search_alias',
          ipAddress: clientContext.ipAddress || '127.0.0.1',
          userAgent: clientContext.userAgent || 'internal',
          status: 'success',
          details: {
            query: validatedBody.query.slice(0, 500),
            resultsCount: sanitizedResults.length,
            timingsMs: searchRes.timings,
          },
        });
      } catch (logErr) {
        logger.warn('Failed to record search audit event', { error: logErr });
      }

      const responseData: ISearchResponse = {
        query: validatedBody.query,
        results: sanitizedResults,
        total: sanitizedResults.length,
        timings: searchRes.timings,
      };

      res.status(200).json({
        success: true,
        data: responseData,
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
