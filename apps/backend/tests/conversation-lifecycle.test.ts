import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { app } from '../src/app.js';
import { ConversationModel } from '../src/models/Conversation.model.js';
import { MessageModel } from '../src/models/Message.model.js';
import { RedisService } from '../src/services/redis.service.js';
import { createMockRedis } from './helpers/mock-redis.js';
import { env } from '../src/config/env.js';
import { IJwtPayload, Role, ClearanceLevel, MessageSender } from '@enterprise-ai/shared-types';
import { RetrievalService } from '../src/services/retrieval.service.js';
import { BadGatewayError } from '../src/utils/errors.js';

describe('Phase 5 — Conversation Lifecycle, Ownership & Security Tests (Part B & I1)', () => {
  const mockRedis = createMockRedis();

  beforeAll(() => {
    RedisService.setClientOverride(mockRedis as any);
  });

  afterAll(() => {
    RedisService.setClientOverride(null);
  });

  beforeEach(async () => {
    mockRedis.clear();
    await ConversationModel.deleteMany({});
    await MessageModel.deleteMany({});
  });

  function createTestToken(userId: string, email: string): string {
    const payload: IJwtPayload = {
      sub: userId,
      email,
      role: Role.USER,
      department: 'Engineering',
      securityClearance: ClearanceLevel.INTERNAL,
      sessionId: `sess_${userId}`,
    };
    return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: '1h' });
  }

  const userAId = new mongoose.Types.ObjectId().toString();
  const userBId = new mongoose.Types.ObjectId().toString();

  const tokenUserA = createTestToken(userAId, 'alice@enterprise.com');
  const tokenUserB = createTestToken(userBId, 'bob@enterprise.com');

  describe('B1 & I1. Conversation Creation & Ownership', () => {
    it('1. Authenticated user creates conversation with server-side ownership (cannot be spoofed from body)', async () => {
      const spoofedOwnerId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          title: 'Infrastructure Planning',
          userId: spoofedOwnerId, // Attacker attempts to spoof ownership
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.title).toBe('Infrastructure Planning');
      // Must match authenticated caller User A, NOT the spoofed ID
      expect(res.body.data.userId).toBe(userAId);
      expect(res.body.data.userId).not.toBe(spoofedOwnerId);

      const saved = await ConversationModel.findById(res.body.data.id);
      expect(saved).not.toBeNull();
      expect(saved!.userId.toString()).toBe(userAId);
      expect(saved!.status).toBe('active');
    });

    it('2. Rejects unauthenticated conversation creation with 401', async () => {
      const res = await request(app)
        .post('/api/v1/conversations')
        .send({ title: 'Unauthorized' });

      expect(res.status).toBe(401);
    });

    it('3. User lists only their own conversations with pagination', async () => {
      // Create 2 conversations for User A
      await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 'User A Conversation 1' });

      await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 'User A Conversation 2' });

      // Create 1 conversation for User B
      await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({ title: 'User B Conversation 1' });

      // User A lists conversations
      const resA = await request(app)
        .get('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(resA.status).toBe(200);
      expect(resA.body.success).toBe(true);
      expect(resA.body.data).toHaveLength(2);
      expect(resA.body.pagination.total).toBe(2);
      for (const conv of resA.body.data) {
        expect(conv.userId).toBe(userAId);
      }

      // User B lists conversations
      const resB = await request(app)
        .get('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(resB.status).toBe(200);
      expect(resB.body.data).toHaveLength(1);
      expect(resB.body.data[0].userId).toBe(userBId);
    });

    it('4. Owner can read their own conversation metadata', async () => {
      const createRes = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 'Read Metadata Test' });

      const convId = createRes.body.data.id;

      const getRes = await request(app)
        .get(`/api/v1/conversations/${convId}`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.id).toBe(convId);
      expect(getRes.body.data.title).toBe('Read Metadata Test');
    });
  });

  describe('B2 & I1. Cross-User Isolation & Anti-Enumeration (404 Policy)', () => {
    let userAConversationId: string;

    beforeEach(async () => {
      const createRes = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 'Secret Architecture of User A' });
      userAConversationId = createRes.body.data.id;
    });

    it('5. User B cannot read User A conversation metadata (returns 404 to avoid enumeration)', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${userAConversationId}`)
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('6. User B cannot list message history for User A conversation (returns 404)', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${userAConversationId}/messages`)
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('7. User B cannot submit messages to User A conversation (returns 404)', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${userAConversationId}/messages`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({ content: 'Malicious injection from User B' });

      expect(res.status).toBe(404);
    });

    it('8. User B cannot delete User A conversation (returns 404)', async () => {
      const res = await request(app)
        .delete(`/api/v1/conversations/${userAConversationId}`)
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(res.status).toBe(404);

      // Verify conversation is still intact and active
      const checkDoc = await ConversationModel.findById(userAConversationId);
      expect(checkDoc!.status).toBe('active');
    });

    it('9. Rejects invalid conversation ID format with 400', async () => {
      const res = await request(app)
        .get('/api/v1/conversations/invalid-hex-id-123')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });
  });

  describe('B1 & I1. Conversation Deletion & Inactive Guards', () => {
    it('10. Soft-deletes conversation and prevents subsequent access', async () => {
      const createRes = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 'Temporary Conversation' });
      const convId = createRes.body.data.id;

      // Delete by owner
      const delRes = await request(app)
        .delete(`/api/v1/conversations/${convId}`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);

      // Status in database must be deleted
      const doc = await ConversationModel.findById(convId);
      expect(doc!.status).toBe('deleted');

      // Subsequent GET returns 404
      const getRes = await request(app)
        .get(`/api/v1/conversations/${convId}`)
        .set('Authorization', `Bearer ${tokenUserA}`);
      expect(getRes.status).toBe(404);

      // Subsequent message send returns 404
      const sendRes = await request(app)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ content: 'Post to deleted conversation' });
      expect(sendRes.status).toBe(404);
    });

    it('10b. Renames conversation and updates title in database', async () => {
      const createRes = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 'Before Rename Title' });
      const convId = createRes.body.data.id;

      const renameRes = await request(app)
        .patch(`/api/v1/conversations/${convId}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 'After Rename Title' });

      expect(renameRes.status).toBe(200);
      expect(renameRes.body.data.title).toBe('After Rename Title');

      const saved = await ConversationModel.findById(convId);
      expect(saved!.title).toBe('After Rename Title');
    });
  });

  describe('B3 & I1. Message Validation & Idempotency', () => {
    it('11. Rejects empty message content with 400', async () => {
      const createRes = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 'Validation Test' });
      const convId = createRes.body.data.id;

      const res = await request(app)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ content: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/cannot be empty/i);
    });

    it('12. Rejects message content exceeding maximum characters limit with 400', async () => {
      const createRes = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 'Length Test' });
      const convId = createRes.body.data.id;

      const oversizedContent = 'a'.repeat(env.CONVERSATION_MESSAGE_MAX_CHARS + 10);

      const res = await request(app)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ content: oversizedContent });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/exceeds maximum allowed limit/i);
    });

    it('13. Idempotent submission returns existing message pair without creating duplicates', async () => {
      const createRes = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 'Idempotency Test' });
      const convId = createRes.body.data.id;

      const idempotencyKey = 'client_msg_uuid_999911';

      // First submission
      const res1 = await request(app)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ content: 'What is our corporate remote work policy?', idempotencyKey });

      expect(res1.status).toBe(200);
      expect(res1.body.data.userMessage.id).toBeDefined();
      expect(res1.body.data.assistantMessage.id).toBeDefined();

      const userMsgId1 = res1.body.data.userMessage.id;
      const assistantMsgId1 = res1.body.data.assistantMessage.id;

      // Second identical submission with same idempotencyKey
      const res2 = await request(app)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ content: 'What is our corporate remote work policy?', idempotencyKey });

      expect(res2.status).toBe(200);
      expect(res2.body.data.userMessage.id).toBe(userMsgId1);
      expect(res2.body.data.assistantMessage.id).toBe(assistantMsgId1);

      // Verify no duplicate messages in MongoDB
      const totalMessages = await MessageModel.countDocuments({ conversationId: convId });
      expect(totalMessages).toBe(2); // exactly 1 user + 1 assistant
    });

    it('14. Concurrent duplicate submissions with same idempotencyKey atomically produce exactly one pair and one generation', async () => {
      const createRes = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 'Concurrent Idempotency Test' });
      const convId = createRes.body.data.id;

      const idempotencyKey = 'concurrent_key_888822';
      const payload = { content: 'What is the compliance retention period?', idempotencyKey };

      // Fire 3 simultaneous concurrent requests with the identical idempotency key
      const [res1, res2, res3] = await Promise.all([
        request(app).post(`/api/v1/conversations/${convId}/messages`).set('Authorization', `Bearer ${tokenUserA}`).send(payload),
        request(app).post(`/api/v1/conversations/${convId}/messages`).set('Authorization', `Bearer ${tokenUserA}`).send(payload),
        request(app).post(`/api/v1/conversations/${convId}/messages`).set('Authorization', `Bearer ${tokenUserA}`).send(payload),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res3.status).toBe(200);

      // All 3 concurrent calls receive the exact same userMessage and assistantMessage IDs
      const assistantId1 = res1.body.data.assistantMessage.id;
      const assistantId2 = res2.body.data.assistantMessage.id;
      const assistantId3 = res3.body.data.assistantMessage.id;

      expect(assistantId2).toBe(assistantId1);
      expect(assistantId3).toBe(assistantId1);

      // Exactly 1 user message and 1 assistant message persisted in MongoDB
      const totalUserMsgs = await MessageModel.countDocuments({ conversationId: convId, sender: MessageSender.USER });
      const totalAssistantMsgs = await MessageModel.countDocuments({ conversationId: convId, sender: MessageSender.ASSISTANT });

      expect(totalUserMsgs).toBe(1);
      expect(totalAssistantMsgs).toBe(1);
    });

    it('15. Reusing an idempotencyKey with a different message payload is rejected safely with 409 Conflict', async () => {
      const createRes = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 'Payload Mismatch Idempotency Test' });
      const convId = createRes.body.data.id;

      const idempotencyKey = 'key_mismatch_payload_333';

      // First submission with initial payload
      const res1 = await request(app)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ content: 'Original message text', idempotencyKey });

      expect(res1.status).toBe(200);

      // Second submission reusing same key with different message text
      const res2 = await request(app)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ content: 'Altered message text attempting key reuse', idempotencyKey });

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('CONFLICT');
      expect(res2.body.error.message).toContain('different message payload');
    });

    it('16. In-flight failure cleanly deletes unfulfilled user message, allowing clean subsequent retry', async () => {
      const conv = await ConversationModel.create({
        userId: new mongoose.Types.ObjectId(userAId),
        title: 'Failure Retry Test',
        status: 'active',
      });

      const idempotencyKey = 'key_failure_cleanup_777';

      // Simulate downstream failure on first attempt
      const searchSpy = jest
        .spyOn(RetrievalService, 'search')
        .mockRejectedValueOnce(new BadGatewayError('Simulated Retrieval Failure'));

      // First attempt fails
      const res1 = await request(app)
        .post(`/api/v1/conversations/${conv._id}/messages`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ content: 'Will fail on first attempt', idempotencyKey });

      expect(res1.status).toBe(502);

      // Restore spy
      searchSpy.mockRestore();

      // Verify no orphan user message remains in MongoDB
      const orphanMsg = await MessageModel.findOne({ conversationId: conv._id, idempotencyKey });
      expect(orphanMsg).toBeNull();

      // Retry with the same idempotency key must succeed cleanly without duplicate key error
      const res2 = await request(app)
        .post(`/api/v1/conversations/${conv._id}/messages`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ content: 'Will fail on first attempt', idempotencyKey });

      expect(res2.status).toBe(200);
      expect(res2.body.data.assistantMessage.id).toBeDefined();
    });
  });
});
