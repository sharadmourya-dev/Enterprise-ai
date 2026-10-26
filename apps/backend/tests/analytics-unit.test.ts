import mongoose from 'mongoose';
import { AnalyticsService } from '../src/services/analytics/analytics.service.js';
import { UserModel } from '../src/models/User.model.js';
import { DocumentModel } from '../src/models/Document.model.js';
import { ConversationModel } from '../src/models/Conversation.model.js';
import { MessageModel } from '../src/models/Message.model.js';
import { QueryLogModel } from '../src/models/QueryLog.model.js';
import { FeedbackModel } from '../src/models/Feedback.model.js';
import { DocumentStatus } from '@enterprise-ai/shared-types';

describe('Admin Analytics Unit Tests (Mocked Database)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('AnalyticsService.getOverview', () => {
    it('aggregates overview metrics including topSources and topQuestions', async () => {
      // Mock User aggregations
      jest.spyOn(UserModel, 'countDocuments').mockImplementation(((filter: any) => {
        if (filter?.isActive) return Promise.resolve(120);
        return Promise.resolve(150);
      }) as any);

      jest.spyOn(UserModel, 'aggregate').mockImplementation(((pipeline: any[]) => {
        return Promise.resolve([
          { _id: 'user', count: 120 },
          { _id: 'admin', count: 30 },
        ]);
      }) as any);

      // Mock Document aggregations
      jest.spyOn(DocumentModel, 'aggregate').mockImplementation(((pipeline: any[]) => {
        const groupStage = pipeline.find((stage) => stage.$group)?.$group;
        if (groupStage?._id === '$status') {
          return Promise.resolve([
            { _id: DocumentStatus.READY, count: 80 },
            { _id: DocumentStatus.FAILED, count: 5 },
            { _id: DocumentStatus.PROCESSING, count: 2 },
          ]);
        }
        if (groupStage?._id === null) {
          return Promise.resolve([
            {
              _id: null,
              totalChunks: 1500,
              totalSize: 50000000,
            },
          ]);
        }
        return Promise.resolve([]);
      }) as any);

      // Mock Conversation & Messages
      jest.spyOn(ConversationModel, 'countDocuments').mockResolvedValue(400 as any);
      jest.spyOn(MessageModel, 'countDocuments').mockResolvedValue(2400 as any);
      jest.spyOn(MessageModel, 'aggregate').mockResolvedValue([
        { _id: 'user', count: 1200 },
        { _id: 'assistant', count: 1200 },
      ] as any);

      // Mock QueryLog
      const mockDocId = new mongoose.Types.ObjectId();
      jest.spyOn(QueryLogModel, 'aggregate').mockImplementation(((pipeline: any[]) => {
        const groupStage = pipeline.find((stage) => stage.$group)?.$group;

        if (groupStage?._id === '$status') {
          return Promise.resolve([
            { _id: 'success', count: 1150 },
            { _id: 'filtered_empty', count: 30 },
            { _id: 'error', count: 20 },
          ]);
        }

        if (groupStage?._id === null) {
          // Main queryMetrics aggregation
          return Promise.resolve([
            {
              _id: null,
              totalPromptTokens: 250000,
              totalCompletionTokens: 250000,
              avgDuration: 350,
              durations: [350],
              cacheHits: 400,
              totalCount: 1200,
            },
          ]);
        }

        if (groupStage?._id === '$rawQuery') {
          // Top questions aggregation
          return Promise.resolve([
            { _id: 'What is the leave policy?', count: 45 },
            { _id: 'How to claim medical insurance?', count: 30 },
          ]);
        }

        if (groupStage?._id === '$chunk.documentId') {
          // Top sources aggregation
          return Promise.resolve([
            {
              _id: mockDocId,
              title: 'HR Leave Policy 2026',
              retrievalCount: 88,
            },
          ]);
        }

        return Promise.resolve([]);
      }) as any);

      // Mock Feedback
      jest.spyOn(FeedbackModel, 'aggregate').mockImplementation(((pipeline: any[]) => {
        const groupStage = pipeline.find((stage) => stage.$group)?.$group;
        if (groupStage?._id === '$rating') {
          return Promise.resolve([
            { _id: 'thumbs_up', count: 90 },
            { _id: 'thumbs_down', count: 10 },
          ]);
        }
        if (groupStage?._id === '$category') {
          return Promise.resolve([
            { _id: 'accurate', count: 50 },
            { _id: 'incomplete', count: 10 },
          ]);
        }
        return Promise.resolve([]);
      }) as any);

      const overview = await AnalyticsService.getOverview();

      expect(overview.userMetrics.totalUsers).toBe(150);
      expect(overview.userMetrics.activeUsers).toBe(120);
      expect(overview.documentMetrics.totalDocuments).toBe(87);
      expect(overview.documentMetrics.readyDocuments).toBe(80);
      expect(overview.documentMetrics.failedDocuments).toBe(5);
      expect(overview.documentMetrics.totalChunks).toBe(1500);
      expect(overview.queryMetrics?.totalQueries).toBe(1200);
      expect(overview.queryMetrics?.averageLatencyMs).toBe(350);

      // Verify topQuestions
      expect(overview.topQuestions).toBeDefined();
      expect(overview.topQuestions?.length).toBe(2);
      expect(overview.topQuestions?.[0]).toEqual({
        query: 'What is the leave policy?',
        count: 45,
      });

      // Verify topSources
      expect(overview.topSources).toBeDefined();
      expect(overview.topSources?.length).toBe(1);
      expect(overview.topSources?.[0]).toEqual({
        documentId: mockDocId.toString(),
        title: 'HR Leave Policy 2026',
        retrievalCount: 88,
      });

      // Verify feedback
      expect(overview.feedbackMetrics?.thumbsUp).toBe(90);
      expect(overview.feedbackMetrics?.thumbsDown).toBe(10);
      expect(overview.feedbackMetrics?.positivePercentage).toBe(90);
    });
  });

  describe('AnalyticsService.getTrends', () => {
    it('aggregates daily trends properly', async () => {
      jest.spyOn(QueryLogModel, 'aggregate').mockResolvedValue([
        {
          _id: '2026-10-25',
          queryCount: 100,
          successCount: 98,
          errorCount: 2,
          promptTokens: 25000,
          completionTokens: 20000,
          avgDuration: 320,
        },
      ] as any);

      jest.spyOn(MessageModel, 'aggregate').mockResolvedValue([
        { _id: '2026-10-25', activeConversations: 25 },
      ] as any);

      const trends = await AnalyticsService.getTrends(
        new Date('2026-10-20'),
        new Date('2026-10-26')
      );

      expect(trends.length).toBe(1);
      const day25 = trends[0];
      expect(day25.date).toBe('2026-10-25');
      expect(day25.queryCount).toBe(100);
      expect(day25.successCount).toBe(98);
      expect(day25.totalTokens).toBe(45000);
      expect(day25.avgLatencyMs).toBe(320);
      expect(day25.activeConversations).toBe(25);
    });
  });

  describe('AnalyticsService.getIngestionStats', () => {
    it('calculates ingestion success, failure rates and returns recent failures', async () => {
      jest.spyOn(DocumentModel, 'aggregate').mockImplementation(((pipeline: any[]) => {
        const groupStage = pipeline.find((stage) => stage.$group)?.$group;
        if (groupStage?._id === '$status') {
          return Promise.resolve([
            { _id: DocumentStatus.READY, count: 95 },
            { _id: DocumentStatus.FAILED, count: 5 },
          ]);
        }
        if (groupStage?._id === null) {
          return Promise.resolve([
            {
              _id: null,
              totalChunks: 950,
              totalSize: 45000000,
              totalCount: 100,
            },
          ]);
        }
        return Promise.resolve([]);
      }) as any);

      const mockFailedDoc = {
        _id: new mongoose.Types.ObjectId(),
        title: 'Corrupt_Data.pdf',
        originalFilename: 'Corrupt_Data.pdf',
        errorMessage: 'PDF parsing error: unexpected EOF',
        updatedAt: new Date('2026-10-25T12:00:00Z'),
      };

      jest.spyOn(DocumentModel, 'find').mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([mockFailedDoc]),
      } as any);

      const stats = await AnalyticsService.getIngestionStats();

      expect(stats.totalDocuments).toBe(100);
      expect(stats.failedCount).toBe(5);
      expect(stats.failureRatePercentage).toBe(5);
      expect(stats.recentFailures.length).toBe(1);
      expect(stats.recentFailures[0].title).toBe('Corrupt_Data.pdf');
      expect(stats.recentFailures[0].errorMessage).toBe('PDF parsing error: unexpected EOF');
    });
  });
});
