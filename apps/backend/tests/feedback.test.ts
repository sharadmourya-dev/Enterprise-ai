import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { app } from '../src/app.js';
import { ConversationModel } from '../src/models/Conversation.model.js';
import { MessageModel } from '../src/models/Message.model.js';
import { FeedbackModel } from '../src/models/Feedback.model.js';
import { env } from '../src/config/env.js';
import {
  IJwtPayload,
  Role,
  ClearanceLevel,
  MessageSender,
  FeedbackRating,
  FeedbackCategory,
} from '@enterprise-ai/shared-types';

describe('Phase 6 — Workstream B: User Feedback Integration Tests', () => {
  const userAId = new mongoose.Types.ObjectId().toString();
  const userBId = new mongoose.Types.ObjectId().toString();

  function createToken(sub: string): string {
    const payload: IJwtPayload = {
      sub,
      email: `${sub}@enterprise.com`,
      role: Role.USER,
      department: 'Engineering',
      securityClearance: ClearanceLevel.INTERNAL,
      sessionId: `sess_${sub}`,
    };
    return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: '1h' });
  }

  const tokenUserA = createToken(userAId);
  const tokenUserB = createToken(userBId);

  let convAId: string;
  let assistantMsgAId: string;
  let userMsgAId: string;

  beforeEach(async () => {
    await ConversationModel.deleteMany({});
    await MessageModel.deleteMany({});
    await FeedbackModel.deleteMany({});

    // Create Conversation for User A
    const conv = await ConversationModel.create({
      userId: new mongoose.Types.ObjectId(userAId),
      title: 'Feedback Test Conversation',
      status: 'active',
    });
    convAId = conv._id.toString();

    // Create User Message
    const uMsg = await MessageModel.create({
      conversationId: conv._id,
      sender: MessageSender.USER,
      content: 'What is the vacation rollover policy?',
      status: 'completed',
    });
    userMsgAId = uMsg._id.toString();

    // Create Assistant Message
    const aMsg = await MessageModel.create({
      conversationId: conv._id,
      sender: MessageSender.ASSISTANT,
      content: 'You can roll over up to 5 unused PTO days into the next calendar year.',
      status: 'completed',
      citations: [
        {
          chunkId: 'chunk_pto_1',
          documentId: 'doc_pto_policy',
          evidenceId: 'DOC-1:CHUNK-1',
          title: 'PTO Policy',
        },
      ],
    });
    assistantMsgAId = aMsg._id.toString();
  });

  describe('B1. Feedback Submission & Validation', () => {
    it('1. Submits positive feedback on completed assistant message successfully', async () => {
      const res = await request(app)
        .post('/api/v1/feedback')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          conversationId: convAId,
          messageId: assistantMsgAId,
          rating: FeedbackRating.THUMBS_UP,
          category: FeedbackCategory.ACCURATE_HELPFUL,
          userComment: 'Extremely helpful and cited the exact handbook section.',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.rating).toBe(FeedbackRating.THUMBS_UP);
      expect(res.body.data.category).toBe(FeedbackCategory.ACCURATE_HELPFUL);
      expect(res.body.data.userComment).toBe(
        'Extremely helpful and cited the exact handbook section.'
      );

      const saved = await FeedbackModel.findOne({ messageId: assistantMsgAId });
      expect(saved).not.toBeNull();
      expect(saved?.userId.toString()).toBe(userAId);
    });

    it('2. Supports updating existing feedback on the same message (atomic upsert)', async () => {
      // First submission: thumbs_down
      await request(app)
        .post('/api/v1/feedback')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          conversationId: convAId,
          messageId: assistantMsgAId,
          rating: FeedbackRating.THUMBS_DOWN,
          category: FeedbackCategory.MISSING_INFORMATION,
        });

      // Second submission: updated to thumbs_up with comment
      const res2 = await request(app)
        .post('/api/v1/feedback')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          conversationId: convAId,
          messageId: assistantMsgAId,
          rating: FeedbackRating.THUMBS_UP,
          category: FeedbackCategory.ACCURATE_HELPFUL,
          userComment: 'Re-read the policy and confirmed this is correct.',
        });

      expect(res2.status).toBe(201);
      expect(res2.body.data.rating).toBe(FeedbackRating.THUMBS_UP);

      // Exactly 1 record exists in database
      const totalFeedback = await FeedbackModel.countDocuments({
        messageId: assistantMsgAId,
        userId: userAId,
      });
      expect(totalFeedback).toBe(1);
    });

    it('3. Rejects invalid rating enum value with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/feedback')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          conversationId: convAId,
          messageId: assistantMsgAId,
          rating: '5_stars', // Invalid
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("rating must be either 'thumbs_up' or 'thumbs_down'");
    });

    it('4. Rejects comments exceeding maximum 1000 character length with 400 Bad Request', async () => {
      const overlyLongComment = 'A'.repeat(1001);
      const res = await request(app)
        .post('/api/v1/feedback')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          conversationId: convAId,
          messageId: assistantMsgAId,
          rating: FeedbackRating.THUMBS_DOWN,
          userComment: overlyLongComment,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('cannot exceed 1000 characters');
    });
  });

  describe('B2. Ownership & Anti-Enumeration Security', () => {
    it('5. User B cannot submit feedback on User A conversation (returns 404 Not Found)', async () => {
      const res = await request(app)
        .post('/api/v1/feedback')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({
          conversationId: convAId,
          messageId: assistantMsgAId,
          rating: FeedbackRating.THUMBS_UP,
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('6. Rejects feedback submission on missing message ID with 404 Not Found', async () => {
      const missingMsgId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .post('/api/v1/feedback')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          conversationId: convAId,
          messageId: missingMsgId,
          rating: FeedbackRating.THUMBS_UP,
        });

      expect(res.status).toBe(404);
    });
  });

  describe('B3. Message Eligibility & Invariance Protection', () => {
    it('7. Rejects feedback submission on a user message with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/feedback')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          conversationId: convAId,
          messageId: userMsgAId, // Ineligible: sender is USER
          rating: FeedbackRating.THUMBS_UP,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Feedback can only be submitted on assistant responses');
    });

    it('8. Rejects feedback on pending assistant message with 400 Bad Request', async () => {
      const pendingMsg = await MessageModel.create({
        conversationId: new mongoose.Types.ObjectId(convAId),
        sender: MessageSender.ASSISTANT,
        content: 'Generating...',
        status: 'pending', // Ineligible
      });

      const res = await request(app)
        .post('/api/v1/feedback')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          conversationId: convAId,
          messageId: pendingMsg._id.toString(),
          rating: FeedbackRating.THUMBS_UP,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('completed assistant responses');
    });

    it('9. Preserves underlying assistant message content and citations completely intact', async () => {
      await request(app)
        .post('/api/v1/feedback')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          conversationId: convAId,
          messageId: assistantMsgAId,
          rating: FeedbackRating.THUMBS_DOWN,
          category: FeedbackCategory.HALLUCINATION,
          userComment: 'Factual discrepancy',
        });

      // Verify original assistant message was not modified
      const msgAfter = await MessageModel.findById(assistantMsgAId);
      expect(msgAfter?.content).toBe(
        'You can roll over up to 5 unused PTO days into the next calendar year.'
      );
      expect(msgAfter?.citations.length).toBe(1);
      expect(msgAfter?.status).toBe('completed');
    });

    it('10. Allows owner to retrieve their submitted feedback for a message', async () => {
      await request(app)
        .post('/api/v1/feedback')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          conversationId: convAId,
          messageId: assistantMsgAId,
          rating: FeedbackRating.THUMBS_UP,
        });

      const res = await request(app)
        .get(`/api/v1/feedback/message/${assistantMsgAId}`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.rating).toBe(FeedbackRating.THUMBS_UP);
    });

    it('11. Non-owner receives 404 when querying feedback for another user message', async () => {
      const res = await request(app)
        .get(`/api/v1/feedback/message/${assistantMsgAId}`)
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(res.status).toBe(404);
    });
  });
});
