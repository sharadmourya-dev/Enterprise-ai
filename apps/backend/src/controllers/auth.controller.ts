import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { IApiResponse, IRegisterRequest, ILoginRequest, IRefreshTokenRequest } from '@enterprise-ai/shared-types';
import { AuthService } from '../services/auth.service.js';

export const registerSchema = z.object({
  email: z.string().email('Invalid email address').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters long').max(128),
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  department: z.string().min(2, 'Department must be specified').max(100),
}).strict(); // Strictly reject any unknown fields like 'role' or 'securityClearance'

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export class AuthController {
  public static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await AuthService.register(req.body as IRegisterRequest, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      const response: IApiResponse = {
        success: true,
        data: user,
        error: null,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId || crypto.randomUUID(),
        },
      };

      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AuthService.login(req.body as ILoginRequest, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

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

  public static async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body as IRefreshTokenRequest;
      const tokens = await AuthService.refreshTokens(refreshToken, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      const response: IApiResponse = {
        success: true,
        data: tokens,
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

  public static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.user) {
        await AuthService.logout(req.user.sub, req.user.sessionId, {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      const response: IApiResponse = {
        success: true,
        data: { message: 'Logged out successfully' },
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

  public static async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const profile = await AuthService.getProfile(req.user!.sub);

      const response: IApiResponse = {
        success: true,
        data: profile,
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
