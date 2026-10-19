import { Request, Response, NextFunction } from 'express';
import { Role } from '@enterprise-ai/shared-types';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';

/**
 * Restricts endpoint access to specific roles.
 */
export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('User authentication required');
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new ForbiddenError(
        `Access denied. Role '${req.user.role}' is not authorized for this action. Allowed: [${allowedRoles.join(', ')}]`,
        'INSUFFICIENT_ROLE_PERMISSIONS'
      );
    }

    next();
  };
}
