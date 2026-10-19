import crypto from 'crypto';
import { IJwtPayload, IRagQueryRequest } from '@enterprise-ai/shared-types';
import { RedisService } from '../redis.service.js';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';

export interface ICachedRagResult {
  answer: string;
  citations: any[];
  insufficientEvidence: boolean;
  retrievalMetadata: {
    totalCandidates: number;
    authorizedChunks: number;
    timingsMs?: {
      embedding?: number;
      retrieval?: number;
      generation?: number;
      total?: number;
    };
  };
  cachedAt: number;
  version: number;
}

export class RagCacheService {
  private static readonly GENERATION_KEY = 'rag:cache:generation';
  private static readonly CACHE_VERSION = 1;

  private static readonly INCR_GENERATION_LUA = `
    local current = redis.call('GET', KEYS[1])
    if not current or tonumber(current) < 1 then
      redis.call('SET', KEYS[1], '2')
      return 2
    else
      return redis.call('INCR', KEYS[1])
    end
  `;

  /**
   * Generates a deterministic, authorization-aware cache key.
   * Isolates results by:
   * - User identity (sub)
   * - Security clearance & department & role
   * - Generation version (instant invalidation counter)
   * - Normalized query text & retrieval parameters
   */
  public static async buildCacheKey(
    request: IRagQueryRequest,
    user: IJwtPayload,
    modelName: string,
    generation?: number
  ): Promise<string> {
    const gen = generation !== undefined ? generation : await this.getCurrentGeneration();

    const normalizedQuery = (request.query || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const topK = request.topK ?? env.RAG_TOP_K;
    const similarityThreshold = request.similarityThreshold ?? env.RAG_SIMILARITY_THRESHOLD;

    // Build authorization fingerprint containing principal credentials
    const fingerprint = [
      `u:${user.sub}`,
      `clr:${user.securityClearance}`,
      `dept:${user.department}`,
      `role:${user.role}`,
      `m:${modelName}`,
      `k:${topK}`,
      `th:${similarityThreshold}`,
      `q:${normalizedQuery}`,
    ].join('|');

    const hash = crypto.createHash('sha256').update(fingerprint).digest('hex');

    return `rag:cache:v${this.CACHE_VERSION}:gen:${gen}:${hash}`;
  }

  /**
   * Retrieves the current cache generation counter from Redis
   */
  public static async getCurrentGeneration(): Promise<number> {
    if (!env.RAG_CACHE_ENABLED) {
      return 1;
    }

    try {
      const genStr = await RedisService.executeWithTimeout((c) => c.get(this.GENERATION_KEY));
      if (!genStr) {
        return 1;
      }
      const gen = parseInt(genStr, 10);
      return Number.isFinite(gen) && gen > 0 ? gen : 1;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to retrieve cache generation from Redis, defaulting to 1', { error: errMsg });
      return 1;
    }
  }

  /**
   * Increments the cache generation counter atomically, invalidating all existing cached results
   */
  public static async invalidateAll(): Promise<void> {
    if (!env.RAG_CACHE_ENABLED) {
      return;
    }

    try {
      await RedisService.executeWithTimeout(async (client) => {
        await client.eval(this.INCR_GENERATION_LUA, 1, this.GENERATION_KEY);
      });
      logger.info('RAG response cache generation incremented (all entries invalidated)');
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to increment cache generation counter', { error: errMsg });
    }
  }

  /**
   * Attempts to get a validated cached response along with the generation counter when read.
   */
  public static async getWithGeneration(
    request: IRagQueryRequest,
    user: IJwtPayload,
    modelName: string
  ): Promise<{ cached: ICachedRagResult | null; generation: number }> {
    const defaultRes = { cached: null, generation: 1 };
    if (!env.RAG_CACHE_ENABLED) {
      return defaultRes;
    }

    try {
      const generation = await this.getCurrentGeneration();
      const key = await this.buildCacheKey(request, user, modelName, generation);
      const dataStr = await RedisService.executeWithTimeout((c) => c.get(key));

      if (!dataStr) {
        return { cached: null, generation };
      }

      let parsed: any;
      try {
        parsed = JSON.parse(dataStr);
      } catch {
        logger.warn('Corrupted JSON entry found in RAG cache, evicting key');
        await RedisService.executeWithTimeout((c) => c.del(key)).catch(() => {});
        return { cached: null, generation };
      }

      // Schema verification of cached payload
      if (
        !parsed ||
        typeof parsed.answer !== 'string' ||
        !Array.isArray(parsed.citations) ||
        parsed.version !== this.CACHE_VERSION
      ) {
        logger.warn('Incompatible schema in cached RAG entry, removing stale entry');
        await RedisService.executeWithTimeout((c) => c.del(key)).catch(() => {});
        return { cached: null, generation };
      }

      return { cached: parsed as ICachedRagResult, generation };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn('Cache read failure, proceeding to uncached authorized retrieval', { error: errMsg });
      return defaultRes;
    }
  }

  /**
   * Attempts to get a validated cached response. Returns null on miss, failure, or schema invalidity.
   */
  public static async get(
    request: IRagQueryRequest,
    user: IJwtPayload,
    modelName: string
  ): Promise<ICachedRagResult | null> {
    const res = await this.getWithGeneration(request, user, modelName);
    return res.cached;
  }

  /**
   * Caches a successful, validated RAG response with in-flight race condition protection
   */
  public static async set(
    request: IRagQueryRequest,
    user: IJwtPayload,
    modelName: string,
    result: {
      answer: string;
      citations: any[];
      insufficientEvidence?: boolean;
      retrievalMetadata?: any;
    },
    expectedGeneration?: number
  ): Promise<void> {
    if (!env.RAG_CACHE_ENABLED) {
      return;
    }

    // Do not cache insufficient-evidence responses
    if (result.insufficientEvidence) {
      return;
    }

    try {
      // In-flight race protection: Verify that generation has not changed since retrieval began
      const currentGen = await this.getCurrentGeneration();
      if (expectedGeneration !== undefined && currentGen !== expectedGeneration) {
        logger.warn('Cache generation changed during in-flight RAG query; discarding stale cache write', {
          expectedGeneration,
          currentGen,
        });
        return;
      }

      const key = await this.buildCacheKey(request, user, modelName, expectedGeneration ?? currentGen);
      const payload: ICachedRagResult = {
        answer: result.answer,
        citations: result.citations,
        insufficientEvidence: false,
        retrievalMetadata: result.retrievalMetadata ?? { totalCandidates: 0, authorizedChunks: 0 },
        cachedAt: Date.now(),
        version: this.CACHE_VERSION,
      };

      const serialized = JSON.stringify(payload);
      const payloadBytes = Buffer.byteLength(serialized, 'utf8');

      // Maximum cache payload size enforcement
      if (payloadBytes > env.RAG_CACHE_MAX_PAYLOAD_BYTES) {
        logger.warn('RAG cache payload size exceeds configured maximum, skipping cache write', {
          payloadBytes,
          maxAllowed: env.RAG_CACHE_MAX_PAYLOAD_BYTES,
        });
        return;
      }

      await RedisService.executeWithTimeout(async (client) => {
        await client.set(key, serialized, 'EX', env.RAG_CACHE_TTL_SECONDS);
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to store response in RAG cache', { error: errMsg });
    }
  }
}
