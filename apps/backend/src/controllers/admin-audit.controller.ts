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

const exportAuditLogsSchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
  limit: z.coerce.number().min(1).max(5000).default(1000),
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

/**
 * Constructs a sanitized Mongoose query filter from validated audit parameters
 */
function buildAuditQuery(filters: {
  action?: AuditAction;
  resourceType?: AuditResourceType;
  status?: 'success' | 'denied' | 'error';
  userId?: string;
  startDate?: string;
  endDate?: string;
}): Record<string, unknown> {
  const query: Record<string, unknown> = {};

  if (filters.action) query.action = filters.action;
  if (filters.resourceType) query.resourceType = filters.resourceType;
  if (filters.status) query.status = filters.status;
  if (filters.userId && mongoose.Types.ObjectId.isValid(filters.userId)) {
    query.userId = new mongoose.Types.ObjectId(filters.userId);
  }

  if (filters.startDate || filters.endDate) {
    const dateFilter: Record<string, Date> = {};
    if (filters.startDate) dateFilter.$gte = new Date(filters.startDate);
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.$lte = end;
    }
    query.createdAt = dateFilter;
  }

  return query;
}

/**
 * Sanitizes cell values to prevent CSV formula injection (OWASP CSV Injection defense)
 */
function sanitizeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  let str = typeof val === 'object' ? JSON.stringify(val) : String(val);

  // If cell starts with formula trigger characters (=, +, -, @, tab, CR), prepend apostrophe
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // Quote cell if it contains delimiter, quotes, or newlines
  if (/[",\n\r]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export class AdminAuditController {
  /**
   * Cryptographically verifies the audit log hash chain and sequence continuity
   */
  public static async verifyAuditChain(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const verification = await AuditService.verifyChain();

      // Log verification execution in audit trail
      await AuditService.log({
        userId: req.user?.sub,
        action: AuditAction.ADMIN_VERIFY_CHAIN,
        resourceType: AuditResourceType.SYSTEM,
        resourceId: 'audit_chain',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
        status: verification.isValid ? 'success' : 'error',
        details: {
          verificationStatus: verification.status,
          totalVerified: verification.totalVerified,
          invalidSignatureCount: verification.invalidSignatureCount,
          brokenPreviousHashCount: verification.brokenPreviousHashCount,
          sequenceGapCount: verification.sequenceGapCount,
          firstInvalidSequence: verification.firstInvalidSequence,
          atSequence: verification.atSequence,
        },
      });

      res.status(200).json({
        success: true,
        data: verification,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Aggregates summary statistics across total, success, denied/error, and security-critical events
   */
  public static async getAuditSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parseResult = listAuditLogsSchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new BadRequestError(parseResult.error.errors[0]?.message || 'Invalid audit log query filters');
      }

      const query = buildAuditQuery(parseResult.data);
      const summary = await AuditService.getSummary(query);

      res.status(200).json({
        success: true,
        data: summary,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Lists audit logs with bounded pagination, sanitized filters, and populated actor profile
   */
  public static async listAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parseResult = listAuditLogsSchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new BadRequestError(parseResult.error.errors[0]?.message || 'Invalid audit log query filters');
      }

      const { page, limit } = parseResult.data;
      const query = buildAuditQuery(parseResult.data);
      const skip = (page - 1) * limit;

      const [total, logs] = await Promise.all([
        AuditLogModel.countDocuments(query),
        AuditLogModel.find(query)
          .populate('userId', 'email name role department')
          .sort({ sequenceNumber: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
      ]);

      const formattedLogs = logs.map((log: any) => ({
        id: log._id.toString(),
        sequenceNumber: log.sequenceNumber,
        previousHash: log.previousHash,
        userId: log.userId ? (log.userId._id ? log.userId._id.toString() : log.userId.toString()) : null,
        actorEmail: log.userId?.email || null,
        actorName: log.userId?.name || null,
        actorRole: log.userId?.role || null,
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

  /**
   * Exports filtered audit records to CSV or JSON with formula injection protection
   */
  public static async exportAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parseResult = exportAuditLogsSchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new BadRequestError(parseResult.error.errors[0]?.message || 'Invalid export query parameters');
      }

      const { format, limit } = parseResult.data;
      const query = buildAuditQuery(parseResult.data);

      const logs = await AuditLogModel.find(query)
        .populate('userId', 'email name role department')
        .sort({ sequenceNumber: -1 })
        .limit(limit)
        .lean();

      // Record export in audit trail
      await AuditService.log({
        userId: req.user?.sub,
        action: AuditAction.ADMIN_EXPORT_LOGS,
        resourceType: AuditResourceType.SYSTEM,
        resourceId: 'audit_export',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
        status: 'success',
        details: {
          format,
          recordCount: logs.length,
          filters: parseResult.data,
        },
      });

      if (format === 'json') {
        const formattedLogs = logs.map((log: any) => ({
          sequenceNumber: log.sequenceNumber,
          previousHash: log.previousHash,
          userId: log.userId ? (log.userId._id ? log.userId._id.toString() : log.userId.toString()) : null,
          actorEmail: log.userId?.email || null,
          actorName: log.userId?.name || null,
          actorRole: log.userId?.role || null,
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

        res.setHeader('Content-Type', 'application/json');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="audit-logs-export-${new Date().toISOString().slice(0, 10)}.json"`
        );
        res.status(200).json(formattedLogs);
        return;
      }

      // Format CSV
      const headers = [
        'Sequence #',
        'Timestamp (UTC)',
        'Action',
        'Resource Type',
        'Resource ID',
        'Actor User ID',
        'Actor Email',
        'Actor Role',
        'IP Address',
        'User Agent',
        'Status',
        'Tamper Hash (HMAC)',
        'Previous Hash',
        'Details',
      ];

      const csvRows = [headers.join(',')];

      for (const log of logs as any[]) {
        const row = [
          sanitizeCsvCell(log.sequenceNumber),
          sanitizeCsvCell(log.createdAt.toISOString()),
          sanitizeCsvCell(log.action),
          sanitizeCsvCell(log.resourceType),
          sanitizeCsvCell(log.resourceId),
          sanitizeCsvCell(log.userId ? (log.userId._id ? log.userId._id.toString() : log.userId.toString()) : ''),
          sanitizeCsvCell(log.userId?.email || ''),
          sanitizeCsvCell(log.userId?.role || ''),
          sanitizeCsvCell(log.ipAddress || ''),
          sanitizeCsvCell(log.userAgent || ''),
          sanitizeCsvCell(log.status),
          sanitizeCsvCell(log.tamperHash),
          sanitizeCsvCell(log.previousHash),
          sanitizeCsvCell(log.details ? JSON.stringify(log.details) : ''),
        ];
        csvRows.push(row.join(','));
      }

      const csvContent = csvRows.join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="audit-logs-export-${new Date().toISOString().slice(0, 10)}.csv"`
      );
      res.status(200).send(csvContent);
    } catch (error) {
      next(error);
    }
  }
}
