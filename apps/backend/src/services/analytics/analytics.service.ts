import {
  IAnalyticsOverview,
  IAnalyticsDailyTrend,
  IAnalyticsIngestionStats,
  FeedbackRating,
  DocumentStatus,
  MessageSender,
} from '@enterprise-ai/shared-types';
import { UserModel } from '../../models/User.model.js';
import { DocumentModel } from '../../models/Document.model.js';
import { ConversationModel } from '../../models/Conversation.model.js';
import { MessageModel } from '../../models/Message.model.js';
import { QueryLogModel } from '../../models/QueryLog.model.js';
import { FeedbackModel } from '../../models/Feedback.model.js';

export class AnalyticsService {
  /**
   * Generates high-level administrative overview metrics within an optional date range
   */
  public static async getOverview(
    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    endDate = new Date()
  ): Promise<IAnalyticsOverview> {
    const dateQuery = { createdAt: { $gte: startDate, $lte: endDate } };

    // 1. User Metrics
    const [totalUsers, activeUsers, roleAgg, clearanceAgg] = await Promise.all([
      UserModel.countDocuments(),
      UserModel.countDocuments({ isActive: true }),
      UserModel.aggregate<{ _id: string; count: number }>([
        { $group: { _id: '$role', count: { $sum: 1 } } },
      ]),
      UserModel.aggregate<{ _id: string; count: number }>([
        { $group: { _id: '$securityClearance', count: { $sum: 1 } } },
      ]),
    ]);

    const byRole: Record<string, number> = {};
    roleAgg.forEach((r) => {
      byRole[r._id || 'unknown'] = r.count;
    });

    const byClearance: Record<string, number> = {};
    clearanceAgg.forEach((c) => {
      byClearance[c._id || 'unknown'] = c.count;
    });

    // 2. Document Metrics
    const [docStatusAgg, docTotalsAgg] = await Promise.all([
      DocumentModel.aggregate<{ _id: string; count: number }>([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      DocumentModel.aggregate<{ _id: null; totalChunks: number; totalSize: number }>([
        {
          $group: {
            _id: null,
            totalChunks: { $sum: '$chunkCount' },
            totalSize: { $sum: '$fileSizeBytes' },
          },
        },
      ]),
    ]);

    let totalDocs = 0;
    let readyDocs = 0;
    let failedDocs = 0;
    let processingDocs = 0;

    docStatusAgg.forEach((d) => {
      totalDocs += d.count;
      if (d._id === DocumentStatus.READY) readyDocs = d.count;
      if (d._id === DocumentStatus.FAILED) failedDocs = d.count;
      if (d._id === DocumentStatus.PROCESSING || d._id === DocumentStatus.PENDING) {
        processingDocs += d.count;
      }
    });

    const totalChunks = docTotalsAgg[0]?.totalChunks || 0;
    const totalFileSizeBytes = docTotalsAgg[0]?.totalSize || 0;

    // 3. Conversation & Message Metrics
    const [totalConversations, totalMessages, senderAgg] = await Promise.all([
      ConversationModel.countDocuments(),
      MessageModel.countDocuments(),
      MessageModel.aggregate<{ _id: string; count: number }>([
        { $group: { _id: '$sender', count: { $sum: 1 } } },
      ]),
    ]);

    let userMessages = 0;
    let assistantMessages = 0;
    senderAgg.forEach((s) => {
      if (s._id === MessageSender.USER) userMessages = s.count;
      if (s._id === MessageSender.ASSISTANT) assistantMessages = s.count;
    });

    // 4. Query Metrics (within bounded date range)
    const [queryStatusAgg, queryStatsAgg] = await Promise.all([
      QueryLogModel.aggregate<{ _id: string; count: number }>([
        { $match: dateQuery },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      QueryLogModel.aggregate<{
        _id: null;
        totalPromptTokens: number;
        totalCompletionTokens: number;
        avgDuration: number;
        durations: number[];
        cacheHits: number;
        totalCount: number;
      }>([
        { $match: dateQuery },
        {
          $group: {
            _id: null,
            totalPromptTokens: { $sum: '$tokenUsage.promptTokens' },
            totalCompletionTokens: { $sum: '$tokenUsage.completionTokens' },
            avgDuration: { $avg: '$timings.totalDurationMs' },
            durations: { $push: '$timings.totalDurationMs' },
            cacheHits: { $sum: { $cond: ['$cacheHit', 1, 0] } },
            totalCount: { $sum: 1 },
          },
        },
      ]),
    ]);

    let totalQueries = 0;
    let successQueries = 0;
    let filteredEmptyQueries = 0;
    let errorQueries = 0;

    queryStatusAgg.forEach((q) => {
      totalQueries += q.count;
      if (q._id === 'success') successQueries = q.count;
      if (q._id === 'filtered_empty') filteredEmptyQueries = q.count;
      if (q._id === 'error' || q._id === 'rate_limited') errorQueries += q.count;
    });

    const queryStats = queryStatsAgg[0];
    const totalTokensConsumed =
      (queryStats?.totalPromptTokens || 0) + (queryStats?.totalCompletionTokens || 0);
    const averageLatencyMs = Math.round(queryStats?.avgDuration || 0);

    // Calculate p95 latency
    let p95LatencyMs = 0;
    if (queryStats?.durations && queryStats.durations.length > 0) {
      const validDurations = queryStats.durations.filter(
        (d): d is number => typeof d === 'number' && !Number.isNaN(d)
      );
      if (validDurations.length > 0) {
        const sorted = [...validDurations].sort((a, b) => a - b);
        const p95Index = Math.min(
          Math.floor(sorted.length * 0.95),
          sorted.length - 1
        );
        p95LatencyMs = Math.round(sorted[p95Index] || 0);
      }
    }

    const cacheHitCount = queryStats?.cacheHits || 0;
    const cacheHitRatePercentage =
      totalQueries > 0 ? Number(((cacheHitCount / totalQueries) * 100).toFixed(1)) : 0;

    // 5. Feedback Metrics (within bounded date range)
    const [feedbackTotalsAgg, feedbackCategoryAgg] = await Promise.all([
      FeedbackModel.aggregate<{ _id: string; count: number }>([
        { $match: dateQuery },
        { $group: { _id: '$rating', count: { $sum: 1 } } },
      ]),
      FeedbackModel.aggregate<{ _id: string; count: number }>([
        { $match: dateQuery },
        { $group: { _id: '$category', count: { $sum: 1 } } },
      ]),
    ]);

    let thumbsUp = 0;
    let thumbsDown = 0;
    feedbackTotalsAgg.forEach((f) => {
      if (f._id === FeedbackRating.THUMBS_UP) thumbsUp = f.count;
      if (f._id === FeedbackRating.THUMBS_DOWN) thumbsDown = f.count;
    });

    const totalFeedback = thumbsUp + thumbsDown;
    const positivePercentage =
      totalFeedback > 0 ? Number(((thumbsUp / totalFeedback) * 100).toFixed(1)) : 0;

    const categoryBreakdown: Record<string, number> = {};
    feedbackCategoryAgg.forEach((c) => {
      categoryBreakdown[c._id || 'other'] = c.count;
    });

    // 6. Most Frequently Asked Questions (Top 5 within date range)
    const topQuestionsAgg = await QueryLogModel.aggregate<{ _id: string; count: number }>([
      { $match: dateQuery },
      { $group: { _id: '$rawQuery', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    const topQuestions = topQuestionsAgg
      .filter((q) => Boolean(q._id && q._id.trim()))
      .map((q) => ({
        query: q._id,
        count: q.count,
      }));

    // 7. Most Frequently Retrieved Documents (Top 5 within date range)
    const topSourcesAgg = await QueryLogModel.aggregate<{
      _id: any;
      title: string;
      retrievalCount: number;
    }>([
      { $match: { ...dateQuery, 'retrievedChunkIds.0': { $exists: true } } },
      { $unwind: '$retrievedChunkIds' },
      {
        $lookup: {
          from: 'documentchunks',
          localField: 'retrievedChunkIds',
          foreignField: '_id',
          as: 'chunk',
        },
      },
      { $unwind: '$chunk' },
      {
        $group: {
          _id: '$chunk.documentId',
          title: { $first: '$chunk.metadata.title' },
          retrievalCount: { $sum: 1 },
        },
      },
      { $sort: { retrievalCount: -1 } },
      { $limit: 5 },
    ]);

    const topSources = topSourcesAgg.map((s) => ({
      documentId: s._id ? s._id.toString() : 'unknown',
      title: s.title || 'Untitled Document',
      retrievalCount: s.retrievalCount,
    }));

    return {
      userMetrics: {
        totalUsers,
        activeUsers,
        byRole,
        byClearance,
      },
      documentMetrics: {
        totalDocuments: totalDocs,
        readyDocuments: readyDocs,
        failedDocuments: failedDocs,
        processingDocuments: processingDocs,
        totalChunks,
        totalFileSizeBytes,
      },
      conversationMetrics: {
        totalConversations,
        totalMessages,
        userMessages,
        assistantMessages,
      },
      queryMetrics: {
        totalQueries,
        successQueries,
        filteredEmptyQueries,
        errorQueries,
        totalTokensConsumed,
        averageLatencyMs,
        p95LatencyMs,
        cacheHitRatePercentage,
      },
      feedbackMetrics: {
        totalFeedback,
        thumbsUp,
        thumbsDown,
        positivePercentage,
        categoryBreakdown,
      },
      topSources,
      topQuestions,
    };
  }

  /**
   * Generates time-bucketed daily trends for RAG queries and conversations
   */
  public static async getTrends(
    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    endDate = new Date()
  ): Promise<IAnalyticsDailyTrend[]> {
    const queryTrends = await QueryLogModel.aggregate<{
      _id: string;
      queryCount: number;
      successCount: number;
      errorCount: number;
      promptTokens: number;
      completionTokens: number;
      avgDuration: number;
    }>([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          queryCount: { $sum: 1 },
          successCount: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] },
          },
          errorCount: {
            $sum: {
              $cond: [
                { $in: ['$status', ['error', 'rate_limited']] },
                1,
                0,
              ],
            },
          },
          promptTokens: { $sum: '$tokenUsage.promptTokens' },
          completionTokens: { $sum: '$tokenUsage.completionTokens' },
          avgDuration: { $avg: '$timings.totalDurationMs' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Active conversation count by date from messages
    const convTrends = await MessageModel.aggregate<{
      _id: string;
      activeConversations: number;
    }>([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            conversationId: '$conversationId',
          },
        },
      },
      {
        $group: {
          _id: '$_id.date',
          activeConversations: { $sum: 1 },
        },
      },
    ]);

    const convMap = new Map<string, number>();
    convTrends.forEach((c) => {
      convMap.set(c._id, c.activeConversations);
    });

    return queryTrends.map((t) => ({
      date: t._id,
      queryCount: t.queryCount,
      successCount: t.successCount,
      errorCount: t.errorCount,
      totalTokens: (t.promptTokens || 0) + (t.completionTokens || 0),
      avgLatencyMs: Math.round(t.avgDuration || 0),
      activeConversations: convMap.get(t._id) || 0,
    }));
  }

  /**
   * Generates ingestion pipeline statistics, status distributions, and failure records
   */
  public static async getIngestionStats(): Promise<IAnalyticsIngestionStats> {
    const [statusAgg, totalsAgg, recentFailures] = await Promise.all([
      DocumentModel.aggregate<{ _id: string; count: number }>([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      DocumentModel.aggregate<{
        _id: null;
        totalChunks: number;
        totalSize: number;
        totalCount: number;
      }>([
        {
          $group: {
            _id: null,
            totalChunks: { $sum: '$chunkCount' },
            totalSize: { $sum: '$fileSizeBytes' },
            totalCount: { $sum: 1 },
          },
        },
      ]),
      DocumentModel.find({ status: DocumentStatus.FAILED })
        .sort({ updatedAt: -1 })
        .limit(10)
        .select('_id title originalFilename errorMessage updatedAt')
        .lean(),
    ]);

    const byStatus: Record<string, number> = {};
    let totalDocs = 0;
    let failedCount = 0;

    statusAgg.forEach((s) => {
      byStatus[s._id || 'unknown'] = s.count;
      totalDocs += s.count;
      if (s._id === DocumentStatus.FAILED) {
        failedCount = s.count;
      }
    });

    const totalChunks = totalsAgg[0]?.totalChunks || 0;
    const totalFileSizeBytes = totalsAgg[0]?.totalSize || 0;
    const avgChunksPerDoc =
      totalDocs > 0 ? Number((totalChunks / totalDocs).toFixed(1)) : 0;
    const failureRatePercentage =
      totalDocs > 0 ? Number(((failedCount / totalDocs) * 100).toFixed(1)) : 0;

    return {
      totalDocuments: totalDocs,
      byStatus,
      totalChunks,
      totalFileSizeBytes,
      avgChunksPerDoc,
      failedCount,
      failureRatePercentage,
      recentFailures: recentFailures.map((f: any) => ({
        documentId: f._id.toString(),
        title: f.title,
        filename: f.originalFilename,
        errorMessage: f.errorMessage || 'Unknown ingestion failure',
        failedAt: f.updatedAt.toISOString(),
      })),
    };
  }
}
