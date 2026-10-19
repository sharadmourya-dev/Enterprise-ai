import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Role, ClearanceLevel } from '@enterprise-ai/shared-types';
import { DocumentService } from '../services/document.service.js';
import { BadRequestError, UnauthorizedError } from '../utils/errors.js';

const uploadSchema = z.object({
  title: z.string().optional(),
  minimumClearance: z.nativeEnum(ClearanceLevel).optional(),
  allowedRoles: z
    .union([z.nativeEnum(Role), z.array(z.nativeEnum(Role))])
    .optional()
    .transform((val) => (val ? (Array.isArray(val) ? val : [val]) : undefined)),
  allowedDepartments: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => (val ? (Array.isArray(val) ? val : [val]) : undefined)),
  allowedUserIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => (val ? (Array.isArray(val) ? val : [val]) : undefined)),
});

export class DocumentController {
  public static async upload(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('User authentication required');
      }

      if (!req.file) {
        throw new BadRequestError('No file uploaded. Please supply a file in the "file" form field.');
      }

      const parsedBody = uploadSchema.parse(req.body);

      const accessControl = {
        allowedRoles: parsedBody.allowedRoles,
        allowedDepartments: parsedBody.allowedDepartments,
        minimumClearance: parsedBody.minimumClearance,
        allowedUserIds: parsedBody.allowedUserIds,
      };

      const clientMeta = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      };

      const result = await DocumentService.uploadDocument(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        req.user,
        accessControl,
        parsedBody.title,
        clientMeta
      );

      res.status(202).json({
        success: true,
        message: 'Document uploaded and queued for processing',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('User authentication required');
      }

      const id = String(req.params.id);
      const document = await DocumentService.getDocumentById(id, req.user);

      res.status(200).json({
        success: true,
        data: document,
      });
    } catch (err) {
      next(err);
    }
  }

  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('User authentication required');
      }

      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const status = req.query.status as any;
      const department = req.query.department as string | undefined;

      const result = await DocumentService.listDocuments(req.user, {
        page,
        limit,
        status,
        department,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  public static async retry(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('User authentication required');
      }

      const id = String(req.params.id);
      const clientMeta = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      };

      const result = await DocumentService.retryDocument(id, req.user, clientMeta);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('User authentication required');
      }

      const id = String(req.params.id);
      const clientMeta = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      };

      await DocumentService.deleteDocument(id, req.user, clientMeta);

      res.status(200).json({
        success: true,
        message: 'Document and associated vectors deleted successfully',
      });
    } catch (err) {
      next(err);
    }
  }
}
