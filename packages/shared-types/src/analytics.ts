export enum FeedbackRating {
  THUMBS_UP = 'thumbs_up',
  THUMBS_DOWN = 'thumbs_down',
}

export enum FeedbackCategory {
  HALLUCINATION = 'hallucination',
  IRRELEVANT_CONTEXT = 'irrelevant_context',
  MISSING_INFORMATION = 'missing_information',
  OUTDATED = 'outdated',
  ACCURATE_HELPFUL = 'accurate_helpful',
  OTHER = 'other',
}

export interface IFeedback {
  id: string;
  userId: string;
  conversationId: string;
  messageId: string;
  rating: FeedbackRating;
  category: FeedbackCategory;
  userComment?: string;
  reviewedByAdmin: boolean;
  createdAt: string;
}

export interface ICreateFeedbackRequest {
  conversationId: string;
  messageId: string;
  rating: FeedbackRating;
  category?: FeedbackCategory;
  userComment?: string;
}

/**
 * RAG Tri-Metric Evaluation Benchmark Score
 * Values range from 0.00 to 1.00
 */
export interface IRagEvaluationScore {
  faithfulness: number;     // Groundedness: Is the answer derived strictly from retrieved context?
  answerRelevance: number;  // Did the answer directly address the user's inquiry?
  contextRecall: number;    // Did the retrieved context contain all necessary ground-truth facts?
  compositeScore: number;   // Harmonic or weighted mean of tri-metrics
}

export interface IRagEvaluationRecord {
  id: string;
  benchmarkRunId: string;
  testQuery: string;
  groundTruthAnswer?: string;
  generatedAnswer: string;
  retrievedContextCount: number;
  scores: IRagEvaluationScore;
  evaluatedAt: string;
}

export interface IAnalyticsOverview {
  userMetrics: {
    totalUsers: number;
    activeUsers: number;
    byRole: Record<string, number>;
    byClearance: Record<string, number>;
  };
  documentMetrics: {
    totalDocuments: number;
    readyDocuments: number;
    failedDocuments: number;
    processingDocuments: number;
    totalChunks: number;
    totalFileSizeBytes: number;
  };
  conversationMetrics: {
    totalConversations: number;
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
  };
  queryMetrics: {
    totalQueries: number;
    successQueries: number;
    filteredEmptyQueries: number;
    errorQueries: number;
    totalTokensConsumed: number;
    averageLatencyMs: number;
    p95LatencyMs: number;
    cacheHitRatePercentage: number;
  };
  feedbackMetrics: {
    totalFeedback: number;
    thumbsUp: number;
    thumbsDown: number;
    positivePercentage: number;
    categoryBreakdown: Record<string, number>;
  };
}

export interface IAnalyticsDailyTrend {
  date: string; // YYYY-MM-DD
  queryCount: number;
  successCount: number;
  errorCount: number;
  totalTokens: number;
  avgLatencyMs: number;
  activeConversations: number;
}

export interface IAnalyticsIngestionStats {
  totalDocuments: number;
  byStatus: Record<string, number>;
  totalChunks: number;
  totalFileSizeBytes: number;
  avgChunksPerDoc: number;
  failedCount: number;
  failureRatePercentage: number;
  recentFailures: Array<{
    documentId: string;
    title: string;
    filename: string;
    errorMessage: string;
    failedAt: string;
  }>;
}

export interface IEvaluationDatasetCase {
  id: string;
  query: string;
  category: 'grounded' | 'unauthorized_clearance' | 'unauthorized_role' | 'unauthorized_department' | 'abstention_no_docs' | 'edge_case';
  userRole?: string;
  userDepartment?: string;
  userClearance?: string;
  expectedRelevantChunkIds?: string[];
  expectedDocIds?: string[];
  expectedBehavior: 'answer' | 'abstain';
  expectedDisclaimerRegex?: string;
  groundTruthAnswer?: string;
}

export interface IEvaluationRunSummary {
  runId: string;
  timestamp: string;
  totalCases: number;
  passedCases: number;
  passRatePercentage: number;
  metrics: {
    avgRecallAtK: number;
    avgPrecisionAtK: number;
    citationValidityRate: number;
    citationCoverageRate: number;
    abstentionAccuracyRate: number;
    authorizationViolationCount: number;
    avgLatencyMs: number;
  };
  cases: Array<{
    id: string;
    passed: boolean;
    expectedBehavior: 'answer' | 'abstain';
    didAbstain: boolean;
    recallAtK: number;
    precisionAtK: number;
    citationValidity: number;
    citationCoverage: number;
    abstainedAsExpected: boolean;
    authorizationViolated: boolean;
    latencyMs: number;
    notes?: string;
  }>;
}
