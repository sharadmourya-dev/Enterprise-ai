import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { IApiResponse } from '@enterprise-ai/shared-types';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const requestId = req.requestId || crypto.randomUUID();
  const timestamp = new Date().toISOString();

  if (err instanceof AppError) {
    const response: IApiResponse = {
      success: false,
      data: null,
      error: {
        code: err.errorCode,
        message: err.message,
        details: err.details,
      },
      meta: {
        timestamp,
        requestId,
      },
    };

    res.status(err.statusCode).json(response);
    return;
  }

  // Zod schema validation errors
  if (err.name === 'ZodError' || ('issues' in err && Array.isArray((err as any).issues))) {
    const zodIssues = (err as any).issues || (err as any).errors || [];
    const details = zodIssues.map((e: any) => ({
      field: e.path ? e.path.join('.') : undefined,
      message: e.message,
    }));

    const response: IApiResponse = {
      success: false,
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload',
        details,
      },
      meta: {
        timestamp,
        requestId,
      },
    };

    res.status(400).json(response);
    return;
  }

  // Unhandled / Internal Server Errors
  logger.error('Unhandled server error', { err, url: req.originalUrl, method: req.method });

  const response: IApiResponse = {
    success: false,
    data: null,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred',
    },
    meta: {
      timestamp,
      requestId,
    },
  };

  res.status(500).json(response);
}
