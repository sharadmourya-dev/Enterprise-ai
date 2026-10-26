'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  IAnalyticsOverview,
  IAnalyticsDailyTrend,
  IAnalyticsIngestionStats,
} from '@enterprise-ai/shared-types';
import { ApiClient } from '@/lib/api-client';
import { Button, Badge, Skeleton, useToast } from '@/components/ui';
import { AnalyticsKpiCard } from './AnalyticsKpiCard';
import { TrendChart } from './TrendChart';
import { IngestionStatsView } from './IngestionStatsView';
import { FeedbackBreakdownView } from './FeedbackBreakdownView';
import { KnowledgeSourcesView } from './KnowledgeSourcesView';
import { RagEvalNoticeCard } from './RagEvalNoticeCard';
import {
  Activity,
  Zap,
  Clock,
  Users,
  FileText,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  Calendar,
  AlertTriangle,
  Database,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ShieldCheck,
} from 'lucide-react';
import { formatFileSize } from '@/components/documents/DocumentList';
import { cn } from '@/lib/utils';

export type TimeWindowOption = '7d' | '14d' | '30d' | '90d' | 'custom';

export function AnalyticsDashboard() {
  const { error: toastError } = useToast();

  const [timeWindow, setTimeWindow] = useState<TimeWindowOption>('30d');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

  const [overview, setOverview] = useState<IAnalyticsOverview | null>(null);
  const [trends, setTrends] = useState<IAnalyticsDailyTrend[]>([]);
  const [ingestion, setIngestion] = useState<IAnalyticsIngestionStats | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setIsRefreshing(true);
    else setIsLoading(true);

    setErrorMessage(null);

    try {
      const params: Record<string, string> = {};
      const now = new Date();
      let startDate: Date;
      let endDate: Date = now;

      if (timeWindow === 'custom') {
        if (!customStart || !customEnd) {
          setIsLoading(false);
          setIsRefreshing(false);
          return;
        }
        startDate = new Date(customStart);
        endDate = new Date(customEnd);
        if (startDate > endDate) {
          const errMsg = 'Start date cannot be after end date';
          setErrorMessage(errMsg);
          toastError(errMsg, 'Validation');
          setIsLoading(false);
          setIsRefreshing(false);
          return;
        }
        const diffMs = endDate.getTime() - startDate.getTime();
        if (diffMs > 90 * 24 * 60 * 60 * 1000) {
          const errMsg = 'Date range cannot exceed 90 days';
          setErrorMessage(errMsg);
          toastError(errMsg, 'Validation');
          setIsLoading(false);
          setIsRefreshing(false);
          return;
        }
      } else {
        const days = timeWindow === '7d' ? 7 : timeWindow === '14d' ? 14 : timeWindow === '90d' ? 90 : 30;
        startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      }

      params.startDate = startDate.toISOString();
      params.endDate = endDate.toISOString();

      // Concurrently query overview, trends, and ingestion stats
      const [overviewData, trendsData, ingestionData] = await Promise.all([
        ApiClient.get<IAnalyticsOverview>('/api/v1/admin/analytics/overview', params),
        ApiClient.get<IAnalyticsDailyTrend[]>('/api/v1/admin/analytics/trends', params),
        ApiClient.get<IAnalyticsIngestionStats>('/api/v1/admin/analytics/ingestion'),
      ]);

      setOverview(overviewData);
      setTrends(Array.isArray(trendsData) ? trendsData : []);
      setIngestion(ingestionData);
    } catch (err: any) {
      const msg = err.message || 'Failed to load administrative analytics data';
      setErrorMessage(msg);
      toastError(msg, 'Analytics Error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [timeWindow, customStart, customEnd, toastError]);

  useEffect(() => {
    if (timeWindow !== 'custom') {
      fetchAnalytics();
    }
  }, [fetchAnalytics, timeWindow]);

  const handleCustomApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customStart || !customEnd) {
      toastError('Both start date and end date are required for custom range', 'Validation');
      return;
    }
    fetchAnalytics();
  };

  const totalQueries = overview?.queryMetrics?.totalQueries || 0;
  const successQueries = overview?.queryMetrics?.successQueries || 0;
  const filteredEmptyQueries = overview?.queryMetrics?.filteredEmptyQueries || 0;
  const retrievalSuccessRate =
    totalQueries > 0 ? Number(((successQueries / totalQueries) * 100).toFixed(1)) : 0;
  const noAnswerRate =
    totalQueries > 0 ? Number(((filteredEmptyQueries / totalQueries) * 100).toFixed(1)) : 0;

  return (
    <div className="space-y-6">
      {/* Header with Title and Time-Range Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border-subtle">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-text-primary">
              Admin Analytics &amp; Telemetry
            </h1>
            <Badge variant="brand" className="text-xs">
              Live Verified API
            </Badge>
          </div>
          <p className="text-sm text-text-secondary">
            System health, query throughput, token consumption, model latency, and ingestion metrics
          </p>
        </div>

        {/* Time-Range Selector & Refresh Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border-subtle bg-surface p-1 text-xs">
            {(
              [
                { id: '7d', label: '7D' },
                { id: '14d', label: '14D' },
                { id: '30d', label: '30D' },
                { id: '90d', label: '90D' },
                { id: 'custom', label: 'Custom' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTimeWindow(opt.id)}
                className={cn(
                  'px-3 py-1 rounded-md font-medium transition-colors',
                  timeWindow === opt.id
                    ? 'bg-brand-primary text-white shadow-sm'
                    : 'text-text-secondary hover:text-text-primary'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchAnalytics(true)}
            isLoading={isRefreshing}
            leftIcon={<RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />}
            aria-label="Refresh Analytics"
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Custom Date Range Picker Form (when timeWindow === 'custom') */}
      {timeWindow === 'custom' && (
        <form
          onSubmit={handleCustomApply}
          className="flex flex-wrap items-center gap-3 p-4 rounded-xl border border-border-subtle bg-surface-elevated/40 text-xs"
        >
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-text-muted" />
            <span className="font-medium text-text-secondary">Custom Range (Max 90 days):</span>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="custom-start-date" className="text-text-muted">From:</label>
            <input
              id="custom-start-date"
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-border-subtle bg-surface text-text-primary"
              required
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="custom-end-date" className="text-text-muted">To:</label>
            <input
              id="custom-end-date"
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-border-subtle bg-surface text-text-primary"
              required
            />
          </div>
          <Button type="submit" size="sm" variant="primary">
            Apply Window
          </Button>
        </form>
      )}

      {/* Error Banner with Retry */}
      {errorMessage && (
        <div className="p-4 rounded-xl border border-status-error/30 bg-status-error/10 text-status-error flex items-start justify-between gap-3 text-xs">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Unable to load complete analytics</p>
              <p className="mt-0.5">{errorMessage}</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fetchAnalytics(true)}
            className="border-status-error/40 text-status-error hover:bg-status-error/10"
          >
            Retry
          </Button>
        </div>
      )}

      {/* Primary KPI Overview Metric Cards */}
      <div className="space-y-4">
        {/* Tier 1: Query & RAG Performance (Bounded by Selected Time Range) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Query Throughput &amp; Response Telemetry ({timeWindow.toUpperCase()})
            </h3>
            <span className="text-[11px] text-text-muted">Bounded by selected date window</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <AnalyticsKpiCard
              title="Total Queries"
              value={totalQueries.toLocaleString()}
              subtitle={`${successQueries} passed, ${overview?.queryMetrics?.errorQueries || 0} errors`}
              icon={<Activity className="w-5 h-5" />}
              iconColorClass="text-brand-primary bg-brand-primary/10"
              isLoading={isLoading}
              testId="kpi-total-queries"
            />

            <AnalyticsKpiCard
              title="Failed Queries"
              value={(overview?.queryMetrics?.errorQueries || 0).toLocaleString()}
              subtitle={`${noAnswerRate}% no-answer / filtered`}
              icon={<XCircle className="w-5 h-5" />}
              iconColorClass="text-status-error bg-status-error/10"
              badge={
                overview?.queryMetrics?.errorQueries ? (
                  <Badge variant="error" className="text-[10px]">
                    {overview.queryMetrics.errorQueries} Errs
                  </Badge>
                ) : (
                  <Badge variant="success" className="text-[10px]">0 Errors</Badge>
                )
              }
              isLoading={isLoading}
              testId="kpi-failed-queries"
            />

            <AnalyticsKpiCard
              title="Avg Response Time"
              value={overview?.queryMetrics ? `${overview.queryMetrics.averageLatencyMs} ms` : undefined}
              subtitle={`p95 latency: ${overview?.queryMetrics?.p95LatencyMs || 0} ms`}
              icon={<Clock className="w-5 h-5" />}
              iconColorClass="text-status-warning bg-status-warning/10"
              isLoading={isLoading}
              testId="kpi-avg-latency"
            />

            <AnalyticsKpiCard
              title="Retrieval Success Rate"
              value={overview?.queryMetrics ? `${retrievalSuccessRate}%` : undefined}
              subtitle={`${successQueries} out of ${totalQueries} succeeded`}
              icon={<ShieldCheck className="w-5 h-5" />}
              iconColorClass="text-status-success bg-status-success/10"
              badge={
                retrievalSuccessRate >= 90 ? (
                  <Badge variant="success" className="text-[10px]">Optimal</Badge>
                ) : undefined
              }
              isLoading={isLoading}
              testId="kpi-retrieval-success-rate"
            />

            <AnalyticsKpiCard
              title="Cache Hit Rate"
              value={overview?.queryMetrics ? `${overview.queryMetrics.cacheHitRatePercentage}%` : undefined}
              subtitle={`${(overview?.queryMetrics?.totalTokensConsumed || 0).toLocaleString()} tokens consumed`}
              icon={<Zap className="w-5 h-5" />}
              iconColorClass="text-status-info bg-status-info/10"
              badge={<Badge variant="info" className="text-[10px]">Redis</Badge>}
              isLoading={isLoading}
              testId="kpi-cache-hit-rate"
            />

            <AnalyticsKpiCard
              title="User Feedback"
              value={overview?.feedbackMetrics ? `${overview.feedbackMetrics.positivePercentage}%` : undefined}
              subtitle={`${overview?.feedbackMetrics?.thumbsUp || 0} positive, ${overview?.feedbackMetrics?.thumbsDown || 0} negative`}
              icon={<ThumbsUp className="w-5 h-5" />}
              iconColorClass="text-status-success bg-status-success/10"
              badge={
                overview?.feedbackMetrics?.thumbsDown ? (
                  <Badge variant="warning" className="text-[10px]">
                    {overview.feedbackMetrics.thumbsDown} negative
                  </Badge>
                ) : undefined
              }
              isLoading={isLoading}
              testId="kpi-positive-sentiment"
            />
          </div>
        </div>

        {/* Tier 2: System Users & Document Corpus (Current Enterprise Totals) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Corpus &amp; User Enrollment (All Time Enterprise Totals)
            </h3>
            <span className="text-[11px] text-text-muted">Current live system state</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <AnalyticsKpiCard
              title="Total Users"
              value={overview?.userMetrics?.totalUsers?.toLocaleString()}
              subtitle="Total enrolled enterprise accounts"
              icon={<Users className="w-5 h-5" />}
              iconColorClass="text-brand-primary bg-brand-primary/10"
              isLoading={isLoading}
              testId="kpi-total-users"
            />

            <AnalyticsKpiCard
              title="Active Users"
              value={overview?.userMetrics?.activeUsers?.toLocaleString()}
              subtitle={`${
                overview?.userMetrics?.totalUsers
                  ? Math.round(
                      ((overview.userMetrics.activeUsers || 0) / overview.userMetrics.totalUsers) * 100
                    )
                  : 0
              }% account activation rate`}
              icon={<Users className="w-5 h-5" />}
              iconColorClass="text-status-success bg-status-success/10"
              isLoading={isLoading}
              testId="kpi-active-users"
            />

            <AnalyticsKpiCard
              title="Total Documents"
              value={overview?.documentMetrics?.totalDocuments?.toLocaleString()}
              subtitle={`${overview?.documentMetrics?.totalChunks?.toLocaleString() || 0} chunks, ${formatFileSize(
                overview?.documentMetrics?.totalFileSizeBytes || 0
              )}`}
              icon={<FileText className="w-5 h-5" />}
              iconColorClass="text-brand-primary bg-brand-primary/10"
              isLoading={isLoading}
              testId="kpi-total-documents"
            />

            <AnalyticsKpiCard
              title="Documents Ready"
              value={overview?.documentMetrics?.readyDocuments?.toLocaleString()}
              subtitle="Successfully indexed for RAG vector search"
              icon={<CheckCircle2 className="w-5 h-5" />}
              iconColorClass="text-status-success bg-status-success/10"
              badge={<Badge variant="success" className="text-[10px]">Indexed</Badge>}
              isLoading={isLoading}
              testId="kpi-ready-documents"
            />

            <AnalyticsKpiCard
              title="Processing Failures"
              value={overview?.documentMetrics?.failedDocuments?.toLocaleString()}
              subtitle={`${ingestion?.failureRatePercentage || 0}% overall pipeline failure rate`}
              icon={<AlertTriangle className="w-5 h-5" />}
              iconColorClass="text-status-error bg-status-error/10"
              badge={
                overview?.documentMetrics?.failedDocuments ? (
                  <Badge variant="error" className="text-[10px]">Action Required</Badge>
                ) : (
                  <Badge variant="success" className="text-[10px]">0 Failed</Badge>
                )
              }
              isLoading={isLoading}
              testId="kpi-failed-documents"
            />
          </div>
        </div>
      </div>

      {/* Query & Usage Trends Section */}
      <TrendChart trends={trends} isLoading={isLoading} />

      {/* Most-Used Knowledge Sources & Top User Questions */}
      <KnowledgeSourcesView
        topSources={overview?.topSources}
        topQuestions={overview?.topQuestions}
        isLoading={isLoading}
      />

      {/* Ingestion Pipeline Telemetry */}
      <IngestionStatsView stats={ingestion} isLoading={isLoading} />

      {/* User Feedback & Dissatisfaction Signal Breakdown */}
      {overview?.feedbackMetrics && (
        <FeedbackBreakdownView
          feedbackMetrics={overview.feedbackMetrics}
          isLoading={isLoading}
        />
      )}

      {/* Offline RAG Evaluation Notice Card */}
      <RagEvalNoticeCard />
    </div>
  );
}
