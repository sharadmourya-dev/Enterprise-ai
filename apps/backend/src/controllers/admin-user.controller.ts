import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Role, Permission, IApiResponse } from '@enterprise-ai/shared-types';
import { AdminUserService } from '../services/admin-user.service.js';
import { BadRequestError, UnauthorizedError } from '../utils/errors.js';

export const listUsersSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  role: z.nativeEnum(Role).optional(),
  department: z.string().optional(),
});

export const updatePermissionsSchema = z.object({
  permissions: z.array(z.nativeEnum(Permission)),
});

export const updateStatusSchema = z.object({
  isActive: z.boolean(),
});

export class AdminUserController {
  /**
   * Lists users with pagination and search
   */
  public static async listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parseResult = listUsersSchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new BadRequestError(parseResult.error.errors[0]?.message || 'Invalid query parameters');
      }

      const result = await AdminUserService.listUsers(parseResult.data);

      const response: IApiResponse = {
        success: true,
        data: result,
        error: null,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId || crypto.randomUUID(),
        },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Retrieves a single user by ID
   */
  public static async getUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const user = await AdminUserService.getUserById(id);

      const response: IApiResponse = {
        success: true,
        data: user,
        error: null,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId || crypto.randomUUID(),
        },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Updates explicitly assigned permissions for a target user
   */
  public static async updatePermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication is required');
      }

      const id = req.params.id as string;
      const parseResult = updatePermissionsSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new BadRequestError(parseResult.error.errors[0]?.message || 'Invalid permissions payload');
      }

      const updatedUser = await AdminUserService.updatePermissions(
        id,
        parseResult.data.permissions,
        req.user,
        {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        }
      );

      const response: IApiResponse = {
        success: true,
        data: updatedUser,
        error: null,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId || crypto.randomUUID(),
        },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Activates or deactivates an employee account
   */
  public static async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication is required');
      }

      const id = req.params.id as string;
      const parseResult = updateStatusSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new BadRequestError(parseResult.error.errors[0]?.message || 'Invalid status payload');
      }

      const updatedUser = await AdminUserService.updateStatus(
        id,
        parseResult.data.isActive,
        req.user,
        {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        }
      );

      const response: IApiResponse = {
        success: true,
        data: updatedUser,
        error: null,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId || crypto.randomUUID(),
        },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
}
