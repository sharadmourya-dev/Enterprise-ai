import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { app } from '../src/app.js';
import { RagService } from '../src/services/rag/rag.service.js';
import { RetrievalService } from '../src/services/retrieval.service.js';
import { LlmFactory } from '../src/services/llm/llm.factory.js';
import { AuditService } from '../src/services/audit.service.js';
import { RateLimiterService } from '../src/services/rate-limiter/rate-limiter.service.js';
import { ConversationModel } from '../src/models/Conversation.model.js';
import { MessageModel } from '../src/models/Message.model.js';
import { openapiSpecification } from '../src/docs/swagger.js';
import { env } from '../src/config/env.js';
import {
  IJwtPayload,
  Role,
  ClearanceLevel,
  IRagQueryResponse,
  IRetrievalCandidate,
} from '@enterprise-ai/shared-types';
import { BadGatewayError } from '../src/utils/errors.js';

describe('Phase 2C — API Aliases and Compatibility Layer Tests', () => {
  const testUserId = new mongoose.Types.ObjectId().toString();

  function createTestToken(
    userId: string,
    role = Role.USER,
    clearance = ClearanceLevel.INTERNAL,
    department = 'Engineering'
  ): string {
    const payload: IJwtPayload = {
      sub: userId,
      email: `${userId}@enterprise.com`,
      role,
      department,
      securityClearance: clearance,
      sessionId: `sess_${userId}`,
    };
    return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: '1h' });
  }

  const validToken = createTestToken(testUserId);

  beforeEach(() => {
    jest.spyOn(RateLimiterService, 'checkLimit').mockResolvedValue({
      allowed: true,
      remaining: 100,
      resetSeconds: 60,
      limit: 100,
    } as any);
    jest.spyOn(AuditService, 'log').mockResolvedValue({} as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. Route Registration & Alias Availability
  // =========================================================================
  describe('Route Registration', () => {
    it('1. POST /api/v1/chat route is registered and responds to POST requests', async () => {
      const res = await request(app).post('/api/v1/chat');
      // Should not be 404 Cannot POST /api/v1/chat
      expect(res.status).not.toBe(404);
      // Without token it should be 401
      expect(res.status).toBe(401);
    });

    it('2. POST /api/v1/search route is registered and responds to POST requests', async () => {
      const res = await request(app).post('/api/v1/search');
      // Should not be 404 Cannot POST /api/v1/search
      expect(res.status).not.toBe(404);
      // Without token it should be 401
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // 2. POST /api/v1/chat (Single-Turn RAG Compatibility Alias)
  // =========================================================================
  describe('POST /api/v1/chat', () => {
    const mockRagResponse: IRagQueryResponse = {
      answer: 'Standard PTO allocation is 20 days annually for full-time employees [S1].',
      citations: [
        {
          evidenceId: 'S1',
          documentId: 'doc_123',
          source: 'Employee Handbook 2026',
          chunkId: 'chk_999',
          revision: 1,
          page: 5,
          section: 'Paid Time Off',
        },
      ],
      insufficientEvidence: false,
      retrievalMetadata: {
        totalCandidates: 3,
        authorizedChunks: 3,
        timingsMs: {
          embedding: 50,
          retrieval: 20,
          generation: 350,
          total: 420,
        },
      },
    };

    it('3. Successfully invokes canonical RagService.query and returns standard envelope', async () => {
      const querySpy = jest.spyOn(RagService, 'query').mockResolvedValue(mockRagResponse);

      const res = await request(app)
        .post('/api/v1/chat')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          query: 'What is our annual PTO policy?',
          topK: 5,
          similarityThreshold: 0.7,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.answer).toBe(mockRagResponse.answer);
      expect(res.body.data.citations).toHaveLength(1);
      expect(res.body.data.citations[0].evidenceId).toBe('S1');
      expect(res.body.data.insufficientEvidence).toBe(false);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.timestamp).toBeDefined();
      expect(res.body.meta.requestId).toBeDefined();

      expect(querySpy).toHaveBeenCalledTimes(1);
      const [calledRequest, calledUser] = querySpy.mock.calls[0];
      expect(calledRequest).toEqual({
        query: 'What is our annual PTO policy?',
        topK: 5,
        similarityThreshold: 0.7,
      });
      expect(calledUser.sub).toBe(testUserId);
    });

    it('4. Does NOT create a persistent conversation or message in the database', async () => {
      jest.spyOn(RagService, 'query').mockResolvedValue(mockRagResponse);
      const convSpy = jest.spyOn(ConversationModel, 'create');
      const msgSpy = jest.spyOn(MessageModel, 'create');

      const res = await request(app)
        .post('/api/v1/chat')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ query: 'What is our annual PTO policy?' });

      expect(res.status).toBe(200);
      expect(convSpy).not.toHaveBeenCalled();
      expect(msgSpy).not.toHaveBeenCalled();
    });

    it('5. Rejects missing, empty, or whitespace-only queries with 400 Bad Request', async () => {
      const resMissing = await request(app)
        .post('/api/v1/chat')
        .set('Authorization', `Bearer ${validToken}`)
        .send({});
      expect(resMissing.status).toBe(400);
      expect(resMissing.body.success).toBe(false);

      const resEmpty = await request(app)
        .post('/api/v1/chat')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ query: '' });
      expect(resEmpty.status).toBe(400);

      const resWhitespace = await request(app)
        .post('/api/v1/chat')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ query: '   ' });
      expect(resWhitespace.status).toBe(400);
    });

    it('6. Rejects query exceeding 1000 characters with 400 Bad Request', async () => {
      const longQuery = 'x'.repeat(1001);
      const res = await request(app)
        .post('/api/v1/chat')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ query: longQuery });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('7. Rejects injected client-side properties due to strict schema validation', async () => {
      const res = await request(app)
        .post('/api/v1/chat')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          query: 'Legitimate question',
          collection: 'confidential_collection', // Injected field
          role: 'super_admin', // Injected field
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('8. Requires authentication and returns 401 when token is absent or invalid', async () => {
      const resNoAuth = await request(app)
        .post('/api/v1/chat')
        .send({ query: 'Hello world' });
      expect(resNoAuth.status).toBe(401);
      expect(resNoAuth.body.success).toBe(false);

      const resBadToken = await request(app)
        .post('/api/v1/chat')
        .set('Authorization', 'Bearer invalid-token')
        .send({ query: 'Hello world' });
      expect(resBadToken.status).toBe(401);
    });

    it('9. Enforces dual-dimensional rate limiting and returns 429 when quota exceeded', async () => {
      jest.spyOn(RateLimiterService, 'checkLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetSeconds: 45,
        limit: 20,
        retryAfterSeconds: 45,
      } as any);

      const res = await request(app)
        .post('/api/v1/chat')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ query: 'Rate limited request' });

      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBe('45');
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
    });

    it('10. Propagates errors safely using standard error response format', async () => {
      jest.spyOn(RagService, 'query').mockRejectedValue(
        new BadGatewayError('LLM synthesis service temporarily unreachable')
      );

      const res = await request(app)
        .post('/api/v1/chat')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ query: 'Failing downstream service' });

      expect(res.status).toBe(502);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('LLM synthesis service temporarily unreachable');
    });
  });

  // =========================================================================
  // 3. POST /api/v1/search (Search-Only Retrieval Compatibility Alias)
  // =========================================================================
  describe('POST /api/v1/search', () => {
    const mockCandidates: IRetrievalCandidate[] = [
      {
        vectorId: 'qdrant_point_001',
        score: 0.91,
        chunkId: 'chunk_hr_01',
        documentId: 'doc_hr_456',
        revision: 1,
        title: 'Work From Home Policy',
        content: 'Employees may work remotely up to two days per week with manager approval.',
        pageNumber: 2,
        sectionHeader: 'Remote Work Eligibility',
        minimumClearanceLevel: 1,
        allowedRoles: ['user'],
        allowedDepartments: ['Engineering'],
        allowedUserIds: [],
        isActive: true,
      },
      {
        vectorId: 'qdrant_point_002',
        score: 0.84,
        chunkId: 'chunk_hr_02',
        documentId: 'doc_hr_456',
        revision: 1,
        title: 'Work From Home Policy',
        content: 'Core collaboration hours are 10:00 AM to 4:00 PM local time.',
        pageNumber: 3,
        sectionHeader: 'Core Hours',
        minimumClearanceLevel: 1,
        allowedRoles: [],
        allowedDepartments: [],
        allowedUserIds: [],
        isActive: true,
      },
    ];

    it('11. Returns ranked retrieval candidates and timings WITHOUT calling LLM synthesis', async () => {
      const searchSpy = jest.spyOn(RetrievalService, 'search').mockResolvedValue({
        candidates: mockCandidates,
        timings: { embeddingMs: 35, searchMs: 15 },
      });

      // Spy on LLM factory to guarantee NO LLM is requested or used
      const llmSpy = jest.spyOn(LlmFactory, 'getProvider');

      const res = await request(app)
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          query: 'remote work policy',
          topK: 5,
          similarityThreshold: 0.7,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.query).toBe('remote work policy');
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.results).toHaveLength(2);
      expect(res.body.data.timings).toEqual({ embeddingMs: 35, searchMs: 15 });
      expect(res.body.meta.timestamp).toBeDefined();
      expect(res.body.meta.requestId).toBeDefined();

      // Verify rank ordering
      expect(res.body.data.results[0].rank).toBe(1);
      expect(res.body.data.results[0].score).toBe(0.91);
      expect(res.body.data.results[0].chunkId).toBe('chunk_hr_01');
      expect(res.body.data.results[0].title).toBe('Work From Home Policy');
      expect(res.body.data.results[0].content).toContain('Employees may work remotely');

      expect(res.body.data.results[1].rank).toBe(2);
      expect(res.body.data.results[1].score).toBe(0.84);

      // CRITICAL ASSERTION: LLM generation was NOT invoked
      expect(llmSpy).not.toHaveBeenCalled();
      expect(searchSpy).toHaveBeenCalledTimes(1);
      const [calledQuery, calledUser, calledOptions] = searchSpy.mock.calls[0];
      expect(calledQuery).toBe('remote work policy');
      expect(calledUser.sub).toBe(testUserId);
      expect(calledOptions).toEqual({ topK: 5, similarityThreshold: 0.7 });
    });

    it('12. Strips internal vector store IDs and private ACL metadata from search results', async () => {
      jest.spyOn(RetrievalService, 'search').mockResolvedValue({
        candidates: mockCandidates,
        timings: { embeddingMs: 20, searchMs: 10 },
      });

      const res = await request(app)
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ query: 'remote work policy' });

      expect(res.status).toBe(200);
      const firstResult = res.body.data.results[0];

      // Safe fields present
      expect(firstResult.chunkId).toBe('chunk_hr_01');
      expect(firstResult.documentId).toBe('doc_hr_456');
      expect(firstResult.revision).toBe(1);
      expect(firstResult.title).toBe('Work From Home Policy');
      expect(firstResult.content).toBeDefined();
      expect(firstResult.pageNumber).toBe(2);
      expect(firstResult.sectionHeader).toBe('Remote Work Eligibility');
      expect(firstResult.score).toBe(0.91);
      expect(firstResult.rank).toBe(1);

      // Private ACL & internal fields MUST NOT BE EXPOSED
      expect(firstResult.vectorId).toBeUndefined();
      expect(firstResult.minimumClearanceLevel).toBeUndefined();
      expect(firstResult.allowedRoles).toBeUndefined();
      expect(firstResult.allowedDepartments).toBeUndefined();
      expect(firstResult.allowedUserIds).toBeUndefined();
      expect(firstResult.isActive).toBeUndefined();
    });

    it('13. Preserves document ACL context by passing authenticated user claims to RetrievalService', async () => {
      const searchSpy = jest.spyOn(RetrievalService, 'search').mockResolvedValue({
        candidates: [],
        timings: { embeddingMs: 10, searchMs: 5 },
      });

      const confidentialToken = createTestToken(
        testUserId,
        Role.COMPLIANCE_OFFICER,
        ClearanceLevel.CONFIDENTIAL,
        'Legal'
      );

      const res = await request(app)
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${confidentialToken}`)
        .send({ query: 'confidential audit criteria' });

      expect(res.status).toBe(200);
      expect(searchSpy).toHaveBeenCalledTimes(1);

      const userPassed = searchSpy.mock.calls[0][1];
      expect(userPassed.role).toBe(Role.COMPLIANCE_OFFICER);
      expect(userPassed.securityClearance).toBe(ClearanceLevel.CONFIDENTIAL);
      expect(userPassed.department).toBe('Legal');
    });

    it('14. Rejects empty query and query exceeding 1000 characters with 400 Bad Request', async () => {
      const resEmpty = await request(app)
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ query: '' });
      expect(resEmpty.status).toBe(400);

      const resLong = await request(app)
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ query: 'a'.repeat(1001) });
      expect(resLong.status).toBe(400);
    });

    it('15. Rejects injected client fields with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          query: 'search query',
          filter: { clearance: 'public' }, // Injected filter
        });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('16. Requires authentication and returns 401 when token is missing', async () => {
      const res = await request(app)
        .post('/api/v1/search')
        .send({ query: 'unauthenticated search' });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('17. Enforces rate limiting and returns 429 when search quota is exceeded', async () => {
      jest.spyOn(RateLimiterService, 'checkLimit').mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetSeconds: 30,
        limit: 20,
        retryAfterSeconds: 30,
      } as any);

      const res = await request(app)
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ query: 'rate limited search' });

      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBe('30');
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
    });

    it('18. Propagates RetrievalService errors with standard error response envelope', async () => {
      jest.spyOn(RetrievalService, 'search').mockRejectedValue(
        new BadGatewayError('Vector database connection refused')
      );

      const res = await request(app)
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ query: 'failing vector db' });

      expect(res.status).toBe(502);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('Vector database connection refused');
    });
  });

  // =========================================================================
  // 4. Canonical Endpoints Unchanged
  // =========================================================================
  describe('Canonical Endpoints Preservation', () => {
    it('19. Canonical POST /api/v1/rag/query remains fully functional', async () => {
      const querySpy = jest.spyOn(RagService, 'query').mockResolvedValue({
        answer: 'Canonical RAG response [S1].',
        citations: [],
        insufficientEvidence: false,
        retrievalMetadata: {
          totalCandidates: 1,
          authorizedChunks: 1,
          timingsMs: { embedding: 10, retrieval: 10, total: 20 },
        },
      });

      const res = await request(app)
        .post('/api/v1/rag/query')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ query: 'Canonical question' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.answer).toBe('Canonical RAG response [S1].');
      expect(querySpy).toHaveBeenCalledTimes(1);
    });

    it('20. Canonical POST /api/v1/rag/search is functional and invokes RetrievalService', async () => {
      const searchSpy = jest.spyOn(RetrievalService, 'search').mockResolvedValue({
        candidates: [],
        timings: { embeddingMs: 10, searchMs: 5 },
      });

      const res = await request(app)
        .post('/api/v1/rag/search')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ query: 'Canonical search' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBe(0);
      expect(searchSpy).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 5. OpenAPI Specification Consistency
  // =========================================================================
  describe('OpenAPI Specification for Aliases', () => {
    it('21. openapiSpecification documents /api/v1/chat with accurate schemas', () => {
      const chatPath = (openapiSpecification.paths as any)['/api/v1/chat'];
      expect(chatPath).toBeDefined();
      expect(chatPath.post).toBeDefined();
      expect(chatPath.post.security).toEqual([{ bearerAuth: [] }]);
      expect(chatPath.post.requestBody?.content['application/json']?.schema?.required).toContain('query');
      expect(chatPath.post.responses['200']).toBeDefined();
      expect(chatPath.post.responses['400']).toBeDefined();
      expect(chatPath.post.responses['401']).toBeDefined();
      expect(chatPath.post.responses['429']).toBeDefined();
    });

    it('22. openapiSpecification documents /api/v1/search with accurate schemas', () => {
      const searchPath = (openapiSpecification.paths as any)['/api/v1/search'];
      expect(searchPath).toBeDefined();
      expect(searchPath.post).toBeDefined();
      expect(searchPath.post.security).toEqual([{ bearerAuth: [] }]);
      expect(searchPath.post.requestBody?.content['application/json']?.schema?.required).toContain('query');
      expect(searchPath.post.responses['200']).toBeDefined();
      expect(searchPath.post.responses['400']).toBeDefined();
      expect(searchPath.post.responses['401']).toBeDefined();
      expect(searchPath.post.responses['429']).toBeDefined();
      // Check component schemas
      const schemas = (openapiSpecification.components as any).schemas;
      expect(schemas.SearchResultItem).toBeDefined();
      expect(schemas.SearchResponseData).toBeDefined();
    });
  });
});
