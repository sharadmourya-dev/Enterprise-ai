import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';

let redisInstance: Redis | null = null;
let customRedisOverride: Redis | null = null;

export class RedisService {
  /**
   * Retrieves the shared singleton Redis client
   */
  public static getClient(): Redis {
    if (customRedisOverride) {
      return customRedisOverride;
    }

    if (!redisInstance) {
      redisInstance = new Redis({
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        password: env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null, // Compatible with BullMQ and standard atomic commands
        lazyConnect: true,
        connectTimeout: env.REDIS_OPERATION_TIMEOUT_MS,
      });

      redisInstance.on('error', (err) => {
        logger.error('Redis connection error', { error: err.message });
      });

      redisInstance.on('connect', () => {
        logger.info('Redis connection established');
      });
    }

    return redisInstance;
  }

  /**
   * Overrides the Redis client (used in tests for isolated in-memory doubles)
   */
  public static setClientOverride(override: Redis | null): void {
    customRedisOverride = override;
  }

  /**
   * Executes a Redis operation bounded by the configured operation timeout
   */
  public static async executeWithTimeout<T>(
    operation: (client: Redis) => Promise<T>,
    timeoutMs: number = env.REDIS_OPERATION_TIMEOUT_MS
  ): Promise<T> {
    const client = this.getClient();
    let timer: NodeJS.Timeout | null = null;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Redis operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      return await Promise.race([operation(client), timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Checks if Redis connection is active and responsive
   */
  public static async isHealthy(): Promise<boolean> {
    try {
      const res = await this.executeWithTimeout((c) => c.ping(), 1000);
      return res === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Safely closes the shared Redis connection
   */
  public static async closeConnection(): Promise<void> {
    if (redisInstance) {
      await redisInstance.quit();
      redisInstance = null;
    }
  }
}

export function getRedisConnection(): Redis {
  return RedisService.getClient();
}
