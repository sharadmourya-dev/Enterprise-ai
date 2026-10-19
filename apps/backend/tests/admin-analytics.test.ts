import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { app } from '../src/app.js';
import { UserModel } from '../src/models/User.model.js';
import { DocumentModel } from '../src/models/Document.model.js';
import { ConversationModel } from '../src/models/Conversation.model.js';
import { MessageModel } from '../src/models/Message.model.js';
import { QueryLogModel } from '../src/models/QueryLog.model.js';
import { FeedbackModel } from '../src/models/Feedback.model.js';
import { env } from '../src/config/env.js';
import {
  IJwtPayload,
  Role,
  ClearanceLevel,
  DocumentStatus,
  DocumentMimeType,
  MessageSender,
  FeedbackRating,
  FeedbackCategory,
} from '@enterprise-ai/shared-types';

describe('Phase 6 — Workstream A: Administrative Analytics Integration Tests', () => {
  const adminId = new mongoose.Types.ObjectId().toString();
  const userId = new mongoose.Types.ObjectId().toString();

  function createToken(sub: string, role: Role): string {
    const payload: IJwtPayload = {
      sub,
      email: `${sub}@enterprise.com`,
      role,
      department: 'Engineering',
      securityClearance: ClearanceLevel.INTERNAL,
      sessionId: `sess_${sub}`,
    };
    return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: '1h' });
  }

  const adminToken = createToken(adminId, Role.ADMIN);
  const userToken = createToken(userId, Role.USER);

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await DocumentModel.deleteMany({});
    await ConversationModel.deleteMany({});
    await MessageModel.deleteMany({});
    await QueryLogModel.deleteMany({});
    await FeedbackModel.deleteMany({});
  });

  describe('A1. Authorization & Role-Based Access Control', () => {
    it('1. Rejects unauthenticated requests with 401 Unauthorized', async () => {
      const res = await request(app).get('/api/v1/admin/analytics/overview');
      expect(res.status).toBe(401);
    });

    it('2. Denies non-admin regular users with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/v1/admin/analytics/overview')
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(403);
    });

    it('3. Allows authorized ADMIN access to overview metrics', async () => {
      const res = await request(app)
        .get('/api/v1/admin/analytics/overview')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.userMetrics).toBeDefined();
      expect(res.body.data.documentMetrics).toBeDefined();
      expect(res.body.data.conversationMetrics).toBeDefined();
      expect(res.body.data.queryMetrics).toBeDefined();
      expect(res.body.data.feedbackMetrics).toBeDefined();
    });
  });

  describe('A2. Date-Range Validation & Ceiling Controls', () => {
    it('4. Rejects invalid date format with 400 Bad Request', async () => {
      const res = await request(app)
        .get('/api/v1/admin/analytics/overview?startDate=invalid-date')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('ISO 8601');
    });

    it('5. Rejects inverted date range (startDate > endDate) with 400 Bad Request', async () => {
      const res = await request(app)
        .get('/api/v1/admin/analytics/overview?startDate=2026-10-15&endDate=2026-10-01')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('startDate must be before or equal to endDate');
    });

    it('6. Enforces 90-day ceiling to prevent unbounded analytics aggregations', async () => {
      const res = await request(app)
        .get('/api/v1/admin/analytics/overview?startDate=2026-01-01&endDate=2026-06-01')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('cannot exceed 90 days');
    });
  });

  describe('A3. Aggregation Correctness Across Core Domains', () => {
    it('7. Aggregates user, document, query, and feedback counts accurately', async () => {
      // 1. Seed Users
      await UserModel.create([
        {
          _id: new mongoose.Types.ObjectId(userId),
          name: 'User One',
          email: 'user1@enterprise.com',
          passwordHash: 'hash',
          role: Role.USER,
          department: 'Engineering',
          securityClearance: ClearanceLevel.INTERNAL,
          isActive: true,
        },
        {
          _id: new mongoose.Types.ObjectId(adminId),
          name: 'Admin One',
          email: 'admin1@enterprise.com',
          passwordHash: 'hash',
          role: Role.ADMIN,
          department: 'Security',
          securityClearance: ClearanceLevel.RESTRICTED,
          isActive: true,
        },
      ]);

      // 2. Seed Documents
      await DocumentModel.create([
        {
          title: 'Doc 1',
          originalFilename: 'doc1.pdf',
          mimeType: DocumentMimeType.PDF,
          fileSizeBytes: 2048,
          storagePath: '/data/doc1.pdf',
          fileHash: 'hash1',
          status: DocumentStatus.READY,
          chunkCount: 10,
          tokenCount: 1500,
          currentRevision: 1,
          uploadedBy: new mongoose.Types.ObjectId(adminId),
          accessControl: {
            allowedRoles: [],
            allowedDepartments: [],
            minimumClearance: ClearanceLevel.INTERNAL,
            allowedUserIds: [],
          },
        },
        {
          title: 'Doc 2',
          originalFilename: 'doc2.pdf',
          mimeType: DocumentMimeType.PDF,
          fileSizeBytes: 4096,
          storagePath: '/data/doc2.pdf',
          fileHash: 'hash2',
          status: DocumentStatus.FAILED,
          errorMessage: 'Corrupted binary format',
          chunkCount: 0,
          tokenCount: 0,
          currentRevision: 1,
          uploadedBy: new mongoose.Types.ObjectId(adminId),
          accessControl: {
            allowedRoles: [],
            allowedDepartments: [],
            minimumClearance: ClearanceLevel.INTERNAL,
            allowedUserIds: [],
          },
        },
      ]);

      // 3. Seed Conversations & Messages
      const conv = await ConversationModel.create({
        userId: new mongoose.Types.ObjectId(userId),
        title: 'Test Conversation',
        status: 'active',
      });

      const userMsg = await MessageModel.create({
        conversationId: conv._id,
        sender: MessageSender.USER,
        content: 'What is the freeze policy?',
        status: 'completed',
      });

      const assistantMsg = await MessageModel.create({
        conversationId: conv._id,
        sender: MessageSender.ASSISTANT,
        content: 'Deployment freeze is on Friday.',
        status: 'completed',
        citations: [],
      });

      // 4. Seed Query Logs (Multiple queries to verify average and p95 latency percentiles)
      await QueryLogModel.create([
        {
          userId: new mongoose.Types.ObjectId(userId),
          rawQuery: 'What is the freeze policy?',
          retrievalParams: { topK: 5, similarityThreshold: 0.65 },
          retrievedChunkIds: [],
          timings: { totalDurationMs: 100 },
          tokenUsage: { promptTokens: 50, completionTokens: 25 },
          cacheHit: false,
          status: 'success',
        },
        {
          userId: new mongoose.Types.ObjectId(userId),
          rawQuery: 'What is the travel policy?',
          retrievalParams: { topK: 5, similarityThreshold: 0.65 },
          retrievedChunkIds: [],
          timings: { totalDurationMs: 200 },
          tokenUsage: { promptTokens: 50, completionTokens: 25 },
          cacheHit: false,
          status: 'success',
        },
        {
          userId: new mongoose.Types.ObjectId(userId),
          rawQuery: 'What is the holiday calendar?',
          retrievalParams: { topK: 5, similarityThreshold: 0.65 },
          retrievedChunkIds: [],
          timings: { totalDurationMs: 300 },
          tokenUsage: { promptTokens: 50, completionTokens: 25 },
          cacheHit: false,
          status: 'success',
        },
        {
          userId: new mongoose.Types.ObjectId(userId),
          rawQuery: 'What is the complex architecture plan?',
          retrievalParams: { topK: 5, similarityThreshold: 0.65 },
          retrievedChunkIds: [],
          timings: { totalDurationMs: 1000 },
          tokenUsage: { promptTokens: 100, completionTokens: 50 },
          cacheHit: false,
          status: 'success',
        },
      ]);

      // 5. Seed Feedback
      await FeedbackModel.create({
        userId: new mongoose.Types.ObjectId(userId),
        conversationId: conv._id,
        messageId: assistantMsg._id,
        rating: FeedbackRating.THUMBS_UP,
        category: FeedbackCategory.ACCURATE_HELPFUL,
        userComment: 'Very clear answer',
      });

      const res = await request(app)
        .get('/api/v1/admin/analytics/overview')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const { userMetrics, documentMetrics, conversationMetrics, queryMetrics, feedbackMetrics } =
        res.body.data;

      expect(userMetrics.totalUsers).toBe(2);
      expect(userMetrics.activeUsers).toBe(2);

      expect(documentMetrics.totalDocuments).toBe(2);
      expect(documentMetrics.readyDocuments).toBe(1);
      expect(documentMetrics.failedDocuments).toBe(1);
      expect(documentMetrics.totalChunks).toBe(10);
      expect(documentMetrics.totalFileSizeBytes).toBe(6144);

      expect(conversationMetrics.totalConversations).toBe(1);
      expect(conversationMetrics.totalMessages).toBe(2);
      expect(conversationMetrics.userMessages).toBe(1);
      expect(conversationMetrics.assistantMessages).toBe(1);

      expect(queryMetrics.totalQueries).toBe(4);
      expect(queryMetrics.successQueries).toBe(4);
      expect(queryMetrics.totalTokensConsumed).toBe(375);
      expect(queryMetrics.averageLatencyMs).toBe(400); // (100+200+300+1000)/4 = 400
      expect(queryMetrics.p95LatencyMs).toBe(1000);   // p95 of [100, 200, 300, 1000] is 1000ms

      expect(feedbackMetrics.totalFeedback).toBe(1);
      expect(feedbackMetrics.thumbsUp).toBe(1);
      expect(feedbackMetrics.positivePercentage).toBe(100);
    });

    it('8. Returns valid time-series data for daily trends', async () => {
      const res = await request(app)
        .get('/api/v1/admin/analytics/trends')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('9. Returns ingestion pipeline statistics and recent failure logs', async () => {
      const res = await request(app)
        .get('/api/v1/admin/analytics/ingestion')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.totalDocuments).toBeDefined();
      expect(res.body.data.byStatus).toBeDefined();
      expect(Array.isArray(res.body.data.recentFailures)).toBe(true);
    });
  });
});
