import { Request, Response, NextFunction } from 'express';
import { RateLimiterService } from '../services/rate-limiter/rate-limiter.service.js';
import { env } from '../config/env.js';

export interface IRateLimitMiddlewareOptions {
  category: string;
  windowMs?: number;
  maxRequests?: number;
  ipMaxRequests?: number;
}

/**
 * Safely derives the effective client IP from Express's trusted proxy configuration.
 * Delegates to Express's `req.ip` which resolves according to the configured `trust proxy` setting.
 * Never blindly trusts raw X-Forwarded-For headers from untrusted connections.
 */
export function getClientIp(req: Request): string {
  let ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';

  // Normalize IPv4-mapped IPv6 address (e.g. ::ffff:127.0.0.1 -> 127.0.0.1)
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  const cleanIp = ip.trim();
  // Ensure IP contains only valid IPv4 / IPv6 characters and is bounded in length (max IPv6 length is 45)
  if (/^[a-fA-F0-9:.]+$/.test(cleanIp) && cleanIp.length <= 45) {
    return cleanIp;
  }

  return '127.0.0.1';
}

export function createRateLimiter(options: IRateLimitMiddlewareOptions) {
  const windowMs = options.windowMs ?? env.RATE_LIMIT_WINDOW_MS;
  const maxRequests = options.maxRequests ?? env.RATE_LIMIT_MAX_REQUESTS;
  const ipMaxRequests = options.ipMaxRequests ?? (maxRequests * 5);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = (req as any).user;
    const clientIp = getClientIp(req);

    try {
      if (user?.sub) {
        // Authenticated dual-dimensional rate limiting:
        // 1. Independent user quota (immune to IP rotation)
        const userResult = await RateLimiterService.checkLimit(
          `${options.category}:user`,
          `user:${user.sub}`,
          windowMs,
          maxRequests
        );

        // 2. Independent IP quota (protects against multi-account spam from single IP)
        const ipResult = await RateLimiterService.checkLimit(
          `${options.category}:ip`,
          `ip:${clientIp}`,
          windowMs,
          ipMaxRequests
        );

        // Report most restrictive headers
        const minRemaining = Math.min(userResult.remaining, ipResult.remaining);
        const maxReset = Math.max(userResult.resetSeconds, ipResult.resetSeconds);
        res.setHeader('X-RateLimit-Limit', userResult.limit.toString());
        res.setHeader('X-RateLimit-Remaining', minRemaining.toString());
        res.setHeader('X-RateLimit-Reset', maxReset.toString());

        if (!userResult.allowed || !ipResult.allowed) {
          const retryAfter = Math.max(
            userResult.retryAfterSeconds || 0,
            ipResult.retryAfterSeconds || 0
          );
          if (retryAfter > 0) {
            res.setHeader('Retry-After', retryAfter.toString());
          }

          res.status(429).json({
            success: false,
            error: {
              code: 'TOO_MANY_REQUESTS',
              message: 'Rate limit exceeded. Please try again later.',
              retryAfter: retryAfter > 0 ? retryAfter : undefined,
            },
          });
          return;
        }
      } else {
        // Unauthenticated single IP dimension (bounded key allocation via getClientIp)
        const ipResult = await RateLimiterService.checkLimit(
          `${options.category}:ip`,
          `ip:${clientIp}`,
          windowMs,
          maxRequests
        );

        res.setHeader('X-RateLimit-Limit', ipResult.limit.toString());
        res.setHeader('X-RateLimit-Remaining', ipResult.remaining.toString());
        res.setHeader('X-RateLimit-Reset', ipResult.resetSeconds.toString());

        if (!ipResult.allowed) {
          if (ipResult.retryAfterSeconds) {
            res.setHeader('Retry-After', ipResult.retryAfterSeconds.toString());
          }

          res.status(429).json({
            success: false,
            error: {
              code: 'TOO_MANY_REQUESTS',
              message: 'Rate limit exceeded. Please try again later.',
              retryAfter: ipResult.retryAfterSeconds,
            },
          });
          return;
        }
      }

      next();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg === 'RATE_LIMIT_BACKEND_UNAVAILABLE') {
        res.status(503).json({
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Security verification service temporarily unavailable. Please retry shortly.',
          },
        });
        return;
      }

      // Unexpected error
      next(err);
    }
  };
}
