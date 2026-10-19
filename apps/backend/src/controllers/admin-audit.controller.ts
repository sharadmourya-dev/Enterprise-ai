import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AuditService } from '../services/audit.service.js';
import { AuditLogModel } from '../models/AuditLog.model.js';
import { AuditAction, AuditResourceType } from '@enterprise-ai/shared-types';
import { BadRequestError } from '../utils/errors.js';

const listAuditLogsSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
  action: z.nativeEnum(AuditAction).optional(),
  resourceType: z.nativeEnum(AuditResourceType).optional(),
  status: z.enum(['success', 'denied', 'error']).optional(),
  userId: z.string().optional(),
  startDate: z
    .string()
    .optional()
    .refine((val) => !val || !Number.isNaN(Date.parse(val)), {
      message: 'Invalid startDate format',
    }),
  endDate: z
    .string()
    .optional()
    .refine((val) => !val || !Number.isNaN(Date.parse(val)), {
      message: 'Invalid endDate format',
    }),
});

export class AdminAuditController {
  /**
   * Cryptographically verifies the audit log hash chain and sequence continuity
   */
  public static async verifyAuditChain(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const verification = await AuditService.verifyChain();
      res.status(200).json({
        success: true,
        data: {
          isValid: verification.isValid,
          totalVerified: verification.totalVerified,
          error: verification.error || null,
          atSequence: verification.atSequence || null,
          details: verification.details || null,
          verifiedAt: new Date().toISOString(),
          processIsolationNotice:
            'Audit chain sequence writes are synchronized via atomic MongoDB counter and process-local promise queue. Multi-instance clusters require distributed coordination (e.g. distributed locks or sequencer).',
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Lists audit logs with bounded pagination and sanitized filters
   */
  public static async listAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parseResult = listAuditLogsSchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new BadRequestError(parseResult.error.errors[0]?.message || 'Invalid audit log query filters');
      }

      const { page, limit, action, resourceType, status, userId, startDate, endDate } = parseResult.data;

      const query: Record<string, unknown> = {};

      if (action) query.action = action;
      if (resourceType) query.resourceType = resourceType;
      if (status) query.status = status;
      if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        query.userId = new mongoose.Types.ObjectId(userId);
      }

      if (startDate || endDate) {
        const dateFilter: Record<string, Date> = {};
        if (startDate) dateFilter.$gte = new Date(startDate);
        if (endDate) dateFilter.$lte = new Date(endDate);
        query.createdAt = dateFilter;
      }

      const skip = (page - 1) * limit;

      const [total, logs] = await Promise.all([
        AuditLogModel.countDocuments(query),
        AuditLogModel.find(query)
          .sort({ sequenceNumber: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
      ]);

      const formattedLogs = logs.map((log: any) => ({
        id: log._id.toString(),
        sequenceNumber: log.sequenceNumber,
        previousHash: log.previousHash,
        userId: log.userId ? log.userId.toString() : null,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        status: log.status,
        details: log.details || {},
        tamperHash: log.tamperHash,
        createdAt: log.createdAt.toISOString(),
      }));

      res.status(200).json({
        success: true,
        data: {
          logs: formattedLogs,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
}
