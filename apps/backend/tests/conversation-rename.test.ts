import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { app } from '../src/app.js';
import { ConversationModel } from '../src/models/Conversation.model.js';
import { MessageModel } from '../src/models/Message.model.js';
import { AuditService } from '../src/services/audit.service.js';
import { RateLimiterService } from '../src/services/rate-limiter/rate-limiter.service.js';
import { ConversationService } from '../src/services/conversation/conversation.service.js';
import { env } from '../src/config/env.js';
import {
  IJwtPayload,
  Role,
  ClearanceLevel,
  AuditAction,
  AuditResourceType,
  LlmProvider,
} from '@enterprise-ai/shared-types';

describe('Phase 2B — Conversation Renaming (Backend Tests)', () => {
  const userAId = new mongoose.Types.ObjectId().toString();
  const userBId = new mongoose.Types.ObjectId().toString();

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

  const tokenUserA = createTestToken(userAId, 'alice@enterprise.com');
  const tokenUserB = createTestToken(userBId, 'bob@enterprise.com');

  beforeEach(() => {
    jest.spyOn(RateLimiterService, 'checkLimit').mockResolvedValue({
      allowed: true,
      remaining: 100,
      resetSeconds: 60,
      limit: 100,
    } as any);
    jest.spyOn(AuditService, 'log').mockResolvedValue({} as any);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('PATCH /api/v1/conversations/:conversationId', () => {
    it('1. Successfully renames conversation and persists new title', async () => {
      const convId = new mongoose.Types.ObjectId();
      const existingDoc = {
        _id: convId,
        userId: new mongoose.Types.ObjectId(userAId),
        title: 'Initial Conversation Name',
        status: 'active',
        selectedModelProvider: LlmProvider.GEMINI,
        selectedModelName: 'gemini-1.5-pro',
        createdAt: new Date('2026-10-20T10:00:00Z'),
        updatedAt: new Date('2026-10-20T10:00:00Z'),
      };

      const updatedDoc = {
        ...existingDoc,
        title: 'Renamed Q4 Strategy',
        updatedAt: new Date('2026-10-27T12:00:00Z'),
      };

      jest.spyOn(ConversationModel, 'findById').mockResolvedValue(existingDoc as any);
      const spyUpdate = jest
        .spyOn(ConversationModel, 'findByIdAndUpdate')
        .mockResolvedValue(updatedDoc as any);

      const res = await request(app)
        .patch(`/api/v1/conversations/${convId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 'Renamed Q4 Strategy' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(convId.toString());
      expect(res.body.data.title).toBe('Renamed Q4 Strategy');
      expect(spyUpdate).toHaveBeenCalledWith(
        convId,
        { $set: { title: 'Renamed Q4 Strategy' } },
        { new: true }
      );
    });

    it('2. Trims surrounding whitespace from submitted title before saving', async () => {
      const convId = new mongoose.Types.ObjectId();
      const existingDoc = {
        _id: convId,
        userId: new mongoose.Types.ObjectId(userAId),
        title: 'Untrimmed Original',
        status: 'active',
        selectedModelProvider: LlmProvider.OPENAI,
        selectedModelName: 'gpt-4o',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedDoc = {
        ...existingDoc,
        title: 'Cleanly Trimmed Title',
      };

      jest.spyOn(ConversationModel, 'findById').mockResolvedValue(existingDoc as any);
      const spyUpdate = jest
        .spyOn(ConversationModel, 'findByIdAndUpdate')
        .mockResolvedValue(updatedDoc as any);

      const res = await request(app)
        .patch(`/api/v1/conversations/${convId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: '   Cleanly Trimmed Title   \t\n' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('Cleanly Trimmed Title');
      expect(spyUpdate).toHaveBeenCalledWith(
        convId,
        { $set: { title: 'Cleanly Trimmed Title' } },
        { new: true }
      );
    });

    it('3. Rejects empty string title with 400 Bad Request', async () => {
      const convId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .patch(`/api/v1/conversations/${convId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: '' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('BAD_REQUEST');
      expect(res.body.error.message).toMatch(/cannot be empty/i);
    });

    it('4. Rejects whitespace-only title with 400 Bad Request', async () => {
      const convId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .patch(`/api/v1/conversations/${convId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: '      \t  \n   ' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('BAD_REQUEST');
      expect(res.body.error.message).toMatch(/cannot be empty/i);
    });

    it('5. Rejects title exceeding 150 characters with 400 Bad Request', async () => {
      const convId = new mongoose.Types.ObjectId();
      const longTitle = 'A'.repeat(151);

      const res = await request(app)
        .patch(`/api/v1/conversations/${convId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: longTitle });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('BAD_REQUEST');
      expect(res.body.error.message).toMatch(/cannot exceed 150 characters/i);
    });

    it('6. Rejects invalid title types (numbers, booleans, objects, null) with 400 Bad Request', async () => {
      const convId = new mongoose.Types.ObjectId();

      // Number
      const resNum = await request(app)
        .patch(`/api/v1/conversations/${convId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 12345 });
      expect(resNum.status).toBe(400);
      expect(resNum.body.error.code).toBe('BAD_REQUEST');
      expect(resNum.body.error.message).toMatch(/must be a string/i);

      // Boolean
      const resBool = await request(app)
        .patch(`/api/v1/conversations/${convId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: true });
      expect(resBool.status).toBe(400);
      expect(resBool.body.error.code).toBe('BAD_REQUEST');

      // Object
      const resObj = await request(app)
        .patch(`/api/v1/conversations/${convId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: { nested: 'title' } });
      expect(resObj.status).toBe(400);
      expect(resObj.body.error.code).toBe('BAD_REQUEST');

      // Null
      const resNull = await request(app)
        .patch(`/api/v1/conversations/${convId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: null });
      expect(resNull.status).toBe(400);
      expect(resNull.body.error.code).toBe('BAD_REQUEST');
    });

    it('7. Rejects unauthenticated request with 401 Unauthorized', async () => {
      const convId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .patch(`/api/v1/conversations/${convId.toString()}`)
        .send({ title: 'Unauthenticated Rename Attempt' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('8. Returns 404 Not Found for nonexistent conversation ID', async () => {
      const nonexistentId = new mongoose.Types.ObjectId();
      jest.spyOn(ConversationModel, 'findById').mockResolvedValue(null);

      const res = await request(app)
        .patch(`/api/v1/conversations/${nonexistentId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 'Valid Title' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toMatch(/conversation not found/i);
    });

    it('9. Returns 404 Not Found for another user conversation (strict anti-enumeration)', async () => {
      const convId = new mongoose.Types.ObjectId();
      // Conversation owned by User B
      const userBDoc = {
        _id: convId,
        userId: new mongoose.Types.ObjectId(userBId),
        title: 'Bob Private Discussion',
        status: 'active',
      };

      jest.spyOn(ConversationModel, 'findById').mockResolvedValue(userBDoc as any);
      const spyUpdate = jest.spyOn(ConversationModel, 'findByIdAndUpdate');

      // User A attempts to rename Bob's conversation
      const res = await request(app)
        .patch(`/api/v1/conversations/${convId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 'Alice Hijack Title' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toMatch(/conversation not found/i);
      expect(spyUpdate).not.toHaveBeenCalled();
    });

    it('10. Preserves all unrelated conversation fields and message history', async () => {
      const convId = new mongoose.Types.ObjectId();
      const existingDoc = {
        _id: convId,
        userId: new mongoose.Types.ObjectId(userAId),
        title: 'Original Title',
        status: 'active',
        selectedModelProvider: LlmProvider.OPENAI,
        selectedModelName: 'gpt-4o-mini',
        systemPromptOverride: 'Act as senior security architect',
        createdAt: new Date('2026-10-15T09:00:00Z'),
        updatedAt: new Date('2026-10-15T09:00:00Z'),
      };

      const updatedDoc = {
        ...existingDoc,
        title: 'Updated Security Architecture',
        updatedAt: new Date('2026-10-27T12:00:00Z'),
      };

      jest.spyOn(ConversationModel, 'findById').mockResolvedValue(existingDoc as any);
      jest.spyOn(ConversationModel, 'findByIdAndUpdate').mockResolvedValue(updatedDoc as any);

      const res = await request(app)
        .patch(`/api/v1/conversations/${convId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 'Updated Security Architecture' });

      expect(res.status).toBe(200);
      expect(res.body.data.selectedModelProvider).toBe(LlmProvider.OPENAI);
      expect(res.body.data.selectedModelName).toBe('gpt-4o-mini');
      expect(res.body.data.systemPromptOverride).toBe('Act as senior security architect');
      expect(res.body.data.userId).toBe(userAId);
    });

    it('11. Records audit event adhering to existing conventions without exposing sensitive message content', async () => {
      const convId = new mongoose.Types.ObjectId();
      const existingDoc = {
        _id: convId,
        userId: new mongoose.Types.ObjectId(userAId),
        title: 'Before Rename',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedDoc = {
        ...existingDoc,
        title: 'After Rename',
      };

      jest.spyOn(ConversationModel, 'findById').mockResolvedValue(existingDoc as any);
      jest.spyOn(ConversationModel, 'findByIdAndUpdate').mockResolvedValue(updatedDoc as any);
      const spyAudit = jest.spyOn(AuditService, 'log').mockResolvedValue({} as any);

      await request(app)
        .patch(`/api/v1/conversations/${convId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 'After Rename' });

      expect(spyAudit).toHaveBeenCalledTimes(1);
      expect(spyAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: userAId,
          action: AuditAction.CHAT_QUERY,
          resourceType: AuditResourceType.CONVERSATION,
          resourceId: convId.toString(),
          status: 'success',
          details: {
            operation: 'rename',
            conversationId: convId.toString(),
          },
        })
      );
    });

    it('12. Maintains regression compatibility with existing conversation endpoints (GET, DELETE)', async () => {
      const convId = new mongoose.Types.ObjectId();
      const existingDoc = {
        _id: convId,
        userId: new mongoose.Types.ObjectId(userAId),
        title: 'Active Item',
        status: 'active',
        selectedModelProvider: LlmProvider.GEMINI,
        selectedModelName: 'gemini-1.5-pro',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(ConversationModel, 'findById').mockResolvedValue(existingDoc as any);
      jest.spyOn(ConversationModel, 'updateOne').mockResolvedValue({} as any);

      // GET conversation metadata
      const getRes = await request(app)
        .get(`/api/v1/conversations/${convId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.title).toBe('Active Item');

      // DELETE conversation
      const delRes = await request(app)
        .delete(`/api/v1/conversations/${convId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);
      expect(delRes.body.message).toMatch(/deleted successfully/i);
    });
  });
});
