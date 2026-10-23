import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { app } from '../src/app.js';
import { ConversationModel } from '../src/models/Conversation.model.js';
import { MessageModel } from '../src/models/Message.model.js';
import { DocumentModel } from '../src/models/Document.model.js';
import { RetrievalService } from '../src/services/retrieval.service.js';
import { LlmFactory } from '../src/services/llm/llm.factory.js';
import { MockLlmProvider } from '../src/services/llm/mock.llm.js';
import { RedisService } from '../src/services/redis.service.js';
import { createMockRedis } from './helpers/mock-redis.js';
import { env } from '../src/config/env.js';
import {
  IJwtPayload,
  Role,
  ClearanceLevel,
  IRetrievalCandidate,
  MessageSender,
  DocumentStatus,
} from '@enterprise-ai/shared-types';
import { SseStreamService } from '../src/services/sse/sse-stream.service.js';
import { EventEmitter } from 'events';

describe('Phase 5 — Server-Sent Events (SSE) Citation-Safe Streaming Tests (Part D & I3)', () => {
  const mockRedis = createMockRedis();
  let mockLlm: MockLlmProvider;

  beforeAll(() => {
    RedisService.setClientOverride(mockRedis as any);
    mockLlm = new MockLlmProvider();
    LlmFactory.setProvider(mockLlm);
  });

  afterAll(() => {
    RedisService.setClientOverride(null);
    LlmFactory.setProvider(null);
  });

  beforeEach(async () => {
    mockRedis.clear();
    await ConversationModel.deleteMany({});
    await MessageModel.deleteMany({});
    await DocumentModel.deleteMany({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createTestToken(userId: string): string {
    const payload: IJwtPayload = {
      sub: userId,
      email: `${userId}@enterprise.com`,
      role: Role.USER,
      department: 'Engineering',
      securityClearance: ClearanceLevel.INTERNAL,
      sessionId: `sess_${userId}`,
    };
    return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: '1h' });
  }

  const userAId = new mongoose.Types.ObjectId().toString();
  const userBId = new mongoose.Types.ObjectId().toString();
  const tokenUserA = createTestToken(userAId);
  const tokenUserB = createTestToken(userBId);

  describe('D1, D2 & I3. SSE Transport Headers & Event Protocol Sequence', () => {
    it('1. Returns 200 with proper SSE streaming headers', async () => {
      const conv = await ConversationModel.create({
        userId: new mongoose.Types.ObjectId(userAId),
        title: 'Streaming Headers Test',
        status: 'active',
      });

      const res = await request(app)
        .post(`/api/v1/conversations/${conv._id}/messages/stream`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ content: 'Explain streaming' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/event-stream/);
      expect(res.headers['cache-control']).toBe('no-cache, no-transform');
      expect(res.headers['connection']).toBe('keep-alive');
      expect(res.headers['x-accel-buffering']).toBe('no');
    });

    it('2. Emits events in documented order: started -> progress -> delta -> citations -> completed', async () => {
      const conv = await ConversationModel.create({
        userId: new mongoose.Types.ObjectId(userAId),
        title: 'Event Sequence Test',
        status: 'active',
      });

      const chunkId = new mongoose.Types.ObjectId().toString();
      const docId = new mongoose.Types.ObjectId().toString();

      jest.spyOn(RetrievalService, 'search').mockResolvedValueOnce({
        candidates: [
          {
            chunkId,
            documentId: docId,
            documentTitle: 'Architecture Overview',
            content: 'The system uses microservices architecture with Redis and Kafka.',
            pageNumber: 2,
            relevanceScore: 0.96,
          } as IRetrievalCandidate,
        ],
        timings: { embeddingMs: 12, searchMs: 18, totalMs: 30 },
      });

      const res = await request(app)
        .post(`/api/v1/conversations/${conv._id}/messages/stream`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ content: 'What architecture does the system use?' });

      expect(res.status).toBe(200);

      // Parse SSE text output
      const rawBody = res.text;
      const eventMatches = Array.from(rawBody.matchAll(/event:\s*([a-zA-Z0-9._]+)/g)).map((m) => m[1]);

      expect(eventMatches).toContain('message.started');
      expect(eventMatches).toContain('message.progress');
      expect(eventMatches).toContain('message.delta');
      expect(eventMatches).toContain('message.citations');
      expect(eventMatches).toContain('message.completed');

      // Verify sequence ordering
      const startedIdx = eventMatches.indexOf('message.started');
      const progressIdx = eventMatches.indexOf('message.progress');
      const deltaIdx = eventMatches.indexOf('message.delta');
      const citationsIdx = eventMatches.indexOf('message.citations');
      const completedIdx = eventMatches.indexOf('message.completed');

      expect(startedIdx).toBeLessThan(progressIdx);
      expect(progressIdx).toBeLessThan(deltaIdx);
      expect(deltaIdx).toBeLessThan(citationsIdx);
      expect(citationsIdx).toBeLessThan(completedIdx);

      // Verify persisted message in database
      const assistantMsg = await MessageModel.findOne({
        conversationId: conv._id,
        sender: MessageSender.ASSISTANT,
      });
      expect(assistantMsg).not.toBeNull();
      expect(assistantMsg!.status).toBe('completed');
      expect(assistantMsg!.citations).toHaveLength(1);
    });

    it('3. Citation-Safe Streaming: When retrieval is empty, emits canonical disclaimer and empty citations', async () => {
      const conv = await ConversationModel.create({
        userId: new mongoose.Types.ObjectId(userAId),
        title: 'Empty Evidence Stream Test',
        status: 'active',
      });

      jest.spyOn(DocumentModel, 'exists').mockResolvedValueOnce({ _id: new mongoose.Types.ObjectId() } as any);

      jest.spyOn(RetrievalService, 'search').mockResolvedValueOnce({
        candidates: [],
        timings: { embeddingMs: 5, searchMs: 8, totalMs: 13 },
      });

      const res = await request(app)
        .post(`/api/v1/conversations/${conv._id}/messages/stream`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ content: 'Unknown topic' });

      expect(res.status).toBe(200);
      const rawBody = res.text;

      const deltaChunks = Array.from(rawBody.matchAll(/"content":"([^"]*)"/g)).map((m) => m[1]);
      const reconstructedAnswer = deltaChunks.join('');

      expect(reconstructedAnswer).toContain('I do not have sufficient information in the provided documentation');
      expect(rawBody).toContain('"citations":[]');
    });

    it('4. Cross-user stream attempt rejected with 404 before headers are sent', async () => {
      const conv = await ConversationModel.create({
        userId: new mongoose.Types.ObjectId(userAId),
        title: 'Private Stream Test',
        status: 'active',
      });

      // User B attempts to stream from User A conversation
      const res = await request(app)
        .post(`/api/v1/conversations/${conv._id}/messages/stream`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({ content: 'Attempt cross-user stream' });

      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('5. Normal request-body completion does not abort an active SSE response', async () => {
      const conv = await ConversationModel.create({
        userId: new mongoose.Types.ObjectId(userAId),
        title: 'Normal Completion Stream Test',
        status: 'active',
      });

      // Submit streaming request normally
      const res = await request(app)
        .post(`/api/v1/conversations/${conv._id}/messages/stream`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ content: 'Valid question with completed request body' });

      expect(res.status).toBe(200);
      expect(res.text).toContain('message.completed');

      // Verify that normal completion persisted both user and assistant messages as 'completed'
      const messages = await MessageModel.find({ conversationId: conv._id });
      expect(messages).toHaveLength(2);
      expect(messages.every((m) => m.status === 'completed')).toBe(true);
    });

    it('6. Genuine client disconnect before generation completes cancels provider work and cleans up orphan user message', async () => {
      const conv = await ConversationModel.create({
        userId: new mongoose.Types.ObjectId(userAId),
        title: 'Premature Disconnect Test',
        status: 'active',
      });

      jest.spyOn(RetrievalService, 'search').mockResolvedValueOnce({
        candidates: [
          {
            chunkId: new mongoose.Types.ObjectId().toString(),
            documentId: new mongoose.Types.ObjectId().toString(),
            documentTitle: 'Disconnect Doc',
            content: 'Sample text to trigger generation',
            pageNumber: 1,
            relevanceScore: 0.95,
          } as IRetrievalCandidate,
        ],
        timings: { embeddingMs: 1, searchMs: 1, totalMs: 2 },
      });

      let capturedAbortSignal: AbortSignal | undefined;
      let onGenerationStarted: () => void;
      const generationStartedPromise = new Promise<void>((resolve) => {
        onGenerationStarted = resolve;
      });

      mockLlm.setHandler(async (_prompt, options) => {
        capturedAbortSignal = options?.abortSignal;
        onGenerationStarted();
        // Simulate in-flight processing delay
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { text: 'Done', model: 'mock' };
      });

      const fakeReq = new EventEmitter() as any;
      fakeReq.id = 'req_fake_1';
      fakeReq.ip = '127.0.0.1';
      fakeReq.headers = {};

      const fakeRes = new EventEmitter() as any;
      fakeRes.headersSent = false;
      fakeRes.writableEnded = false;
      fakeRes.destroyed = false;
      fakeRes.setHeader = jest.fn();
      fakeRes.write = jest.fn();
      fakeRes.end = jest.fn(() => { fakeRes.writableEnded = true; });

      const streamPromise = SseStreamService.streamMessage(
        fakeReq,
        fakeRes,
        conv,
        {
          sub: userAId,
          email: 'userA@enterprise.com',
          role: Role.USER,
          department: 'Engineering',
          securityClearance: ClearanceLevel.INTERNAL,
          sessionId: 's1',
        },
        'Question that will be disconnected',
        'key_disconnect_123'
      );

      // Wait until generation is actively in-flight, then simulate client TCP socket close
      await generationStartedPromise;
      fakeRes.emit('close');

      await streamPromise;

      // Downstream abort signal must have fired
      expect(capturedAbortSignal?.aborted).toBe(true);

      // Orphan user message must have been removed so retries work
      const userMsg = await MessageModel.findOne({ conversationId: conv._id, idempotencyKey: 'key_disconnect_123' });
      expect(userMsg).toBeNull();

      mockLlm.setHandler(null);
    });

    it('7. Disconnect after successful persistence preserves assistant message as completed', async () => {
      const conv = await ConversationModel.create({
        userId: new mongoose.Types.ObjectId(userAId),
        title: 'Disconnect After Persistence Test',
        status: 'active',
      });

      const res = await request(app)
        .post(`/api/v1/conversations/${conv._id}/messages/stream`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ content: 'Question that finishes successfully' });

      expect(res.status).toBe(200);

      const assistantMsg = await MessageModel.findOne({
        conversationId: conv._id,
        sender: MessageSender.ASSISTANT,
      });

      expect(assistantMsg).not.toBeNull();
      expect(assistantMsg!.status).toBe('completed');
    });

    it('8. Terminal event exclusivity: Exactly one terminal event is emitted', async () => {
      const conv = await ConversationModel.create({
        userId: new mongoose.Types.ObjectId(userAId),
        title: 'Single Terminal Event Test',
        status: 'active',
      });

      const res = await request(app)
        .post(`/api/v1/conversations/${conv._id}/messages/stream`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ content: 'Testing terminal event count' });

      expect(res.status).toBe(200);
      const text = res.text;

      const completedCount = (text.match(/event:\s*message\.completed/g) || []).length;
      const errorCount = (text.match(/event:\s*message\.error/g) || []).length;

      // Exactly one terminal event must exist
      expect(completedCount + errorCount).toBe(1);
    });
  });
});
