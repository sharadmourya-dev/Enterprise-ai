import { Request, Response, NextFunction } from 'express';
import { ClearanceLevel, CLEARANCE_RANK } from '@enterprise-ai/shared-types';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';

/**
 * Enforces hierarchical security clearance levels.
 * User clearance must be greater than or equal to minimumClearance.
 */
export function requireClearance(minimumClearance: ClearanceLevel) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('User authentication required');
    }

    const userRank = CLEARANCE_RANK[req.user.securityClearance] ?? -1;
    const requiredRank = CLEARANCE_RANK[minimumClearance] ?? 999;

    if (userRank < requiredRank) {
      throw new ForbiddenError(
        `Access denied. Security clearance '${req.user.securityClearance}' is insufficient. Required: '${minimumClearance}'.`,
        'INSUFFICIENT_SECURITY_CLEARANCE'
      );
    }

    next();
  };
}
