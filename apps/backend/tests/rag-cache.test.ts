import mongoose from 'mongoose';
import { RagCacheService } from '../src/services/cache/rag-cache.service.js';
import { RagService } from '../src/services/rag/rag.service.js';
import { RetrievalService } from '../src/services/retrieval.service.js';
import { RedisService } from '../src/services/redis.service.js';
import { createMockRedis } from './helpers/mock-redis.js';
import { QueryLogModel } from '../src/models/QueryLog.model.js';
import { env } from '../src/config/env.js';
import {
  IJwtPayload,
  Role,
  ClearanceLevel,
  IRetrievalCandidate,
} from '@enterprise-ai/shared-types';

describe('Phase 5 — Authorization-Aware Redis Response Caching (Part E & I4)', () => {
  const mockRedis = createMockRedis();

  beforeAll(() => {
    RedisService.setClientOverride(mockRedis as any);
  });

  afterAll(() => {
    RedisService.setClientOverride(null);
  });

  beforeEach(async () => {
    mockRedis.clear();
    await QueryLogModel.deleteMany({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createTestUser(
    sub: string,
    role = Role.USER,
    clearance = ClearanceLevel.INTERNAL,
    department = 'Engineering'
  ): IJwtPayload {
    return {
      sub,
      email: `${sub}@enterprise.com`,
      role,
      department,
      securityClearance: clearance,
      sessionId: `sess_${sub}`,
    };
  }

  const userA = createTestUser('671350a12f3e8b0012345701', Role.USER, ClearanceLevel.INTERNAL, 'Engineering');
  const userB = createTestUser('671350a12f3e8b0012345702', Role.USER, ClearanceLevel.INTERNAL, 'Engineering');
  const userConfidential = createTestUser('671350a12f3e8b0012345703', Role.USER, ClearanceLevel.CONFIDENTIAL, 'Engineering');

  describe('E2 & I4. Cache Key Determinism & Authorization Isolation', () => {
    it('1. Generates deterministic cache keys for identical user and query parameters', async () => {
      const key1 = await RagCacheService.buildCacheKey({ query: 'vacation policy' }, userA, 'gemini-3.8-flash');
      const key2 = await RagCacheService.buildCacheKey({ query: '   vacation   policy  ' }, userA, 'gemini-3.8-flash');

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^rag:cache:v1:gen:1:[a-f0-9]{64}$/);
    });

    it('2. Different users have strictly isolated cache keys (prevents cross-user response leakage)', async () => {
      const keyUserA = await RagCacheService.buildCacheKey({ query: 'vacation policy' }, userA, 'gemini-3.8-flash');
      const keyUserB = await RagCacheService.buildCacheKey({ query: 'vacation policy' }, userB, 'gemini-3.8-flash');

      expect(keyUserA).not.toBe(keyUserB);
    });

    it('3. Different security clearance levels produce isolated cache keys', async () => {
      const keyInternal = await RagCacheService.buildCacheKey({ query: 'policy' }, userA, 'gemini-3.8-flash');
      const keyConfidential = await RagCacheService.buildCacheKey({ query: 'policy' }, userConfidential, 'gemini-3.8-flash');

      expect(keyInternal).not.toBe(keyConfidential);
    });
  });

  describe('E3, E4 & I4. Cache Hits, Misses & Invalidation', () => {
    it('4. Repeated eligible request returns cache hit without calling vector retrieval again', async () => {
      const chunkId = new mongoose.Types.ObjectId().toString();
      const docId = new mongoose.Types.ObjectId().toString();

      const searchSpy = jest.spyOn(RetrievalService, 'search').mockResolvedValue({
        candidates: [
          {
            chunkId,
            documentId: docId,
            documentTitle: 'Vacation Policy',
            content: 'Full-time employees receive 20 days vacation per year.',
            pageNumber: 1,
            relevanceScore: 0.95,
          } as IRetrievalCandidate,
        ],
        timings: { embeddingMs: 10, searchMs: 15, totalMs: 25 },
      });

      // First query -> Cache Miss -> Retrieval executed
      const res1 = await RagService.query({ query: 'How many vacation days?' }, userA);
      expect(res1.answer).toContain('[S1]');
      expect(searchSpy).toHaveBeenCalledTimes(1);

      // Second identical query -> Cache Hit -> Retrieval skipped!
      const res2 = await RagService.query({ query: 'How many vacation days?' }, userA);
      expect(res2.answer).toBe(res1.answer);
      expect(searchSpy).toHaveBeenCalledTimes(1); // Call count remains 1

      // Verify QueryLog recorded cacheHit: true for the second query
      const logs = await QueryLogModel.find({ userId: new mongoose.Types.ObjectId(userA.sub) }).sort({ createdAt: 1 });
      expect(logs).toHaveLength(2);
      expect(logs[0].cacheHit).toBe(false);
      expect(logs[1].cacheHit).toBe(true);

      searchSpy.mockRestore();
    });

    it('5. InvalidateAll increments generation counter, turning previous cached entries into instant misses', async () => {
      const searchSpy = jest.spyOn(RetrievalService, 'search').mockResolvedValue({
        candidates: [
          {
            chunkId: new mongoose.Types.ObjectId().toString(),
            documentId: new mongoose.Types.ObjectId().toString(),
            documentTitle: 'Doc',
            content: 'Policy details.',
            pageNumber: 1,
            relevanceScore: 0.9,
          } as IRetrievalCandidate,
        ],
        timings: { embeddingMs: 10, searchMs: 15, totalMs: 25 },
      });

      // Populate cache
      await RagService.query({ query: 'Explain policy' }, userA);
      expect(searchSpy).toHaveBeenCalledTimes(1);

      // Invalidate all entries (simulating document upload, deletion, or re-indexing)
      await RagCacheService.invalidateAll();

      // Generation should now be 2
      const gen = await RagCacheService.getCurrentGeneration();
      expect(gen).toBe(2);

      // Query again -> Cache Miss because generation counter was incremented
      await RagService.query({ query: 'Explain policy' }, userA);
      expect(searchSpy).toHaveBeenCalledTimes(2);

      searchSpy.mockRestore();
    });

    it('6. Does not cache insufficient-evidence responses', async () => {
      await RagCacheService.set(
        { query: 'unknown query' },
        userA,
        'gemini-3.8-flash',
        {
          answer: 'I do not have sufficient information in the provided documentation to answer this question.',
          citations: [],
          insufficientEvidence: true,
        }
      );

      const cached = await RagCacheService.get({ query: 'unknown query' }, userA, 'gemini-3.8-flash');
      expect(cached).toBeNull();
    });

    it('7. Rejects oversized payloads exceeding RAG_CACHE_MAX_PAYLOAD_BYTES', async () => {
      const oversizedAnswer = 'x'.repeat(env.RAG_CACHE_MAX_PAYLOAD_BYTES + 500);

      await RagCacheService.set(
        { query: 'oversized query' },
        userA,
        'gemini-3.8-flash',
        {
          answer: oversizedAnswer,
          citations: [],
          insufficientEvidence: false,
        }
      );

      const cached = await RagCacheService.get({ query: 'oversized query' }, userA, 'gemini-3.8-flash');
      expect(cached).toBeNull();
    });

    it('8. Safely handles malformed JSON in Redis by evicting it and returning null (cache miss)', async () => {
      const key = await RagCacheService.buildCacheKey({ query: 'corrupt query' }, userA, 'gemini-3.8-flash');
      await mockRedis.set(key, '{ invalid json');

      const cached = await RagCacheService.get({ query: 'corrupt query' }, userA, 'gemini-3.8-flash');
      expect(cached).toBeNull();

      // Corrupt key should be evicted
      const remainingVal = await mockRedis.get(key);
      expect(remainingVal).toBeNull();
    });

    it('9. Fail-Safe: Redis outage returns null and allows normal retrieval without crashing', async () => {
      mockRedis.isDown = true;

      const cached = await RagCacheService.get({ query: 'redis down query' }, userA, 'gemini-3.8-flash');
      expect(cached).toBeNull();

      mockRedis.isDown = false;
    });

    it('10. Invalidation Race: In-flight request under generation G cannot publish into generation G+1 after invalidation', async () => {
      // 1. Capture current generation (e.g. 1)
      const genAtStart = await RagCacheService.getCurrentGeneration();
      expect(genAtStart).toBe(1);

      // 2. Invalidation occurs while query is in-flight
      await RagCacheService.invalidateAll();
      const genAfterInvalidate = await RagCacheService.getCurrentGeneration();
      expect(genAfterInvalidate).toBe(2);

      // 3. In-flight request finishes and attempts to write with expectedGeneration = 1
      await RagCacheService.set(
        { query: 'in-flight query' },
        userA,
        'gemini-3.8-flash',
        {
          answer: 'Stale in-flight answer',
          citations: [{ documentId: 'doc1', chunkId: 'chk1', title: 'Doc', pageNumber: 1, relevanceScore: 0.9 }],
          insufficientEvidence: false,
        },
        genAtStart // expectedGeneration: 1
      );

      // 4. Verification: The stale result was NOT written into current generation 2
      const readCurrentGen = await RagCacheService.get({ query: 'in-flight query' }, userA, 'gemini-3.8-flash');
      expect(readCurrentGen).toBeNull();
    });

    it('11. Department and Role mutation isolates cache entries immediately', async () => {
      const userEng = createTestUser('user_mut_1', Role.USER, ClearanceLevel.INTERNAL, 'Engineering');
      const userSales = createTestUser('user_mut_1', Role.USER, ClearanceLevel.INTERNAL, 'Sales');
      const userAdmin = createTestUser('user_mut_1', Role.ADMIN, ClearanceLevel.INTERNAL, 'Engineering');

      // Populate cache for Engineering user
      await RagCacheService.set(
        { query: 'department confidential doc' },
        userEng,
        'gemini-3.8-flash',
        {
          answer: 'Engineering proprietary answer',
          citations: [{ documentId: 'doc1', chunkId: 'c1', title: 'Eng Doc', pageNumber: 1, relevanceScore: 0.9 }],
          insufficientEvidence: false,
        }
      );

      // Same user with department changed to Sales must MISS cache
      const salesResult = await RagCacheService.get({ query: 'department confidential doc' }, userSales, 'gemini-3.8-flash');
      expect(salesResult).toBeNull();

      // Same user with role changed to ADMIN must MISS cache
      const adminResult = await RagCacheService.get({ query: 'department confidential doc' }, userAdmin, 'gemini-3.8-flash');
      expect(adminResult).toBeNull();
    });

    it('12. Concurrent invalidations atomically increment generation counter', async () => {
      const initialGen = await RagCacheService.getCurrentGeneration();

      // Fire 5 concurrent invalidations
      await Promise.all([
        RagCacheService.invalidateAll(),
        RagCacheService.invalidateAll(),
        RagCacheService.invalidateAll(),
        RagCacheService.invalidateAll(),
        RagCacheService.invalidateAll(),
      ]);

      const finalGen = await RagCacheService.getCurrentGeneration();
      expect(finalGen).toBe(initialGen + 5);
    });
  });
});
