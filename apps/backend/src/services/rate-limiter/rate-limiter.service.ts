import crypto from 'crypto';
import { RedisService } from '../redis.service.js';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';

export interface IRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds?: number;
}

export class RateLimiterService {
  private static readonly SLIDING_WINDOW_LUA = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local windowMs = tonumber(ARGV[2])
    local maxRequests = tonumber(ARGV[3])
    local member = ARGV[4]

    redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)
    local currentCount = redis.call('ZCARD', key)

    if currentCount < maxRequests then
      redis.call('ZADD', key, now, member)
      redis.call('PEXPIRE', key, windowMs)
      local remaining = maxRequests - currentCount - 1
      return {1, remaining, math.ceil(windowMs / 1000)}
    else
      local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
      local resetMs = windowMs
      if oldest and oldest[2] then
        resetMs = math.max(0, (tonumber(oldest[2]) + windowMs) - now)
      end
      local resetSec = math.ceil(resetMs / 1000)
      if resetSec <= 0 then resetSec = 1 end
      return {0, 0, resetSec}
    end
  `;

  /**
   * Evaluates rate limiting atomically using a sliding window algorithm
   */
  public static async checkLimit(
    category: string,
    identifier: string,
    windowMs: number,
    maxRequests: number
  ): Promise<IRateLimitResult> {
    if (!env.RATE_LIMIT_ENABLED) {
      return {
        allowed: true,
        limit: maxRequests,
        remaining: maxRequests,
        resetSeconds: Math.ceil(windowMs / 1000),
      };
    }

    const hashedId = crypto.createHash('sha256').update(identifier).digest('hex').slice(0, 32);
    const key = `rl:${category}:${hashedId}`;
    const now = Date.now();
    const uniqueMember = `${now}:${crypto.randomBytes(4).toString('hex')}`;

    try {
      const res: any = await RedisService.executeWithTimeout(async (client) => {
        return client.eval(
          this.SLIDING_WINDOW_LUA,
          1,
          key,
          now.toString(),
          windowMs.toString(),
          maxRequests.toString(),
          uniqueMember
        );
      });

      const allowed = res[0] === 1;
      const remaining = Number(res[1]);
      const resetSeconds = Number(res[2]);

      return {
        allowed,
        limit: maxRequests,
        remaining,
        resetSeconds,
        retryAfterSeconds: allowed ? undefined : resetSeconds,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Redis error during rate limit verification', {
        category,
        error: errMsg,
      });

      // Fail-closed security policy in production for expensive or protected endpoints
      if (env.NODE_ENV === 'production') {
        throw new Error('RATE_LIMIT_BACKEND_UNAVAILABLE');
      }

      // Safe bypass in development/test mode
      return {
        allowed: true,
        limit: maxRequests,
        remaining: 1,
        resetSeconds: Math.ceil(windowMs / 1000),
      };
    }
  }
}
