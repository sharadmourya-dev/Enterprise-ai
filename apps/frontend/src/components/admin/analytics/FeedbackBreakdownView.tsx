'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Badge } from '@/components/ui';
import { ThumbsUp, ThumbsDown, MessageSquareHeart, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FeedbackBreakdownViewProps {
  feedbackMetrics: {
    totalFeedback: number;
    thumbsUp: number;
    thumbsDown: number;
    positivePercentage: number;
    categoryBreakdown: Record<string, number>;
  };
  isLoading?: boolean;
}

const CATEGORY_LABELS: Record<string, { label: string; isNegative: boolean }> = {
  accurate_helpful: { label: 'Accurate & Helpful', isNegative: false },
  hallucination: { label: 'Hallucination / Fabrication', isNegative: true },
  irrelevant_context: { label: 'Irrelevant Context Cited', isNegative: true },
  missing_information: { label: 'Missing Information / Incomplete', isNegative: true },
  outdated: { label: 'Outdated / Stale Knowledge', isNegative: true },
  other: { label: 'Other Inquiries', isNegative: false },
};

export function FeedbackBreakdownView({
  feedbackMetrics,
  isLoading = false,
}: FeedbackBreakdownViewProps) {
  if (isLoading) {
    return (
      <Card variant="default" className="p-6">
        <div className="space-y-4 animate-pulse">
          <div className="h-6 w-48 bg-surface-elevated rounded" />
          <div className="h-4 w-72 bg-surface-elevated rounded" />
          <div className="h-32 bg-surface-elevated rounded-xl" />
        </div>
      </Card>
    );
  }

  const { totalFeedback, thumbsUp, thumbsDown, positivePercentage, categoryBreakdown } =
    feedbackMetrics;

  return (
    <Card variant="default" className="p-6 space-y-6">
      <CardHeader className="p-0">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareHeart className="w-5 h-5 text-status-success" />
              User Feedback &amp; Answer Quality Sentiment
            </CardTitle>
            <CardDescription className="mt-1">
              End-user ratings, sentiment ratios, and categorized dissatisfaction signals
            </CardDescription>
          </div>
          <Badge
            variant={positivePercentage >= 80 ? 'success' : positivePercentage >= 50 ? 'warning' : 'error'}
            className="text-xs font-semibold"
          >
            {positivePercentage}% Positive
          </Badge>
        </div>
      </CardHeader>

      {totalFeedback === 0 ? (
        <div className="p-6 text-center border border-dashed border-border-subtle rounded-xl text-text-muted text-xs">
          No feedback ratings recorded in the selected date window.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Sentiment Summary */}
          <div className="md:col-span-1 p-5 rounded-xl bg-surface-elevated/40 border border-border-subtle/60 flex flex-col justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Feedback Volume
              </p>
              <p className="text-3xl font-bold text-text-primary mt-2">
                {totalFeedback.toLocaleString()}
              </p>
              <p className="text-xs text-text-secondary mt-1">Total ratings collected</p>
            </div>

            <div className="space-y-3 mt-6 pt-4 border-t border-border-subtle/50">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-status-success font-medium">
                  <ThumbsUp className="w-4 h-4" /> Helpful
                </span>
                <span className="font-mono font-semibold text-text-primary">
                  {thumbsUp} ({totalFeedback > 0 ? Math.round((thumbsUp / totalFeedback) * 100) : 0}%)
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-status-error font-medium">
                  <ThumbsDown className="w-4 h-4" /> Needs Improvement
                </span>
                <span className="font-mono font-semibold text-text-primary">
                  {thumbsDown} ({totalFeedback > 0 ? Math.round((thumbsDown / totalFeedback) * 100) : 0}%)
                </span>
              </div>

              {/* Stacked Sentiment Ratio Bar */}
              <div className="w-full h-2.5 bg-surface-elevated rounded-full overflow-hidden flex shadow-inner mt-2">
                <div
                  style={{ width: `${positivePercentage}%` }}
                  className="bg-status-success h-full transition-all duration-300"
                />
                <div
                  style={{ width: `${100 - positivePercentage}%` }}
                  className="bg-status-error h-full transition-all duration-300"
                />
              </div>
            </div>
          </div>

          {/* Categorized Reasons Breakdown */}
          <div className="md:col-span-2 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
              Categorized Feedback Signals
            </h4>
            {Object.keys(categoryBreakdown).length === 0 ? (
              <p className="text-xs text-text-muted italic">No categorized reasons provided.</p>
            ) : (
              Object.entries(categoryBreakdown).map(([catKey, count]) => {
                const meta = CATEGORY_LABELS[catKey] || { label: catKey, isNegative: false };
                const pct = totalFeedback > 0 ? Math.round((count / totalFeedback) * 100) : 0;

                return (
                  <div key={catKey} className="space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-text-primary flex items-center gap-1.5">
                        {meta.isNegative && (
                          <AlertCircle className="w-3.5 h-3.5 text-status-error shrink-0" />
                        )}
                        {meta.label}
                      </span>
                      <span className="font-mono text-text-muted">
                        {count} ({pct}%)
                      </span>
                    </div>
                    <div className="w-full h-2 bg-surface-elevated rounded-full overflow-hidden">
                      <div
                        style={{ width: `${pct}%` }}
                        className={cn(
                          'h-full rounded-full transition-all duration-300',
                          meta.isNegative ? 'bg-status-error' : 'bg-status-success'
                        )}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
